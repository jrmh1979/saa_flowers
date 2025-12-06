// utils/generarPdfEstadoCuenta.js
const PDFDocument = require('pdfkit');
const db = require('../db');
const { formatoFechaEcuador } = require('./fechaEcuador'); // 👈 zona horaria EC

/* ============================== Helpers ============================== */
function asDate(d) {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x) ? null : x;
}
const fmt2 = (n) => Number(n || 0).toFixed(2);
const safe = (s) => (s == null ? '' : String(s));

const esCargo = (t) => t === 'F' || t === 'ND' || t === 'SI';
const esAbono = (t) => t === 'PG' || t === 'NC' || t === 'RT' || t === 'PP'; // PP se muestra como pago
const esPrepago = (t) => t === 'PP';

/** Devuelve ids del grupo: principal + marks para Clientes; sólo el propio para Proveedores */
async function getIdsGrupo(tipoMovimiento, idtercero) {
  const tipo = String(tipoMovimiento || '').toUpperCase();
  if (tipo === 'C') {
    const [rows] = await db.query(
      `SELECT idtercero FROM terceros WHERE idtercero = ? OR idcliente_padre = ?`,
      [idtercero, idtercero]
    );
    return rows.map((r) => Number(r.idtercero));
  }
  return [Number(idtercero)];
}

/** nombre de archivo */
function makeFilename(cliente, fechaISO) {
  const ymd = formatoFechaEcuador(fechaISO || new Date()); // 👈 usa zona EC
  const slug = (cliente || 'Cliente')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `${ymd}_${slug}_EstadoDeCuenta.pdf`;
}

/** datos del emisor */
async function obtenerEmisor() {
  const [rows] = await db.query('SELECT * FROM sri_emisor LIMIT 1');
  if (!rows.length) {
    return {
      razon_social: '',
      nombre_comercial: '',
      ruc: '',
      dir_matriz: '',
      telefono: '',
      email: '',
      logo_base64: null
    };
  }
  return rows[0];
}

/* ============================== Header ============================== */
function drawHeaderPortrait(doc, emisor, { titulo, cliente, fechaAsOf }) {
  const mL = doc.page.margins.left;
  const mR = doc.page.margins.right;
  const top = mL;

  // Logo
  const raw = emisor.logo_base64 || '';
  const b64 = raw.includes('base64,') ? raw.split('base64,')[1] : raw;
  if (b64) {
    try {
      const buf = Buffer.from(b64, 'base64');
      doc.image(buf, mL, top - 4, { fit: [80, 55] });
    } catch {}
  }

  const nombre = emisor.nombre_comercial || emisor.razon_social || '';
  const dir = emisor.dir_matriz || '';
  const tel = emisor.telefono ? `T: ${emisor.telefono}` : '';
  const mail = emisor.email || '';
  const infoX = mL + 90;

  doc.font('Helvetica-Bold').fontSize(12).text(nombre, infoX, top);
  doc
    .font('Helvetica')
    .fontSize(9)
    .text(dir, infoX, top + 16, { width: 330 })
    .text([tel, mail].filter(Boolean).join('  '), infoX, doc.y);

  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(`${titulo || 'ACCOUNT STATEMENT'}  ${safe(cliente)}`, 0, top + 58, { align: 'center' });

  doc
    .font('Helvetica')
    .fontSize(10)
    .text('Statement as of:', mL, top + 80);
  doc.font('Helvetica-Bold').text(safe(fechaAsOf), mL + 110, top + 80, { width: 100 });

  const amountBox = { x: doc.page.width - mR - 140, y: top + 70, w: 140, h: 28 };
  doc.roundedRect(amountBox.x, amountBox.y, amountBox.w, amountBox.h, 3).stroke();

  const yStart = top + 108;
  doc
    .moveTo(mL, yStart - 10)
    .lineTo(doc.page.width - mR, yStart - 10)
    .lineWidth(0.5)
    .strokeColor('#bbb')
    .stroke();
  doc.strokeColor('#000').lineWidth(1);

  return { yStart, amountBox };
}

/* ============== Total de anticipos (PP) disponibles al corte ============== */
async function getTotalAnticipo(tipoMovimiento, ids, fechaFin) {
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.query(
    `
    SELECT COALESCE(SUM(restante),0) AS total
      FROM (
        SELECT p.idpago,
               (p.valor - COALESCE(SUM(pf.valorpago),0)) AS restante
          FROM pagos p
          LEFT JOIN pagos_factura pf ON pf.idpago = p.idpago
         WHERE p.tipoMovimiento = ?
           AND p.idtercero IN (${placeholders})
           AND p.tipoDocumento = 'PP'
           AND p.fecha <= ?
      GROUP BY p.idpago
        HAVING restante > 0
      ) t
    `,
    [tipoMovimiento, ...ids, fechaFin]
  );
  return Number(rows?.[0]?.total || 0);
}

