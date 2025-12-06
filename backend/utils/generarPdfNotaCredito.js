// utils/generarPdfNotaCredito.js
const PDFDocument = require('pdfkit');
const db = require('../db');
const fs = require('fs');
const path = require('path');
const { formatoFechaEcuador } = require('./fechaEcuador');

const fmt2 = (n) => Number(n || 0).toFixed(2);
const safe = (s) => (s == null ? '' : String(s));

/* ============================== Emisor ============================== */

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

function drawHeaderNotaCredito(doc, emisor, { ncNumero, fechaNC }) {
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
    } catch {
      // ignoramos error de imagen
    }
  }

  const nombre = emisor.nombre_comercial || emisor.razon_social || '';
  const dir = emisor.dir_matriz || '';
  const tel = emisor.telefono ? `T: ${emisor.telefono}` : '';
  const mail = emisor.email || '';
  const infoX = mL + 90;

  // Info empresa
  doc.font('Helvetica-Bold').fontSize(12).text(nombre, infoX, top);
  doc
    .font('Helvetica')
    .fontSize(9)
    .text(dir, infoX, top + 16, { width: 330 })
    .text([tel, mail].filter(Boolean).join('  '), infoX, doc.y);

  // Título documento
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('REPORTE DE NOTA DE CRÉDITO', 0, top, { align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`NC # ${ncNumero}`, { align: 'right' });
  doc.text(`Fecha NC: ${fechaNC}`, { align: 'right' });

  // Línea separadora
  const lineY = top + 70;
  doc
    .moveTo(mL, lineY)
    .lineTo(doc.page.width - mR, lineY)
    .lineWidth(0.5)
    .strokeColor('#bbb')
    .stroke();
  doc.strokeColor('#000').lineWidth(1);

  // Posición inicial de contenido
  doc.y = lineY + 10;
}

/* ============================== Data SQL ============================== */

async function buildDataNotaCredito({ idpago, proveedorId = null }) {
  // Cabecera NC (incluimos flete / otros / crédito cliente)
  const [[pago]] = await db.query(
    `SELECT
       p.idpago,
       p.tipoMovimiento,
       p.fecha,
       p.valor,
       p.observaciones,
       p.tipoDocumento,
       p.nc_flete,
       p.nc_otros,
       p.nc_credito_items,
       t.idtercero,
       t.nombre AS terceroNombre
     FROM pagos p
     JOIN terceros t ON t.idtercero = p.idtercero
    WHERE p.idpago = ?
    LIMIT 1`,
    [idpago]
  );
  if (!pago) throw new Error('Pago NC no encontrado');

  const idpagoCliente = idpago;

  // Facturas afectadas
  const [facCli] = await db.query(
    `SELECT fc.id, fc.numero_factura, SUM(pf.valorpago) AS aplicado
       FROM pagos_factura pf
       JOIN factura_consolidada fc ON fc.id = pf.idfactura
      WHERE pf.idpago = ?
      GROUP BY fc.id, fc.numero_factura
      ORDER BY fc.fecha, fc.id`,
    [idpagoCliente]
  );

  // Detalle NC + nombres de catálogo
  const [detRaw] = await db.query(
    `
    SELECT
      cnd.id                      AS id_nc_detalle,
      cnd.iddetalle_consolidada   AS iddetalle_consolidada,
      cnd.proveedor_id,
      tp.nombre                   AS proveedorNombre,
      cnd.motivo,
      cnd.monto,
      cnd.producto,
      cnd.variedad,
      cnd.longitud,
      cnd.tallos_reclamo,
      COALESCE(d.cantidadTallos, d.tallos, 0) AS cantidad_tallos,
      d.subtotal,
      d.documento_proveedor,
      d.idproducto,
      d.idvariedad,
      d.idlongitud,
      d.precio_unitario,
      cp.valor AS productoCatalogo,
      cv.valor AS variedadCatalogo,
      cl.valor AS longitudCatalogo
    FROM cartera_nc_detalle cnd
    JOIN factura_consolidada_detalle d
      ON d.iddetalle = cnd.iddetalle_consolidada
    LEFT JOIN terceros tp
      ON tp.idtercero = cnd.proveedor_id
    LEFT JOIN catalogo_simple cp
      ON cp.id = d.idproducto
    LEFT JOIN catalogo_simple cv
      ON cv.id = d.idvariedad
    LEFT JOIN catalogo_simple cl
      ON cl.id = d.idlongitud
    WHERE cnd.idpago = ?
    ORDER BY tp.nombre, d.documento_proveedor, cnd.id
    `,
    [idpagoCliente]
  );

  const detFiltrado = proveedorId
    ? detRaw.filter((r) => Number(r.proveedor_id) === Number(proveedorId))
    : detRaw;

  // Fotos
  const idsNcDet = detFiltrado.map((r) => r.id_nc_detalle);
  let fotos = [];
  if (idsNcDet.length) {
    const [f] = await db.query(
      `SELECT id_nc_detalle, ruta, nombre_archivo
         FROM cartera_nc_foto
        WHERE id_nc_detalle IN (?)`,
      [idsNcDet]
    );
    fotos = f || [];
  }

  const fotosByDetalle = new Map();
  for (const f of fotos) {
    const arr = fotosByDetalle.get(f.id_nc_detalle) || [];
    arr.push(f);
    fotosByDetalle.set(f.id_nc_detalle, arr);
  }

  // Resumen proveedor
  const provAgg = new Map();
  let totalCredito = 0;
  for (const r of detFiltrado) {
    totalCredito += Number(r.monto || 0);
    const prov = Number(r.proveedor_id || 0);
    const p = provAgg.get(prov) || { nombre: safe(r.proveedorNombre), total: 0 };
    p.total += Number(r.monto || 0);
    provAgg.set(prov, p);
  }

  return {
    pago,
    facCli,
    detFiltrado,
    fotosByDetalle,
    provAgg,
    totalCredito
  };
}

/* ============================== Render ============================== */

function renderNotaCredito(doc, emisor, data, { lado }) {
  const { pago, facCli, detFiltrado, fotosByDetalle } = data;

  const fechaNC = formatoFechaEcuador(pago.fecha);

  // lado efectivo
  const ladoEff = (lado || pago.tipoMovimiento || '').toString().toUpperCase();

  // ===== Header =====
  drawHeaderNotaCredito(doc, emisor, {
    ncNumero: pago.idpago,
    fechaNC
  });

  const mL = doc.page.margins.left;
  const mR = doc.page.margins.right;
  const contentWidth = doc.page.width - mL - mR;

  const flete = Number(pago.nc_flete || 0);
  const otros = Number(pago.nc_otros || 0);
  const creditoCliente = Number(pago.nc_credito_items || 0);
  const totalNC = pago.valor != null ? Number(pago.valor || 0) : creditoCliente + flete + otros;

  /* -------- Datos de la NC -------- */
  doc.x = mL;
  doc.font('Helvetica-Bold').fontSize(11).text('Datos de la nota de crédito');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(9);
  doc.text(`NC #: ${pago.idpago}`, { width: contentWidth });
  doc.text(`Fecha: ${fechaNC}`, { width: contentWidth });
  doc.text(`Tipo: ${safe(pago.tipoDocumento || 'NC')}`, { width: contentWidth });
  doc.text(`Lado: ${ladoEff}`, { width: contentWidth });
  doc.text(`Actor: ${safe(pago.terceroNombre)} (ID ${pago.idtercero})`, { width: contentWidth });

  // 👉 SOLO para CLIENTE mostramos "Valor registrado"
  if (ladoEff !== 'P') {
    doc.text(`Valor registrado: $ ${fmt2(totalNC)}`, { width: contentWidth });
  }

  doc.text(`Observaciones: ${safe(pago.observaciones) || '—'}`, {
    width: contentWidth
  });

  /* -------- Facturas + Resumen cliente SOLO si NO es proveedor -------- */
  if (ladoEff !== 'P') {
    doc.moveDown();
    doc.x = mL;
    doc.font('Helvetica-Bold').fontSize(11).text('Facturas del cliente afectadas');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9);

    if (!facCli.length) {
      doc.text('No hay facturas asociadas a esta nota de crédito.', {
        width: contentWidth
      });
    } else {
      let totalAplicado = 0;
      for (const f of facCli) {
        totalAplicado += Number(f.aplicado || 0);
        doc.text(`• Factura ${safe(f.numero_factura)} — Crédito aplicado: $ ${fmt2(f.aplicado)}`, {
          width: contentWidth
        });
      }
      doc.moveDown(0.2);
      doc
        .font('Helvetica-Bold')
        .text(`Total crédito aplicado al cliente: $ ${fmt2(totalAplicado)}`, {
          width: contentWidth
        });
    }

    // Resumen de valores del lado cliente
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).text('Resumen valores (cliente)', {
      width: contentWidth
    });
    doc.font('Helvetica').fontSize(9);
    doc.text(`Crédito ítems: $ ${fmt2(creditoCliente)}`, { width: contentWidth });
    doc.text(`Flete: $ ${fmt2(flete)}`, { width: contentWidth });
    doc.text(`Otros: $ ${fmt2(otros)}`, { width: contentWidth });
    doc.text(`Total NC cliente: $ ${fmt2(totalNC)}`, {
      width: contentWidth
    });
  }

  /* -------- Detalle en tabla por proveedor / documento -------- */
  doc.moveDown();
  doc.x = mL;
  doc.font('Helvetica-Bold').fontSize(11).text('Detalle por proveedor / documento');
  doc.moveDown(0.5);

  const tableWidth = doc.page.width - mL - mR;

  let totalReclamoGlobal = 0; // suma de columna "Total Reclamo" (para proveedor)
  const pageBottom = doc.page.height - doc.page.margins.bottom - 40;

  if (!detFiltrado.length) {
    doc.font('Helvetica').fontSize(9).text('No hay detalle registrado para esta nota de crédito.', {
      width: contentWidth
    });
  } else {
    // columnas tipo Excel
    const wProd = 110;
    const wVar = 150;
    const wLong = 40;
    const wTrec = 60;
    const wPrecio = 70;
    const wTotal = 80;

    const xProd = mL;
    const xVar = xProd + wProd;
    const xLong = xVar + wVar;
    const xTrec = xLong + wLong;
    const xPrecio = xTrec + wTrec;
    const xTotal = xPrecio + wPrecio;

    let y = doc.y;

    const ensureSpace = (needed) => {
      if (y + needed > pageBottom) {
        doc.addPage();
        y = doc.y;
      }
    };

    // Agrupar por proveedor + doc proveedor
    const grupos = new Map();
    for (const r of detFiltrado) {
      const key = `${Number(r.proveedor_id || 0)}::${safe(r.proveedorNombre)}::${safe(
        r.documento_proveedor
      )}`;
      if (!grupos.has(key)) {
        grupos.set(key, {
          proveedorId: r.proveedor_id,
          proveedorNombre: r.proveedorNombre,
          documento: r.documento_proveedor,
          rows: []
        });
      }
      grupos.get(key).rows.push(r);
    }

    for (const g of grupos.values()) {
      // Separador de sección
      ensureSpace(25);
      doc
        .moveTo(mL, y - 3)
        .lineTo(mL + tableWidth, y - 3)
        .lineWidth(0.5)
        .strokeColor('#ddd')
        .stroke();
      doc.strokeColor('#000').lineWidth(1);

      // Encabezado proveedor / doc
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(
        `${safe(g.proveedorNombre) || 'SIN PROVEEDOR'}${
          g.proveedorId ? ` (ID ${g.proveedorId})` : ''
        }`,
        mL,
        y
      );
      y = doc.y + 2;
      doc.font('Helvetica').fontSize(9);
      doc.text(`Doc. proveedor: ${safe(g.documento) || '—'}`, mL, y);
      y = doc.y + 4;

      // Encabezado de tabla
      doc.font('Helvetica-Bold').fontSize(8);
      const headerHeight = Math.max(
        doc.heightOfString('PRODUCTO', { width: wProd }),
        doc.heightOfString('VARIEDAD', { width: wVar }),
        doc.heightOfString('LONG', { width: wLong }),
        doc.heightOfString('T.RECLAMO', { width: wTrec }),
        doc.heightOfString('Precio Unitario', { width: wPrecio }),
        doc.heightOfString('Total Reclamo', { width: wTotal })
      );
      ensureSpace(headerHeight + 6);

      // fondo suave del header
      doc.save();
      doc.rect(xProd, y - 2, tableWidth, headerHeight + 4).fill('#f2f3f5');
      doc.restore();

      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('PRODUCTO', xProd + 2, y, { width: wProd - 4 });
      doc.text('VARIEDAD', xVar + 2, y, { width: wVar - 4 });
      doc.text('LONG', xLong, y, { width: wLong, align: 'center' });
      doc.text('T.RECLAMO', xTrec, y, { width: wTrec, align: 'right' });
      doc.text('Precio Unitario', xPrecio, y, { width: wPrecio, align: 'right' });
      doc.text('Total Reclamo', xTotal, y, { width: wTotal, align: 'right' });
      y += headerHeight + 6;

      // Filas
      doc.font('Helvetica').fontSize(8);
      let totalTallosReclamo = 0;
      let totalValorReclamo = 0;

      for (const r of g.rows) {
        const prodNombre = safe(r.productoCatalogo) || safe(r.producto) || safe(r.idproducto);
        const varNombre = safe(r.variedadCatalogo) || safe(r.variedad) || safe(r.idvariedad);
        const longNombre = safe(r.longitudCatalogo) || safe(r.longitud) || safe(r.idlongitud);

        const tallosReclamo = Number(r.tallos_reclamo || 0);
        const precioUnitario =
          r.precio_unitario != null
            ? Number(r.precio_unitario || 0)
            : r.cantidad_tallos
              ? Number(r.subtotal || 0) / Number(r.cantidad_tallos || 1)
              : 0;
        const totalReclamo = tallosReclamo * precioUnitario;

        totalTallosReclamo += tallosReclamo;
        totalValorReclamo += totalReclamo;

        const rowHeight = Math.max(
          doc.heightOfString(prodNombre, { width: wProd - 4 }),
          doc.heightOfString(varNombre, { width: wVar - 4 }),
          doc.heightOfString(longNombre, { width: wLong }),
          doc.heightOfString(String(tallosReclamo), { width: wTrec }),
          doc.heightOfString(fmt2(precioUnitario), { width: wPrecio }),
          doc.heightOfString(fmt2(totalReclamo), { width: wTotal })
        );

        ensureSpace(rowHeight + 6);

        doc.text(prodNombre, xProd + 2, y, { width: wProd - 4 });
        doc.text(varNombre, xVar + 2, y, { width: wVar - 4 });
        doc.text(longNombre, xLong, y, { width: wLong, align: 'center' });
        doc.text(String(tallosReclamo), xTrec, y, {
          width: wTrec,
          align: 'right'
        });
        doc.text(fmt2(precioUnitario), xPrecio, y, {
          width: wPrecio,
          align: 'right'
        });
        doc.text(fmt2(totalReclamo), xTotal, y, {
          width: wTotal,
          align: 'right'
        });

        y += rowHeight + 4;
      }

      // Fila de totales del grupo
      ensureSpace(16);
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('TOTALES', xProd + 2, y, { width: wProd + wVar + wLong - 4 });
      doc.text(String(totalTallosReclamo), xTrec, y, {
        width: wTrec,
        align: 'right'
      });
      doc.text(fmt2(totalValorReclamo), xTotal, y, {
        width: wTotal,
        align: 'right'
      });
      y += 16;

      // acumulamos al total global de reclamo (para el bloque final)
      totalReclamoGlobal += totalValorReclamo;
    }

    doc.y = y;
  }

  // ===== Resumen para PROVEEDOR (total Reclamo + flete + otros) =====
  const summaryWidth = 150;
  const xSummary = mL + tableWidth - summaryWidth;
  const lineHeight = doc.currentLineHeight();
  const summaryHeight = 4 * lineHeight + 8;
  let ySummary = doc.y + 6;

  if (ySummary + summaryHeight > pageBottom) {
    doc.addPage();
    ySummary = doc.page.margins.top;
  }

  const totalProveedor = totalReclamoGlobal + flete + otros;

  doc.font('Helvetica').fontSize(9);
  doc.text(`Total Reclamo: $ ${fmt2(totalReclamoGlobal)}`, xSummary, ySummary, {
    width: summaryWidth,
    align: 'right'
  });
  ySummary = doc.y;
  doc.text(`Flete: $ ${fmt2(flete)}`, xSummary, ySummary, {
    width: summaryWidth,
    align: 'right'
  });
  ySummary = doc.y;
  doc.text(`Otros: $ ${fmt2(otros)}`, xSummary, ySummary, {
    width: summaryWidth,
    align: 'right'
  });
  ySummary = doc.y;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text(`Total: $ ${fmt2(totalProveedor)}`, xSummary, ySummary, {
    width: summaryWidth,
    align: 'right'
  });

  // ===== Fotos: fuera de la tabla, después de totales =====
  const fotosOrdenadas = [];
  for (const r of detFiltrado) {
    const arr = fotosByDetalle.get(r.id_nc_detalle) || [];
    for (const foto of arr) fotosOrdenadas.push(foto);
  }

  if (fotosOrdenadas.length) {
    let yFotos = doc.y + 12;
    if (yFotos + 40 > pageBottom) {
      doc.addPage();
      yFotos = doc.page.margins.top;
    }

    // línea separadora
    doc
      .moveTo(mL, yFotos)
      .lineTo(mL + tableWidth, yFotos)
      .lineWidth(0.5)
      .strokeColor('#ddd')
      .stroke();
    doc.strokeColor('#000').lineWidth(1);
    yFotos += 6;

    doc.font('Helvetica-Bold').fontSize(10).text('Evidencia fotográfica', mL, yFotos);
    yFotos = doc.y + 4;

    const imgWidth = 150;
    const imgHeight = 110;
    const gap = 10;
    const perRow = 3;

    let col = 0;
    let xImg = mL;

    for (const foto of fotosOrdenadas) {
      try {
        const rutaRel = safe(foto.ruta);
        if (!rutaRel) continue;

        const absPath = path.join(__dirname, '..', rutaRel.replace(/^[\\/]+/, ''));
        if (!fs.existsSync(absPath)) continue;

        if (yFotos + imgHeight > pageBottom) {
          doc.addPage();
          yFotos = doc.page.margins.top;
          xImg = mL;
          col = 0;
        }

        doc.image(absPath, xImg, yFotos, {
          fit: [imgWidth, imgHeight]
        });

        col += 1;
        if (col >= perRow) {
          col = 0;
          xImg = mL;
          yFotos += imgHeight + gap;
        } else {
          xImg += imgWidth + gap;
        }
      } catch {
        // ignorar errores de imagen
      }
    }

    doc.y = yFotos + imgHeight + 4;
  }

  doc.moveDown(1.2);
  doc.font('Helvetica').fontSize(8).text('Generado por el sistema de Cartera', {
    align: 'right'
  });
}

/* ================= Stream (HTTP) ================= */

async function generarNotaCreditoPDFStream({ idpago, proveedorId = null, lado = 'C', res }) {
  const emisor = await obtenerEmisor();
  const data = await buildDataNotaCredito({ idpago, proveedorId });

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });

  const filename = `NC_${data.pago.idpago}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  doc.pipe(res);
  renderNotaCredito(doc, emisor, data, { lado });
  doc.end();
}

/* ================= Buffer (para correo) ================= */

async function generarNotaCreditoPDFBuffer({ idpago, proveedorId = null, lado = 'C' }) {
  const emisor = await obtenerEmisor();
  const data = await buildDataNotaCredito({ idpago, proveedorId });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });
    const buffers = [];
    doc.on('data', (b) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    try {
      renderNotaCredito(doc, emisor, data, { lado });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  generarNotaCreditoPDFStream,
  generarNotaCreditoPDFBuffer
};