/* ========== Ageing correcto por factura (usa pagos_factura) ========== */
async function getAgeing(tipoMovimiento, idtercero, fechaFin) {
  const ids = await getIdsGrupo(tipoMovimiento, idtercero);
  const inIds = ids.map(() => '?').join(',');

  // Cargos que generan saldo (F, SI, ND) hasta el corte
  const [cargos] = await db.query(
    `
    SELECT fc.id, fc.fecha, COALESCE(fc.valorTotal,0) AS cargo
      FROM factura_consolidada fc
     WHERE fc.tipoMovimiento = ?
       AND fc.idcliente IN (${inIds})
       AND fc.estado <> 'proceso'
       AND fc.tipoDocumento IN ('F','SI','ND')
       AND fc.fecha <= ?
    `,
    [tipoMovimiento, ...ids, fechaFin]
  );

  if (!cargos.length) return { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };

  const facturaIds = cargos.map((r) => Number(r.id));
  const phFact = facturaIds.map(() => '?').join(',');

  // Abonos aplicados a esas facturas hasta el corte (PG, NC, RT, PP)
  const [aplicados] = await db.query(
    `
    SELECT pf.idfactura, COALESCE(SUM(pf.valorpago),0) AS aplicado
      FROM pagos_factura pf
      JOIN pagos p ON p.idpago = pf.idpago
     WHERE p.tipoMovimiento = ?
       AND p.idtercero IN (${inIds})
       AND p.fecha <= ?
       AND p.tipoDocumento IN ('PG','NC','RT','PP')
       AND pf.idfactura IN (${phFact})
  GROUP BY pf.idfactura
    `,
    [tipoMovimiento, ...ids, fechaFin, ...facturaIds]
  );

  const aplicadoMap = Object.fromEntries(
    aplicados.map((r) => [Number(r.idfactura), Number(r.aplicado || 0)])
  );

  // Bucketizar por días
  const ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const fin = asDate(fechaFin) || new Date();

  for (const r of cargos) {
    const pendiente = Number(r.cargo || 0) - (aplicadoMap[Number(r.id)] || 0);
    if (pendiente <= 0) continue;

    const f = asDate(r.fecha) || fin;
    const dd = Math.floor((fin - f) / (1000 * 60 * 60 * 24));
    if (dd <= 30) ageing.d0_30 += pendiente;
    else if (dd <= 60) ageing.d31_60 += pendiente;
    else if (dd <= 90) ageing.d61_90 += pendiente;
    else ageing.d90p += pendiente;
  }

  return ageing;
}

/* ============================== Tabla ============================== */
function renderTablaPortrait(doc, filas, saldoInicial, ageing, emisor, meta, totalAnticipo = 0) {
  const fmtMoney = (n = 0) => (Number(n) < 0 ? `- $ ${fmt2(Math.abs(n))}` : `$ ${fmt2(n)}`);

  const startX = doc.page.margins.left;
  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = meta.yStart;

  // Layout columnas
  const wDate = 58,
    wInv = 56,
    wAmt = 65,
    wCre = 65,
    wPay = 65,
    wDue = 66;
  const fixedSum = wDate + wInv + wAmt + wCre + wPay + wDue;
  const wDesc = Math.max(120, contentW - fixedSum);
  const rowH = 20;

  const cols = [
    { key: 'fecha', label: 'DATE', w: wDate, align: 'left' },
    { key: 'descripcion', label: 'DESCRIPTION', w: wDesc, align: 'left' },
    { key: 'invoice', label: 'INVOICE', w: wInv, align: 'left' },
    { key: 'amount', label: 'AMOUNT', w: wAmt, align: 'right' },
    { key: 'credits', label: 'CREDITS', w: wCre, align: 'right' },
    { key: 'payment', label: 'PAYMENT', w: wPay, align: 'right' },
    { key: 'balance', label: 'AMOUNT\nDUE', w: wDue, align: 'right' }
  ];

  const totalW = contentW;
  // ✅ Declaración ÚNICA de bottomLimit
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 60;

  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(9);
    let x = startX;
    cols.forEach((c) => {
      const labelY = y + (c.label.includes('\n') ? 2 : 6);
      doc.rect(x, y, c.w, rowH).fill('#eaeaea');
      doc.fillColor('black').text(c.label, x + 4, labelY, { width: c.w - 8, align: 'center' });
      x += c.w;
    });
    y += rowH;
    doc
      .moveTo(startX, y)
      .lineTo(startX + totalW, y)
      .lineWidth(0.8)
      .strokeColor('#222')
      .stroke();
  };

  const ensureSpace = (need) => {
    if (y + need > bottomLimit) {
      doc.addPage({ size: 'A4', layout: 'portrait', margin: 40 });
      const head = drawHeaderPortrait(doc, emisor, {
        titulo: 'ACCOUNT STATEMENT',
        cliente: meta.cliente,
        fechaAsOf: meta.asOf
      });
      meta.yStart = head.yStart;
      meta.amountBox = head.amountBox;
      y = head.yStart;
      drawHeader();
    }
  };

  drawHeader();

  // Cuerpo
  let balance = Number(saldoInicial || 0);
  let tAmount = 0,
    tCredits = 0,
    tPayment = 0;

  filas.forEach((r) => {
    ensureSpace(rowH);
    balance += Number(r.amount || 0) - Number(r.credits || 0) - Number(r.payment || 0);

    let x = startX;
    doc.font('Helvetica').fontSize(9);
    const rowToDraw = { ...r, balance };
    cols.forEach((c) => {
      let v = rowToDraw[c.key];
      if (['amount', 'credits', 'payment', 'balance'].includes(c.key) && v !== '') v = fmt2(v);
      doc.text(String(v ?? ''), x + 4, y + 3, { width: c.w - 8, align: c.align });
      x += c.w;
    });

    doc
      .moveTo(startX, y + rowH)
      .lineTo(startX + totalW, y + rowH)
      .lineWidth(0.4)
      .strokeColor('#bbb')
      .stroke();

    tAmount += Number(r.amount || 0);
    tCredits += Number(r.credits || 0);
    tPayment += Number(r.payment || 0);

    y += rowH;
  });

  // Totales
  ensureSpace(rowH);
  doc.font('Helvetica-Bold').fontSize(10);
  let x = startX;
  const tot = {
    fecha: '',
    descripcion: 'TOTALS',
    invoice: '',
    amount: fmt2(tAmount),
    credits: fmt2(tCredits),
    payment: fmt2(tPayment),
    balance: fmt2(balance)
  };
  cols.forEach((c) => {
    doc.text(String(tot[c.key] ?? ''), x + 4, y + 4, { width: c.w - 8, align: c.align });
    x += c.w;
  });
  doc
    .moveTo(startX, y)
    .lineTo(startX + totalW, y)
    .lineWidth(0.8)
    .strokeColor('#222')
    .stroke();
  doc
    .moveTo(startX, y + rowH)
    .lineTo(startX + totalW, y + rowH)
    .lineWidth(0.8)
    .strokeColor('#222')
    .stroke();
  y += rowH + 12;

  /* Anticipo y Balance */
  const anticipo = Number(totalAnticipo || 0);
  const saldoBalance = Number(balance || 0) - anticipo;

  doc
    .moveTo(startX, y + 6)
    .lineTo(startX + totalW, y + 6)
    .strokeColor('#e6e6e6')
    .stroke();

  const labelW = 120,
    valueW = 150,
    rowSmall = 18;
  const xLabel = startX;
  const xValue = startX + totalW - valueW;

  doc
    .font('Helvetica')
    .fontSize(10)
    .text('Anticipo', xLabel, y + 10, { width: labelW, align: 'left' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(
      Number.isFinite(anticipo)
        ? anticipo < 0
          ? `- $ ${fmt2(Math.abs(anticipo))}`
          : `$ ${fmt2(anticipo)}`
        : '$ 0.00',
      xValue,
      y + 10,
      { width: valueW, align: 'right' }
    );
  y += rowSmall;

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('Balance', xLabel, y + 2, { width: labelW, align: 'left' });
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(
      saldoBalance < 0 ? `- $ ${fmt2(Math.abs(saldoBalance))}` : `$ ${fmt2(saldoBalance)}`,
      xValue,
      y + 2,
      { width: valueW, align: 'right' }
    );
  y += rowSmall + 8;

  /* Resumen antigüedad (usa el MISMO bottomLimit) */
  const ageingBoxW = totalW;
  const colsAge = [
    { key: 'd0_30', label: '0–30 días' },
    { key: 'd31_60', label: '31–60 días' },
    { key: 'd61_90', label: '61–90 días' },
    { key: 'd90p', label: '> 90 días' }
  ];
  const aw = ageingBoxW / colsAge.length;
  const ah = 22;

  // Si no hay espacio, nueva página
  if (y + ah * 2 + 40 > bottomLimit) {
    doc.addPage({ size: 'A4', layout: 'portrait', margin: 40 });
    const head = drawHeaderPortrait(doc, emisor, {
      titulo: 'ACCOUNT STATEMENT',
      cliente: meta.cliente,
      fechaAsOf: meta.asOf
    });
    meta.yStart = head.yStart;
    meta.amountBox = head.amountBox;
    y = head.yStart;
  }

  doc.font('Helvetica-Bold').fontSize(10).text('RESUMEN ANTIGÜEDAD DE SALDOS', startX, y);
  y += 8;

  // Encabezado ageing
  doc.font('Helvetica-Bold').fontSize(9);
  for (let i = 0; i < colsAge.length; i++) {
    doc.rect(startX + i * aw, y, aw, ah).fill('#eaeaea');
    doc
      .fillColor('black')
      .text(colsAge[i].label, startX + i * aw + 4, y + 4, { width: aw - 8, align: 'center' });
  }
  y += ah;

  // Valores ageing
  doc.font('Helvetica').fontSize(10);
  for (let i = 0; i < colsAge.length; i++) {
    const v = fmt2(ageing[colsAge[i].key] || 0);
    doc
      .rect(startX + i * aw, y, aw, ah)
      .strokeColor('#cfcfcf')
      .stroke();
    doc.text(v, startX + i * aw + 4, y + 4, { width: aw - 8, align: 'center' });
  }
  y += ah;

  return Number(saldoBalance || 0);
}

/* ======================= Cálculos base (SQL) ======================= */
async function buildDataForRange({ tipoMovimiento, idtercero, fechaInicio, fechaFin }) {
  const ids = await getIdsGrupo(tipoMovimiento, idtercero);
  const inIds = ids.map(() => '?').join(',');

  /* 🔁 SALDO INICIAL desde la VISTA (consistente con el estado):
     suma de 'saldo' (movimiento con signo) anterior al rango */
  const [[prev]] = await db.query(
    `
    SELECT COALESCE(SUM(saldo), 0) AS saldoInicial
      FROM vista_estado_cuenta
     WHERE tipoMovimiento = ?
       AND idtercero IN (${inIds})
       AND fecha < ?
    `,
    [tipoMovimiento, ...ids, fechaInicio]
  );
  const saldoInicial = Number(prev?.saldoInicial || 0);

  // Movimientos del rango
  const [fcRows] = await db.query(
    `
    SELECT fc.fecha, fc.tipoDocumento AS tipo, fc.numero_factura AS numero,
           fc.valorTotal, fc.observaciones, t.nombre AS subcliente
      FROM factura_consolidada fc
      JOIN terceros t ON t.idtercero = fc.idcliente
     WHERE fc.tipoMovimiento = ?
       AND fc.idcliente IN (${inIds})
       AND fc.estado <> 'proceso'
       AND fc.fecha BETWEEN ? AND ?
    `,
    [tipoMovimiento, ...ids, fechaInicio, fechaFin]
  );

  const [pgRows] = await db.query(
    `
    SELECT p.fecha, p.tipoDocumento AS tipo, '' AS numero,
           p.valor AS valorTotal, p.observaciones, t.nombre AS subcliente
      FROM pagos p
      JOIN terceros t ON t.idtercero = p.idtercero
     WHERE p.tipoMovimiento = ?
       AND p.idtercero IN (${inIds})
       AND p.fecha BETWEEN ? AND ?
    `,
    [tipoMovimiento, ...ids, fechaInicio, fechaFin]
  );

  const rowsRange = [...fcRows, ...pgRows].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  // Nombre del cliente principal
  let clientePrincipal = '---';
  try {
    const [[cli]] = await db.query(
      `SELECT idcliente_padre, nombre FROM terceros WHERE idtercero = ? LIMIT 1`,
      [idtercero]
    );
    const principalId = cli?.idcliente_padre || idtercero;
    const [[p]] = await db.query(`SELECT nombre FROM terceros WHERE idtercero = ? LIMIT 1`, [
      principalId
    ]);
    clientePrincipal = p?.nombre || cli?.nombre || '---';
  } catch {}

  // Anticipos (PP) restantes al corte
  const totalAnticipo = await getTotalAnticipo(tipoMovimiento, ids, fechaFin);

  return { ids, rowsRange, saldoInicial, totalAnticipo, clientePrincipal };
}

/* ================== Generador principal (stream HTTP) ================== */
async function generarEstadoCuentaPDFStream({
  idtercero,
  tipoMovimiento,
  fechaInicio,
  fechaFin,
  res
}) {
  const emisor = await obtenerEmisor();
  const base = await buildDataForRange({ tipoMovimiento, idtercero, fechaInicio, fechaFin });

  // Construir filas visibles (PP como payment con etiqueta)
  const seenFact = new Set();

  const filas = base.rowsRange
    .filter((r) => String(r.tipo || '').toUpperCase() !== 'PP')
    .map((r) => {
      const fechaTxt = formatoFechaEcuador(r.fecha); // 👈 zona EC
      const t = String(r.tipo || '').toUpperCase();
      const numero = r.numero;
      let amount = 0,
        credits = 0,
        payment = 0;

      if (esCargo(t)) {
        if (t === 'F') {
          if (!seenFact.has(String(numero))) {
            amount = Number(r.valorTotal || 0);
            seenFact.add(String(numero));
          }
        } else {
          amount = Number(r.valorTotal || 0); // ND / SI
        }
      } else if (t === 'NC' || t === 'RT') {
        credits = Number(r.valorTotal || 0);
      } else if (t === 'PG') {
        payment = Number(r.valorTotal || 0); // 👈 PP ya NO
      }

      const baseDesc = (r.subcliente || '').trim();
      const descripcion = baseDesc; // 👈 sin "(PP)"

      return {
        fecha: fechaTxt,
        descripcion,
        invoice: t === 'F' ? String(numero || '') : '',
        amount,
        credits,
        payment
      };
    });

  // ✅ Ageing correcto por factura (cargos - abonos aplicados a cada factura)
  const ageing = await getAgeing(tipoMovimiento, idtercero, fechaFin);

  // PDF
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });

  const filename = makeFilename(base.clientePrincipal, fechaFin);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const head = drawHeaderPortrait(doc, emisor, {
    titulo: 'ACCOUNT STATEMENT',
    cliente: base.clientePrincipal,
    fechaAsOf: formatoFechaEcuador(fechaFin) // 👈 zona EC
  });

  const saldoFinal = renderTablaPortrait(
    doc,
    filas,
    base.saldoInicial,
    ageing,
    emisor,
    {
      yStart: head.yStart,
      amountBox: head.amountBox,
      cliente: base.clientePrincipal,
      asOf: formatoFechaEcuador(fechaFin) // 👈 zona EC
    },
    base.totalAnticipo
  );

  const amountDueTxt =
    saldoFinal < 0 ? `- $ ${fmt2(Math.abs(saldoFinal))}` : `$ ${fmt2(saldoFinal)}`;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(amountDueTxt, head.amountBox.x, head.amountBox.y + 7, {
      width: head.amountBox.w,
      align: 'center'
    });

  doc.end();
}

/* ================== Versión buffer (para correo) ================== */
/* Firma compatible con tu endpoint actual:
   generarEstadoCuentaPDFBuffer(rowsRaw, nombreTercero, tipoMovimiento, rangoFechas)
   Ignoramos rowsRaw para el cálculo (solo lo usamos para obtener idtercero),
   y volvemos a consultar con el mismo criterio de principal + marks.
*/
async function generarEstadoCuentaPDFBuffer(rowsRaw, nombreTercero, tipoMovimiento, rangoFechas) {
  const emisor = await obtenerEmisor();

  const [fechaInicio, fechaFin] = (rangoFechas || '').split(' a ');
  // idtercero viene en rowsRaw (tu endpoint lo trae de vista_estado_cuenta)
  let idtercero = rowsRaw?.[0]?.idtercero;
  if (!idtercero) {
    // Fallback: buscar por nombre (no ideal, pero funcional)
    const [[t]] = await db.query(`SELECT idtercero FROM terceros WHERE nombre = ? LIMIT 1`, [
      nombreTercero
    ]);
    idtercero = t?.idtercero || 0;
  }

  const base = await buildDataForRange({ tipoMovimiento, idtercero, fechaInicio, fechaFin });

  const seen = new Set();
  const filas = base.rowsRange
    .filter((r) => String(r.tipo || '').toUpperCase() !== 'PP')
    .map((r) => {
      const fechaTxt = formatoFechaEcuador(r.fecha); // 👈 zona EC
      const t = String(r.tipo || '').toUpperCase();
      const numero = r.numero;
      let amount = 0,
        credits = 0,
        payment = 0;

      if (esCargo(t)) {
        if (t === 'F') {
          if (!seen.has(String(numero))) {
            // 👈 corregido (seen)
            amount = Number(r.valorTotal || 0);
            seen.add(String(numero));
          }
        } else {
          amount = Number(r.valorTotal || 0); // ND / SI
        }
      } else if (t === 'NC' || t === 'RT') {
        credits = Number(r.valorTotal || 0);
      } else if (t === 'PG') {
        payment = Number(r.valorTotal || 0); // 👈 PP ya NO
      }

      const baseDesc = (r.subcliente || '').trim();
      const descripcion = baseDesc; // 👈 sin "(PP)"

      return {
        fecha: fechaTxt,
        descripcion,
        invoice: t === 'F' ? String(numero || '') : '',
        amount,
        credits,
        payment
      };
    });

  // ✅ Ageing correcto por factura (cargos - abonos aplicados a cada factura)
  const ageing = await getAgeing(tipoMovimiento, idtercero, fechaFin);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });
    const buffers = [];
    doc.on('data', (b) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    try {
      const head = drawHeaderPortrait(doc, emisor, {
        titulo: 'ACCOUNT STATEMENT',
        cliente: base.clientePrincipal || nombreTercero || '---',
        fechaAsOf: formatoFechaEcuador(fechaFin) // 👈 zona EC
      });

      const saldoFinal = renderTablaPortrait(
        doc,
        filas,
        base.saldoInicial,
        ageing,
        emisor,
        {
          yStart: head.yStart,
          amountBox: head.amountBox,
          cliente: base.clientePrincipal || nombreTercero || '---',
          asOf: formatoFechaEcuador(fechaFin) // 👈 zona EC
        },
        base.totalAnticipo
      );

      const amountDueTxt =
        saldoFinal < 0 ? `- $ ${fmt2(Math.abs(saldoFinal))}` : `$ ${fmt2(saldoFinal)}`;
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(amountDueTxt, head.amountBox.x, head.amountBox.y + 7, {
          width: head.amountBox.w,
          align: 'center'
        });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/* ======================= Facturas pendientes (snapshot) ======================= */

async function buildDataPendientes({ tipoMovimiento, idtercero, fechaFin }) {
  const ids = await getIdsGrupo(tipoMovimiento, idtercero);
  const inIds = ids.map(() => '?').join(',');

  // Todas las facturas/tipos que generan saldo (hasta la fecha de corte)
  const [facturas] = await db.query(
    `
    SELECT fc.id,
           fc.fecha,
           fc.numero_factura,
           fc.tipoDocumento,
           COALESCE(fc.valorTotal,0) AS valorTotal,
           t.nombre AS subcliente
      FROM factura_consolidada fc
      JOIN terceros t ON t.idtercero = fc.idcliente
     WHERE fc.tipoMovimiento = ?
       AND fc.idcliente IN (${inIds})
       AND fc.estado <> 'proceso'
       AND fc.tipoDocumento IN ('F','SI','ND')
       AND fc.fecha <= ?
     ORDER BY fc.fecha, fc.numero_factura
    `,
    [tipoMovimiento, ...ids, fechaFin]
  );

  // Si no hay facturas, devolvemos estructura vacía
  if (!facturas.length) {
    const ageingVacio = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };

    // Nombre cliente principal (misma lógica que buildDataForRange)
    let clientePrincipal = '---';
    try {
      const [[cli]] = await db.query(
        `SELECT idcliente_padre, nombre FROM terceros WHERE idtercero = ? LIMIT 1`,
        [idtercero]
      );
      const principalId = cli?.idcliente_padre || idtercero;
      const [[p]] = await db.query(`SELECT nombre FROM terceros WHERE idtercero = ? LIMIT 1`, [
        principalId
      ]);
      clientePrincipal = p?.nombre || cli?.nombre || '---';
    } catch {}

    const totalAnticipo = await getTotalAnticipo(tipoMovimiento, ids, fechaFin);

    return {
      filas: [],
      ageing: ageingVacio,
      totales: { amount: 0, credits: 0, payment: 0, balance: 0 },
      totalAnticipo,
      clientePrincipal
    };
  }

  const facturaIds = facturas.map((f) => Number(f.id));
  const phFact = facturaIds.map(() => '?').join(',');

  // Pagos / notas / retenciones aplicados a esas facturas hasta la fecha de corte
  const [aplicados] = await db.query(
    `
    SELECT pf.idfactura,
           COALESCE(SUM(
             CASE WHEN p.tipoDocumento IN ('NC','RT') THEN pf.valorpago ELSE 0 END
           ),0) AS credits,
           COALESCE(SUM(
             CASE WHEN p.tipoDocumento = 'PG' THEN pf.valorpago ELSE 0 END
           ),0) AS payments,
           COALESCE(SUM(pf.valorpago),0) AS aplicado
      FROM pagos_factura pf
      JOIN pagos p ON p.idpago = pf.idpago
     WHERE p.tipoMovimiento = ?
       AND p.idtercero IN (${inIds})
       AND p.fecha <= ?
       AND p.tipoDocumento IN ('PG','NC','RT','PP')
       AND pf.idfactura IN (${phFact})
  GROUP BY pf.idfactura
    `,
    [tipoMovimiento, ...ids, fechaFin, ...facturaIds]
  );

  const mapaAplicados = new Map();
  for (const r of aplicados) {
    mapaAplicados.set(Number(r.idfactura), {
      credits: Number(r.credits || 0),
      payments: Number(r.payments || 0),
      aplicado: Number(r.aplicado || 0)
    });
  }

  const filas = [];
  const ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const fin = asDate(fechaFin) || new Date();

  let tAmount = 0,
    tCredits = 0,
    tPayment = 0,
    tBalance = 0;

  for (const fc of facturas) {
    const ap = mapaAplicados.get(Number(fc.id)) || {
      credits: 0,
      payments: 0,
      aplicado: 0
    };

    const cargo = Number(fc.valorTotal || 0);
    const pendiente = cargo - ap.aplicado;

    // Solo dejamos facturas con saldo pendiente > 0
    if (pendiente <= 0.001) continue;

    // Ageing por días
    const f = asDate(fc.fecha) || fin;
    const dd = Math.floor((fin - f) / (1000 * 60 * 60 * 24));
    if (dd <= 30) ageing.d0_30 += pendiente;
    else if (dd <= 60) ageing.d31_60 += pendiente;
    else if (dd <= 90) ageing.d61_90 += pendiente;
    else ageing.d90p += pendiente;

    filas.push({
      fecha: formatoFechaEcuador(fc.fecha),
      descripcion: (fc.subcliente || '').trim(),
      invoice: String(fc.numero_factura || ''),
      amount: cargo,
      credits: ap.credits,
      payment: ap.payments,
      balance: pendiente
    });

    tAmount += cargo;
    tCredits += ap.credits;
    tPayment += ap.payments;
    tBalance += pendiente;
  }

  // Cliente principal
  let clientePrincipal = '---';
  try {
    const [[cli]] = await db.query(
      `SELECT idcliente_padre, nombre FROM terceros WHERE idtercero = ? LIMIT 1`,
      [idtercero]
    );
    const principalId = cli?.idcliente_padre || idtercero;
    const [[p]] = await db.query(`SELECT nombre FROM terceros WHERE idtercero = ? LIMIT 1`, [
      principalId
    ]);
    clientePrincipal = p?.nombre || cli?.nombre || '---';
  } catch {}

  const totalAnticipo = await getTotalAnticipo(tipoMovimiento, ids, fechaFin);

  return {
    filas,
    ageing,
    totales: {
      amount: tAmount,
      credits: tCredits,
      payment: tPayment,
      balance: tBalance
    },
    totalAnticipo,
    clientePrincipal
  };
}

/* =================== Tabla snapshot: solo facturas pendientes =================== */

function renderTablaPendientesPortrait(doc, filas, ageing, emisor, meta, totalAnticipo = 0) {
  const fmtMoney = (n = 0) => (Number(n) < 0 ? `- $ ${fmt2(Math.abs(n))}` : `$ ${fmt2(n)}`);

  const startX = doc.page.margins.left;
  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = meta.yStart;

  // Layout columnas (idéntico al actual)
  const wDate = 58,
    wInv = 56,
    wAmt = 65,
    wCre = 65,
    wPay = 65,
    wDue = 66;
  const fixedSum = wDate + wInv + wAmt + wCre + wPay + wDue;
  const wDesc = Math.max(120, contentW - fixedSum);
  const rowH = 20;

  const cols = [
    { key: 'fecha', label: 'DATE', w: wDate, align: 'left' },
    { key: 'descripcion', label: 'DESCRIPTION', w: wDesc, align: 'left' },
    { key: 'invoice', label: 'INVOICE', w: wInv, align: 'left' },
    { key: 'amount', label: 'AMOUNT', w: wAmt, align: 'right' },
    { key: 'credits', label: 'CREDITS', w: wCre, align: 'right' },
    { key: 'payment', label: 'PAYMENT', w: wPay, align: 'right' },
    { key: 'balance', label: 'BALANCE\nDUE', w: wDue, align: 'right' }
  ];

  const totalW = contentW;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 60;

  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(9);
    let x = startX;
    cols.forEach((c) => {
      const labelY = y + (c.label.includes('\n') ? 2 : 6);
      doc.rect(x, y, c.w, rowH).fill('#eaeaea');
      doc.fillColor('black').text(c.label, x + 4, labelY, { width: c.w - 8, align: 'center' });
      x += c.w;
    });
    y += rowH;
    doc
      .moveTo(startX, y)
      .lineTo(startX + totalW, y)
      .lineWidth(0.8)
      .strokeColor('#222')
      .stroke();
  };

  const ensureSpace = (need) => {
    if (y + need > bottomLimit) {
      doc.addPage({ size: 'A4', layout: 'portrait', margin: 40 });
      const head = drawHeaderPortrait(doc, emisor, {
        titulo: 'OPEN INVOICES',
        cliente: meta.cliente,
        fechaAsOf: meta.asOf
      });
      meta.yStart = head.yStart;
      meta.amountBox = head.amountBox;
      y = head.yStart;
      drawHeader();
    }
  };

  drawHeader();

  let tAmount = 0,
    tCredits = 0,
    tPayment = 0,
    tBalance = 0;

  filas.forEach((r) => {
    ensureSpace(rowH);

    let x = startX;
    doc.font('Helvetica').fontSize(9);

    cols.forEach((c) => {
      let v = r[c.key];
      if (['amount', 'credits', 'payment', 'balance'].includes(c.key) && v !== '') {
        v = fmt2(v);
      }
      doc.text(String(v ?? ''), x + 4, y + 3, { width: c.w - 8, align: c.align });
      x += c.w;
    });

    doc
      .moveTo(startX, y + rowH)
      .lineTo(startX + totalW, y + rowH)
      .lineWidth(0.4)
      .strokeColor('#bbb')
      .stroke();

    tAmount += Number(r.amount || 0);
    tCredits += Number(r.credits || 0);
    tPayment += Number(r.payment || 0);
    tBalance += Number(r.balance || 0);

    y += rowH;
  });

  // Totales
  ensureSpace(rowH);
  doc.font('Helvetica-Bold').fontSize(10);
  let x = startX;
  const tot = {
    fecha: '',
    descripcion: 'TOTALS',
    invoice: '',
    amount: fmt2(tAmount),
    credits: fmt2(tCredits),
    payment: fmt2(tPayment),
    balance: fmt2(tBalance)
  };
  cols.forEach((c) => {
    doc.text(String(tot[c.key] ?? ''), x + 4, y + 4, { width: c.w - 8, align: c.align });
    x += c.w;
  });
  doc
    .moveTo(startX, y)
    .lineTo(startX + totalW, y)
    .lineWidth(0.8)
    .strokeColor('#222')
    .stroke();
  doc
    .moveTo(startX, y + rowH)
    .lineTo(startX + totalW, y + rowH)
    .lineWidth(0.8)
    .strokeColor('#222')
    .stroke();
  y += rowH + 12;

  /* Anticipo y Balance neto */
  const anticipo = Number(totalAnticipo || 0);
  const saldoBalance = Number(tBalance || 0) - anticipo;

  doc
    .moveTo(startX, y + 6)
    .lineTo(startX + totalW, y + 6)
    .strokeColor('#e6e6e6')
    .stroke();

  const labelW = 120,
    valueW = 150,
    rowSmall = 18;
  const xLabel = startX;
  const xValue = startX + totalW - valueW;

  doc
    .font('Helvetica')
    .fontSize(10)
    .text('Anticipo', xLabel, y + 10, { width: labelW, align: 'left' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(fmtMoney(anticipo), xValue, y + 10, { width: valueW, align: 'right' });
  y += rowSmall;

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('Balance', xLabel, y + 2, { width: labelW, align: 'left' });
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(fmtMoney(saldoBalance), xValue, y + 2, { width: valueW, align: 'right' });
  y += rowSmall + 8;

  /* Resumen antigüedad (igual al actual) */
  const ageingBoxW = totalW;
  const colsAge = [
    { key: 'd0_30', label: '0–30 días' },
    { key: 'd31_60', label: '31–60 días' },
    { key: 'd61_90', label: '61–90 días' },
    { key: 'd90p', label: '> 90 días' }
  ];
  const aw = ageingBoxW / colsAge.length;
  const ah = 22;

  if (y + ah * 2 + 40 > bottomLimit) {
    doc.addPage({ size: 'A4', layout: 'portrait', margin: 40 });
    const head = drawHeaderPortrait(doc, emisor, {
      titulo: 'OPEN INVOICES',
      cliente: meta.cliente,
      fechaAsOf: meta.asOf
    });
    meta.yStart = head.yStart;
    meta.amountBox = head.amountBox;
    y = head.yStart;
  }

  doc.font('Helvetica-Bold').fontSize(10).text('RESUMEN ANTIGÜEDAD DE SALDOS', startX, y);
  y += 8;

  doc.font('Helvetica-Bold').fontSize(9);
  for (let i = 0; i < colsAge.length; i++) {
    doc.rect(startX + i * aw, y, aw, ah).fill('#eaeaea');
    doc
      .fillColor('black')
      .text(colsAge[i].label, startX + i * aw + 4, y + 4, { width: aw - 8, align: 'center' });
  }
  y += ah;

  doc.font('Helvetica').fontSize(10);
  for (let i = 0; i < colsAge.length; i++) {
    const v = fmt2(ageing[colsAge[i].key] || 0);
    doc
      .rect(startX + i * aw, y, aw, ah)
      .strokeColor('#cfcfcf')
      .stroke();
    doc.text(v, startX + i * aw + 4, y + 4, { width: aw - 8, align: 'center' });
  }
  y += ah;

  return Number(saldoBalance || 0);
}

/* ================== Generador SOLO PENDIENTES (stream HTTP) ================== */

async function generarEstadoCuentaPendientePDFStream({ idtercero, tipoMovimiento, fechaFin, res }) {
  const emisor = await obtenerEmisor();

  // Si no te mandan fechaFin, usamos hoy
  const corte = fechaFin || new Date().toISOString().slice(0, 10);

  const base = await buildDataPendientes({ tipoMovimiento, idtercero, fechaFin: corte });

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });

  const filename = makeFilename(base.clientePrincipal, corte).replace(
    '_EstadoDeCuenta',
    '_FacturasPendientes'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const head = drawHeaderPortrait(doc, emisor, {
    titulo: 'OPEN INVOICES',
    cliente: base.clientePrincipal,
    fechaAsOf: formatoFechaEcuador(corte)
  });

  const saldoFinal = renderTablaPendientesPortrait(
    doc,
    base.filas,
    base.ageing,
    emisor,
    {
      yStart: head.yStart,
      amountBox: head.amountBox,
      cliente: base.clientePrincipal,
      asOf: formatoFechaEcuador(corte)
    },
    base.totalAnticipo
  );

  const amountDueTxt =
    saldoFinal < 0 ? `- $ ${fmt2(Math.abs(saldoFinal))}` : `$ ${fmt2(saldoFinal)}`;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(amountDueTxt, head.amountBox.x, head.amountBox.y + 7, {
      width: head.amountBox.w,
      align: 'center'
    });

  doc.end();
}

/* ================== Versión buffer (para correo) – pendientes ================== */

async function generarEstadoCuentaPendientePDFBuffer(
  rowsRaw,
  nombreTercero,
  tipoMovimiento,
  fechaCorte
) {
  const emisor = await obtenerEmisor();
  const corte = fechaCorte || new Date().toISOString().slice(0, 10);

  let idtercero = rowsRaw?.[0]?.idtercero;
  if (!idtercero) {
    const [[t]] = await db.query(`SELECT idtercero FROM terceros WHERE nombre = ? LIMIT 1`, [
      nombreTercero
    ]);
    idtercero = t?.idtercero || 0;
  }

  const base = await buildDataPendientes({ tipoMovimiento, idtercero, fechaFin: corte });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });
    const buffers = [];
    doc.on('data', (b) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    try {
      const head = drawHeaderPortrait(doc, emisor, {
        titulo: 'OPEN INVOICES',
        cliente: base.clientePrincipal || nombreTercero || '---',
        fechaAsOf: formatoFechaEcuador(corte)
      });

      const saldoFinal = renderTablaPendientesPortrait(
        doc,
        base.filas,
        base.ageing,
        emisor,
        {
          yStart: head.yStart,
          amountBox: head.amountBox,
          cliente: base.clientePrincipal || nombreTercero || '---',
          asOf: formatoFechaEcuador(corte)
        },
        base.totalAnticipo
      );

      const amountDueTxt =
        saldoFinal < 0 ? `- $ ${fmt2(Math.abs(saldoFinal))}` : `$ ${fmt2(saldoFinal)}`;
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(amountDueTxt, head.amountBox.x, head.amountBox.y + 7, {
          width: head.amountBox.w,
          align: 'center'
        });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  generarEstadoCuentaPDFStream,
  generarEstadoCuentaPDFBuffer,
  generarEstadoCuentaPendientePDFStream,
  generarEstadoCuentaPendientePDFBuffer
};
