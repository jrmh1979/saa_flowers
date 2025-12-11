const PDFDocument = require('pdfkit');
const db = require('../db');

/* ----------------------------- Helpers ----------------------------- */
function fmtDateYMD(val) {
  if (!val) return '';
  try {
    const d = val instanceof Date ? val : new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    const s = String(val);
    const m = s.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : s.slice(0, 10);
  } catch {
    return String(val).slice(0, 10);
  }
}
const FACTOR_FULLS = {
  FB: 1,
  HB: 0.5,
  '1/2HB': 0.5,
  QB: 0.25,
  EB: 0.125,
  SB: 0.0625 // 1/16
};

function abreviarCaja(valorTipocaja = '') {
  const s = String(valorTipocaja || '').toUpperCase();
  if (s.includes('1/2HB')) return '1/2HB';
  if (s.includes('EB')) return 'EB';
  if (s.includes('HB')) return 'HB';
  if (s.includes('QB')) return 'QB';
  if (s.includes('FB')) return 'FB';
  return s || '-';
}
const fmtInt = (n) => String(Number(n || 0));
const fmtDec = (n, d = 2) => Number(n || 0).toFixed(d);
const safe = (v) => (v === null || v === undefined ? '' : String(v));

const CELL_PAD_X = 2;
const CELL_PAD_Y = 2;
const LINE_GAP = 1;

// fuentes/alturas del DETALLE
const FS = { detail: 8 };
const ROW_MIN_H = 14;

function measureTextH(doc, text, width, align = 'left', font = 'Helvetica', size = 9) {
  doc.font(font).fontSize(size);
  const w = Math.max(1, width - CELL_PAD_X * 2);
  return doc.heightOfString(safe(text), { width: w, align, lineGap: LINE_GAP });
}

// Normaliza bloques multi-línea desde un solo input (Enter | '\n' | '|')
function normalizeMultiline(raw) {
  let s = safe(raw);
  if (!s) return '';
  s = s.replace(/\\n/g, '\n'); // '\n' literal => salto real
  s = s.split('|').join('\n'); // pipes => salto
  return s;
}

// Catálogo por id
async function getCatalogoValor(id) {
  if (!id) return '';
  const [rows] = await db.query('SELECT valor FROM catalogo_simple WHERE id = ? LIMIT 1', [id]);
  return rows?.[0]?.valor || '';
}

// Catálogo por equivalencia (para país destino)
async function getCatalogoValorByEquivalencia(equivalencia) {
  if (equivalencia === null || equivalencia === undefined || equivalencia === '') return '';
  const [rows] = await db.query(
    'SELECT valor FROM catalogo_simple WHERE equivalencia = ? LIMIT 1',
    [String(equivalencia).trim()]
  );
  return rows?.[0]?.valor || '';
}

// Mostrar/ocultar RUC desde sri_emisor
function shouldShowRuc(emisor) {
  const v =
    emisor.mostrar_ruc ?? emisor.show_ruc ?? emisor.mostrar_ruc_invoice ?? emisor.show_ruc_invoice;
  if (v === undefined || v === null) return true;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'sí' || s === 'si';
}

// Dirección del emisor en 2 líneas (Enter, '\n' o '|')
function getEmisorAddressLines(emisor) {
  let raw = safe(emisor.dir_matriz || '').trim();
  if (!raw) return ['', ''];
  raw = raw.replace(/\\n/g, '\n');
  let parts = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')];
  parts = raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')];
  const idx = raw.lastIndexOf(',');
  if (idx > -1) return [raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()];
  return [raw, ''];
}

/* ----------------------------- Consultas ---------------------------- */
async function obtenerCabeceraFactura(idfactura) {
  const [rows] = await db.query(
    `SELECT f.*,
            cli.idtercero               AS id_cli,
            cli.nombre                  AS cliente,
            cli.direccion               AS cliente_direccion,
            cli.idcliente_padre         AS id_cliente_padre,
            cli.idpais                  AS idpais,
            cli.codsino                 AS codsino,      -- AÑADIDO
            padre.nombre                AS cliente_padre
       FROM factura_consolidada f
       LEFT JOIN terceros cli   ON cli.idtercero = f.idcliente
       LEFT JOIN terceros padre ON padre.idtercero = cli.idcliente_padre
     WHERE f.id = ? LIMIT 1`,
    [idfactura]
  );
  return rows[0] || null;
}

async function obtenerDetalleFactura(idfactura) {
  const [rows] = await db.query(
    `SELECT d.*,
            p.valor AS producto,
            p.equivalencia AS producto_codigo,
            v.valor AS variedad,
            l.valor AS longitud,
            e.valor AS empaque,
            t.valor AS tipocaja,
            pr.nombre AS proveedor,
            pr.codigotercero AS proveedor_codigo
       FROM factura_consolidada_detalle d
       LEFT JOIN catalogo_simple p ON p.id = d.idproducto
       LEFT JOIN catalogo_simple v ON v.id = d.idvariedad
       LEFT JOIN catalogo_simple l ON l.id = d.idlongitud
       LEFT JOIN catalogo_simple e ON e.id = d.idempaque
       LEFT JOIN catalogo_simple t ON t.id = d.idtipocaja
       LEFT JOIN terceros pr        ON pr.idtercero = d.idproveedor
     WHERE d.idfactura = ?
     ORDER BY d.iddetalle ASC`,
    [idfactura]
  );
  return rows;
}

async function obtenerEmisor() {
  const [rows] = await db.query(`SELECT * FROM sri_emisor LIMIT 1`);
  if (!rows.length) {
    return {
      razon_social: '',
      nombre_comercial: '',
      ruc: '',
      dir_matriz: '',
      telefono: '',
      email: '',
      logo_base64: null,
      mostrar_ruc: 1,
      mensaje_invoice: '',
      datos_bancarios: ''
    };
  }
  const r = rows[0];
  // asegurar defaults si las columnas se agregaron recientemente
  r.mensaje_invoice = r.mensaje_invoice || '';
  r.datos_bancarios = r.datos_bancarios || '';
  return r;
}

/* ----------------------- Construcción de datos ---------------------- */
function buildProductoMostrar(codigo, variedad) {
  const c = (codigo || '').toString().trim();
  const v = (variedad || '').toString().trim();
  return [c, v]
    .filter(Boolean)
    .map((s) => s.toUpperCase())
    .join('-');
}

// agrupa por idmix y marca límites de grupo
function prepararMixtas(detalles) {
  const byMix = new Map(); // idmix -> [iddetalle...]
  for (const d of detalles) {
    if (!d.idmix) continue;
    const k = String(d.idmix);
    if (!byMix.has(k)) byMix.set(k, []);
    byMix.get(k).push(d.iddetalle);
  }
  const bounds = new Map(); // idmix -> {min,max}
  for (const [k, arr] of byMix) bounds.set(k, { min: Math.min(...arr), max: Math.max(...arr) });
  return { bounds };
}

function computeSummary(filas, { codsino } = {}) {
  const byFarm = new Map();
  let totHB = 0,
    totQB = 0,
    totEB = 0,
    totSB = 0,
    totFulls = 0,
    totStems = 0,
    totPieces = 0;

  for (const r of filas) {
    // Mostrar FARM según flag (siempre incluyendo guia_master)
    const shown = codsino
      ? [r.proveedor_codigo || '-', r.guia_master].filter(Boolean).join(' / ')
      : [r.proveedor || '-', r.guia_master].filter(Boolean).join(' / ');

    const farm = shown;
    const pieces = Number(r._piecesCount || 0);
    const stems = Number(r.cantidadTallos || 0);
    const bt = (r.tipocajaA || '').toUpperCase();
    const fulls = Number(r._fullsCount || 0);

    if (!byFarm.has(farm)) {
      byFarm.set(farm, {
        pieces: 0,
        stems: 0,
        hb: 0,
        qb: 0,
        eb: 0,
        sb: 0,
        fulls: 0
      });
    }
    const acc = byFarm.get(farm);

    acc.pieces += pieces;
    acc.stems += stems;
    acc.fulls += fulls;

    // Conteos por tipo de caja
    if (bt.startsWith('HB') || bt === '1/2HB') {
      acc.hb += pieces;
      totHB += pieces;
    } else if (bt.startsWith('QB')) {
      acc.qb += pieces;
      totQB += pieces;
    } else if (bt.startsWith('EB')) {
      acc.eb += pieces;
      totEB += pieces;
    } else if (bt.startsWith('SB')) {
      acc.sb += pieces;
      totSB += pieces;
    }

    totPieces += pieces;
    totStems += stems;
    totFulls += fulls;
  }

  return {
    rows: Array.from(byFarm.entries()).map(([farm, s]) => ({ farm, ...s })),
    totals: { totHB, totQB, totEB, totSB, totPieces, totStems, totFulls }
  };
}

/* ---------------------- Utilidades de tabla/grilla ------------------ */
const COLUMN_KEYS = [
  'pcode',
  'prov',
  'box',
  'tipo',
  'prod',
  'grade',
  'stmbch',
  'ramos',
  'stems',
  'unit',
  'amount',
  'marked'
];
function columnBoundaries(startX, w) {
  const xs = [startX];
  let cx = startX;
  for (const k of COLUMN_KEYS) {
    cx += w[k];
    xs.push(cx);
  }
  return xs;
}
function drawVerticalGrid(doc, xs, yTop, yBottom, color = '#888', width = 0.8) {
  doc.save().strokeColor(color).lineWidth(width);
  xs.forEach((x) => doc.moveTo(x, yTop).lineTo(x, yBottom).stroke());
  doc.restore();
}
function drawH(doc, x1, x2, y, color = '#999', width = 0.7) {
  doc.save().strokeColor(color).lineWidth(width).moveTo(x1, y).lineTo(x2, y).stroke().restore();
}

/* --------------------------- Dibujo: detalle ------------------------ */
function drawTableHeader(doc, x, y, w) {
  doc.font('Helvetica-Bold').fontSize(9);
  const headers = [
    ['Farm', w.pcode, 'center'],
    ['Exp.', w.prov, 'center'],
    ['Box', w.box, 'center'],
    ['Box Type', w.tipo, 'center'],
    ['Variedad', w.prod, 'center'],
    ['Grade', w.grade, 'center'],
    ['Stm / Bch', w.stmbch, 'center'],
    ['Total Bch', w.ramos, 'center'],
    ['Total Stems', w.stems, 'center'],
    ['Unit Price', w.unit, 'center'],
    ['Exp Price', w.amount, 'center'],
    ['Boxes Marked As:', w.marked, 'center']
  ];

  const headerH =
    Math.max(
      14,
      ...headers.map(([label, ww, align]) =>
        measureTextH(doc, label, ww, align, 'Helvetica-Bold', 9)
      )
    ) +
    CELL_PAD_Y * 2;

  // una línea arriba + una abajo (sin doble línea)
  drawH(doc, x, 559, y - 2, '#666', 0.8);
  drawH(doc, x, 559, y + headerH, '#666', 0.8);

  let cx = x;
  headers.forEach(([label, ww, align]) => {
    doc.text(label, cx + CELL_PAD_X, y + CELL_PAD_Y, { width: ww - CELL_PAD_X * 2, align });
    cx += ww;
  });

  const xs = columnBoundaries(x, w);
  drawVerticalGrid(doc, xs, y - 2, y + headerH, '#666', 0.8);

  return headerH;
}

function getRowHeight(doc, w, r) {
  const up = (s) => safe(s).toUpperCase();
  const ramos = Number(r.totalRamos || 0);
  const stems = Number(r.cantidadTallos || 0);
  const stmBch = ramos > 0 ? stems / ramos : 0;

  doc.font('Helvetica').fontSize(FS.detail);

  const hPcode = measureTextH(
    doc,
    up(r._suppressLeft ? '' : r.proveedor_codigo || ''),
    w.pcode,
    'center',
    'Helvetica',
    FS.detail
  );
  const hProv = measureTextH(
    doc,
    up(r._suppressLeft ? '' : r._expText || ''),
    w.prov,
    'left',
    'Helvetica',
    FS.detail
  );
  const hBox = measureTextH(
    doc,
    r._suppressLeft ? '' : fmtInt(r.cantidad),
    w.box,
    'center',
    'Helvetica',
    FS.detail
  );
  const hTipo = measureTextH(
    doc,
    r._suppressLeft ? '' : safe(r.tipocajaA || ''),
    w.tipo,
    'center',
    'Helvetica',
    FS.detail
  );
  const hProd = measureTextH(
    doc,
    up(r.productoMostrar || r.producto || ''),
    w.prod,
    'left',
    'Helvetica',
    FS.detail
  );
  const hGrade = measureTextH(
    doc,
    safe(r.longitud || ''),
    w.grade,
    'center',
    'Helvetica',
    FS.detail
  );
  const hStmB = measureTextH(doc, fmtDec(stmBch, 0), w.stmbch, 'center', 'Helvetica', FS.detail);
  const hRamos = measureTextH(doc, fmtInt(ramos), w.ramos, 'right', 'Helvetica', FS.detail);
  const hStems = measureTextH(doc, fmtInt(stems), w.stems, 'right', 'Helvetica', FS.detail);
  const hUnit = measureTextH(
    doc,
    fmtDec(r.precio_venta || 0, 2),
    w.unit,
    'right',
    'Helvetica',
    FS.detail
  );
  const hAmt = measureTextH(doc, fmtDec(r.monto, 2), w.amount, 'right', 'Helvetica', FS.detail);
  const hMark = measureTextH(
    doc,
    r._suppressLeft ? '' : safe(r.codigo || ''),
    w.marked,
    'left',
    'Helvetica',
    FS.detail
  );

  return (
    Math.max(
      ROW_MIN_H,
      hPcode,
      hProv,
      hBox,
      hTipo,
      hProd,
      hGrade,
      hStmB,
      hRamos,
      hStems,
      hUnit,
      hAmt,
      hMark
    ) +
    CELL_PAD_Y * 2
  );
}

function drawRow(doc, x, y, w, r) {
  const up = (s) => safe(s).toUpperCase();
  const ramos = Number(r.totalRamos || 0);
  const stems = Number(r.cantidadTallos || 0);
  const stmBch = ramos > 0 ? stems / ramos : 0;

  const rowH = getRowHeight(doc, w, r);

  let cx = x;
  const print = (val, ww, align = 'left') =>
    doc.text(val, cx + CELL_PAD_X, y + CELL_PAD_Y, { width: ww - CELL_PAD_X * 2, align });

  doc.font('Helvetica').fontSize(FS.detail);

  print(up(r._suppressLeft ? '' : r.proveedor_codigo || ''), w.pcode, 'center');
  cx += w.pcode;
  print(up(r._suppressLeft ? '' : r._expText || ''), w.prov, 'left');
  cx += w.prov;
  print(r._suppressLeft ? '' : fmtInt(r.cantidad), w.box, 'center');
  cx += w.box;
  print(r._suppressLeft ? '' : safe(r.tipocajaA || ''), w.tipo, 'center');
  cx += w.tipo;
  print(up(r.productoMostrar || r.producto || ''), w.prod, 'left');
  cx += w.prod;
  print(safe(r.longitud || ''), w.grade, 'center');
  cx += w.grade;
  print(fmtDec(stmBch, 0), w.stmbch, 'center');
  cx += w.stmbch;
  print(fmtInt(ramos), w.ramos, 'right');
  cx += w.ramos;
  print(fmtInt(stems), w.stems, 'right');
  cx += w.stems;
  print(fmtDec(r.precio_venta || 0, 2), w.unit, 'right');
  cx += w.unit;
  print(fmtDec(r.monto, 2), w.amount, 'right');
  cx += w.amount;
  print(r._suppressLeft ? '' : safe(r.codigo || ''), w.marked, 'left');

  const xs = columnBoundaries(x, w);
  drawVerticalGrid(doc, xs, y, y + rowH, '#999', 0.7);

  return rowH;
}

/* ------------------------- Encabezado 50% / 45% -------------------- */
function drawHeaderBlock(doc, emisor, cab, { carguera, paisDestino }) {
  const LEFT = 36,
    RIGHT = 559;
  const W = RIGHT - LEFT; // 523
  const W_EMISOR = Math.floor(W * 0.5); // 50%
  const W_RIGHT = Math.floor(W * 0.45); // 45%
  const top = 36;

  // Emisor (logo dentro)
  const emX = LEFT,
    emW = W_EMISOR,
    emH = 98;
  doc.roundedRect(emX, top, emW, emH, 2).stroke();

  const raw = emisor.logo_base64 || '';
  const base64 = raw.includes('base64,') ? raw.split('base64,')[1] : raw;
  let logoW = 0;
  if (base64) {
    try {
      const buf = Buffer.from(base64, 'base64');
      doc.image(buf, emX + 8, top + 12, { fit: [60, 60] });
      logoW = 68;
    } catch {}
  }
  const nombre = emisor.nombre_comercial || emisor.razon_social || '';
  const [adr1, adr2] = getEmisorAddressLines(emisor);
  const tel = emisor.telefono ? `T: ${emisor.telefono}` : '';
  const mail = emisor.email || '';

  // ... dentro de drawHeaderBlock ...

  const tx = emX + 8 + logoW,
    tw = emW - 16 - logoW;
  let lineY = top + 8;

  // Nombre comercial
  doc.font('Helvetica-Bold').fontSize(12).text(nombre, tx, lineY, { width: tw });
  lineY += 16;

  // RUC
  if (shouldShowRuc(emisor) && emisor.ruc) {
    doc.font('Helvetica').fontSize(9).text(`RUC: ${emisor.ruc}`, tx, lineY, { width: tw });
    lineY += 12;
  }

  // --- CORRECCIÓN DE DIRECCIÓN (Punto 1) ---
  doc.font('Helvetica').fontSize(9); // Seteamos fuente para medir

  // Dirección línea 1 (Calculamos altura dinámica)
  const hAdr1 = doc.heightOfString(adr1, { width: tw });
  doc.text(adr1, tx, lineY, { width: tw });
  lineY += hAdr1 + 2; // Sumamos la altura real + un pequeño margen

  // Dirección línea 2 (si existe)
  if (adr2) {
    const hAdr2 = doc.heightOfString(adr2, { width: tw });
    doc.text(adr2, tx, lineY, { width: tw });
    lineY += hAdr2 + 2;
  }
  // ------------------------------------------

  if (tel) {
    doc.text(tel, tx, lineY, { width: tw });
    lineY += 12;
  }
  if (mail) {
    doc.text(mail, tx, lineY, { width: tw });
    lineY += 12;
  }

  // ... resto de la función ...
  // INVOICE No / SHIPPING DATE (alineados)
  const numBoxW = 130,
    numBoxH = 26;
  const rightLabelX = RIGHT - W_RIGHT;
  const numBoxX = RIGHT - numBoxW;

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('INVOICE No.', rightLabelX, top + 4, {
      width: numBoxX - rightLabelX - 8,
      align: 'right'
    });
  doc.roundedRect(numBoxX, top, numBoxW, numBoxH, 3).stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(String(safe(cab.numero_factura || cab.id)), numBoxX, top + 6, {
      width: numBoxW,
      align: 'center'
    });

  const dateTop = top + numBoxH + 8;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('SHIPPING DATE :', rightLabelX, dateTop + 4, {
      width: numBoxX - rightLabelX - 8,
      align: 'right'
    });
  doc.roundedRect(numBoxX, dateTop, numBoxW, numBoxH, 3).stroke();
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(fmtDateYMD(cab.fecha), numBoxX, dateTop + 6, { width: numBoxW, align: 'center' });

  // MARK/ADDRESS/PORT (sin líneas internas), única línea antes de CONSIGNED TO
  const markX = RIGHT - W_RIGHT;
  const markW = W_RIGHT;
  let yCur = top + numBoxH * 2 + 20;

  const outerTop = yCur - 2;
  let outerBottom;

  const writeRow = (label, value) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`${label} :`, markX + 6, yCur);
    const h = Math.max(12, measureTextH(doc, value, markW - 96, 'left', 'Helvetica', 9));
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(safe(value || ''), markX + 90, yCur, { width: markW - 96 });
    yCur += h;
  };

  writeRow('MARK', cab.cliente || '');
  writeRow('ADDRESS', cab.cliente_direccion || '');
  writeRow('PORT OF DESTINY', paisDestino || '');

  const sepY = yCur + 2;
  drawH(doc, markX + 1, markX + markW - 1, sepY, '#999', 0.6);
  yCur = sepY + 4;

  writeRow('CONSIGNED TO', cab.cliente_padre || cab.cliente || '');

  outerBottom = yCur + 4;
  doc.rect(markX, outerTop, markW, outerBottom - outerTop).stroke();

  // AWB + CARGO AGENCY (50%)
  const awbTop = top + 98 + 8;
  const halfOfEmitter = W_EMISOR / 2;
  const cellH = 22;
  doc.rect(LEFT, awbTop, halfOfEmitter, cellH).stroke();
  doc.rect(LEFT + halfOfEmitter, awbTop, halfOfEmitter, cellH).stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('AWB', LEFT, awbTop + 4, { width: halfOfEmitter, align: 'center' })
    .text('CARGO AGENCY', LEFT + halfOfEmitter, awbTop + 4, {
      width: halfOfEmitter,
      align: 'center'
    });
  doc.rect(LEFT, awbTop + cellH, halfOfEmitter, cellH).stroke();
  doc.rect(LEFT + halfOfEmitter, awbTop + cellH, halfOfEmitter, cellH).stroke();
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(safe(cab.awb || ''), LEFT, awbTop + cellH + 4, { width: halfOfEmitter, align: 'center' })
    .text(safe(carguera || ''), LEFT + halfOfEmitter, awbTop + cellH + 4, {
      width: halfOfEmitter,
      align: 'center'
    });

  return Math.max(awbTop + cellH * 2, outerBottom) + 8;
}

/* --------------------------- Dibujo: SUMMARY ----------------------- */
function drawSummary(doc, filas, startY, { codsino } = {}) {
  const { rows, totals } = computeSummary(filas, { codsino });

  let y = startY + 8;
  const x = 36;

  doc.font('Helvetica-Bold').fontSize(9).text('SUMMARY :', x, y);
  y += 10;

  // Anchos de columnas
  const w = {
    farm: 160,
    pieces: 60,
    stems: 80,
    hb: 35,
    qb: 35,
    eb: 35,
    sb: 35,
    fulls: 80
  };

  const cols = [
    { key: 'farm', label: 'FARM', width: w.farm, align: 'center' },
    { key: 'pieces', label: 'PIECES', width: w.pieces, align: 'center' },
    { key: 'stems', label: 'STEMS', width: w.stems, align: 'center' },
    { key: 'hb', label: 'HB', width: w.hb, align: 'center' }, // 1º HB
    { key: 'qb', label: 'QB', width: w.qb, align: 'center' }, // 2º QB
    { key: 'eb', label: 'EB', width: w.eb, align: 'center' }, // 3º EB
    { key: 'sb', label: 'SB', width: w.sb, align: 'center' }, // 4º SB
    { key: 'fulls', label: 'TOTAL FULLS', width: w.fulls, align: 'center' }
  ];

  const rowH = 16;
  const headerH = 16;

  // Posiciones X de columnas
  const colX = [Math.round(x)];
  cols.forEach((c, i) => colX.push(Math.round(colX[i] + c.width)));

  const tableLeft = colX[0];
  const tableRight = colX[colX.length - 1];
  const tableTop = Math.round(y);

  // Header
  doc.font('Helvetica-Bold').fontSize(9);
  cols.forEach((c, i) => {
    doc.text(c.label, colX[i] + 2, tableTop + 3, { width: c.width - 4, align: 'center' });
  });

  // Filas
  let cursorY = tableTop + headerH;
  doc.font('Helvetica').fontSize(9);
  rows.forEach((r) => {
    doc.text(r.farm, colX[0] + 2, cursorY + 3, { width: w.farm - 4, align: 'left' });
    doc.text(String(r.pieces), colX[1] + 2, cursorY + 3, { width: w.pieces - 4, align: 'center' });
    doc.text(String(r.stems), colX[2] + 2, cursorY + 3, { width: w.stems - 4, align: 'center' });
    doc.text(String(r.hb || 0), colX[3] + 2, cursorY + 3, { width: w.hb - 4, align: 'center' });
    doc.text(String(r.qb || 0), colX[4] + 2, cursorY + 3, { width: w.qb - 4, align: 'center' });
    doc.text(String(r.eb || 0), colX[5] + 2, cursorY + 3, { width: w.eb - 4, align: 'center' });
    doc.text(String(r.sb || 0), colX[6] + 2, cursorY + 3, { width: w.sb - 4, align: 'center' });
    doc.text(Number(r.fulls).toFixed(3), colX[7] + 2, cursorY + 3, {
      width: w.fulls - 4,
      align: 'center'
    });
    cursorY += rowH;
  });

  // Totales
  doc.font('Helvetica-Bold');
  doc.text('', colX[0] + 2, cursorY + 3, { width: w.farm - 4, align: 'left' });
  doc.text(String(totals.totPieces), colX[1] + 2, cursorY + 3, {
    width: w.pieces - 4,
    align: 'center'
  });
  doc.text(String(totals.totStems), colX[2] + 2, cursorY + 3, {
    width: w.stems - 4,
    align: 'center'
  });
  doc.text(String(totals.totHB), colX[3] + 2, cursorY + 3, { width: w.hb - 4, align: 'center' });
  doc.text(String(totals.totQB), colX[4] + 2, cursorY + 3, { width: w.qb - 4, align: 'center' });
  doc.text(String(totals.totEB), colX[5] + 2, cursorY + 3, { width: w.eb - 4, align: 'center' });
  doc.text(String(totals.totSB), colX[6] + 2, cursorY + 3, { width: w.sb - 4, align: 'center' });
  doc.text(Number(totals.totFulls).toFixed(3), colX[7] + 2, cursorY + 3, {
    width: w.fulls - 4,
    align: 'center'
  });

  const tableBottom = Math.round(cursorY + rowH);

  // Trazo de la grilla
  doc.save().lineWidth(0.8).strokeColor('#000');
  doc.moveTo(tableLeft, tableTop).lineTo(tableRight, tableTop);
  doc.moveTo(tableLeft, tableTop + headerH).lineTo(tableRight, tableTop + headerH);

  let yLine = tableTop + headerH;
  for (let i = 0; i < rows.length + 1; i++) {
    yLine += rowH;
    doc.moveTo(tableLeft, yLine).lineTo(tableRight, yLine);
  }

  colX.forEach((cx) => {
    doc.moveTo(cx, tableTop).lineTo(cx, tableBottom);
  });

  doc.stroke().restore();

  return { yEnd: tableBottom + 10, totals };
}

/* ------------------------- PDF principal --------------------------- */
async function generarPdfInvoice(idfactura) {
  const [cab, emisor] = await Promise.all([obtenerCabeceraFactura(idfactura), obtenerEmisor()]);
  if (!cab) throw new Error('Factura no encontrada');

  const detalles = await obtenerDetalleFactura(idfactura);
  const carguera = await getCatalogoValor(cab.idcarguera);
  const paisDestino = await getCatalogoValorByEquivalencia(cab.idpais);

  const codsino = Number(cab.codsino || 0) === 1; // 1 => usar codigotercero/guia_master

  const { bounds } = prepararMixtas(detalles);

  const filas = detalles.map((d) => {
    const tipoA = abreviarCaja(d.tipocaja || d.tipocaja_texto);
    const factor = FACTOR_FULLS[tipoA] || 0;
    const esRamoFlag = d.esramo === 1 || d.esramo === '1' || d.esramo === true;

    const isMix = !!d.idmix;
    const b = isMix ? bounds.get(String(d.idmix)) : null;
    const isStart = isMix ? d.iddetalle === b.min : true;
    const isEnd = isMix ? d.iddetalle === b.max : true;

    const isPrimary = !isMix || isStart;
    const piecesCount = isPrimary ? Number(d.cantidad || 0) : 0;
    const fullsCount = isPrimary ? Number(d.cantidad || 0) * factor : 0;

    const precioVenta = Number(d.precio_venta || 0);
    const stems = Number(d.cantidadTallos || 0);
    const totalRamos = Number(d.totalRamos || 0);
    const baseVenta = esRamoFlag ? totalRamos : stems;
    const monto = baseVenta * precioVenta;

    const productoMostrar = buildProductoMostrar(d.producto_codigo, d.variedad);

    // Texto para columna Exp.: siempre el NOMBRE del exportador (terceros.nombre)
    const expText = d.proveedor || '';

    return {
      ...d,
      tipocajaA: tipoA,
      _isMix: isMix,
      _mixStart: isStart,
      _mixEnd: isEnd,
      _suppressLeft: isMix && !isStart,
      _piecesCount: piecesCount,
      _fullsCount: fullsCount,
      fulls: fullsCount,
      monto,
      productoMostrar,
      _expText: expText
    };
  });

  const totales = filas.reduce(
    (acc, r) => {
      acc.ramos += Number(r.totalRamos || 0);
      acc.stems += Number(r.cantidadTallos || 0);
      acc.amount += Number(r.monto || 0);
      return acc;
    },
    { ramos: 0, stems: 0, amount: 0 }
  );

  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Encabezado
  const afterHeaderY = drawHeaderBlock(doc, emisor, cab, { carguera, paisDestino });

  /* Tabla de detalle */
  const startX = 36;
  let y = afterHeaderY + 8;

  const widths = {
    pcode: 28,
    prov: 78,
    box: 20,
    tipo: 26,
    prod: 115,
    grade: 29,
    stmbch: 28,
    ramos: 28,
    stems: 50,
    unit: 34,
    amount: 40,
    marked: 47
  };

  const headerH = drawTableHeader(doc, startX, y, widths);
  y += headerH;

  const bottomLimit = 760;

  for (let i = 0; i < filas.length; i++) {
    const r = filas[i];
    const rowH = getRowHeight(doc, widths, r);

    if (y + rowH > bottomLimit) {
      doc.addPage();
      const yAfterHeader = drawHeaderBlock(doc, emisor, cab, { carguera, paisDestino });
      y = yAfterHeader + 8;
      const hh = drawTableHeader(doc, startX, y, widths);
      y += hh;
    }

    const drawnH = drawRow(doc, startX, y, widths, r);

    // línea horizontal SOLO al final del grupo (mixta) o para filas normales
    if (r._mixEnd) drawH(doc, startX, 559, y + drawnH, '#999', 0.7);

    y += drawnH;
  }

  if (y + 40 > bottomLimit) {
    doc.addPage();
    const yAfterHeader = drawHeaderBlock(doc, emisor, cab, { carguera, paisDestino });
    y = yAfterHeader + 8;
  }

  y += 8;

  // Fila TOTALS (alineada con las columnas)
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('TOTALS', startX, y, {
      width:
        widths.pcode +
        widths.prov +
        widths.box +
        widths.tipo +
        widths.prod +
        widths.grade +
        widths.stmbch,
      align: 'right'
    })
    .text(
      fmtInt(totales.ramos),
      startX +
        widths.pcode +
        widths.prov +
        widths.box +
        widths.tipo +
        widths.prod +
        widths.grade +
        widths.stmbch,
      y,
      { width: widths.ramos, align: 'right' }
    )
    .text(
      fmtInt(totales.stems),
      startX +
        widths.pcode +
        widths.prov +
        widths.box +
        widths.tipo +
        widths.prod +
        widths.grade +
        widths.stmbch +
        widths.ramos,
      y,
      { width: widths.stems, align: 'right' }
    )
    .text(
      fmtDec(totales.amount, 2),
      startX +
        widths.pcode +
        widths.prov +
        widths.box +
        widths.tipo +
        widths.prod +
        widths.grade +
        widths.stmbch +
        widths.ramos +
        widths.stems +
        widths.unit,
      y,
      { width: widths.amount, align: 'right' }
    );

  y += 18;

  // SUMMARY
  const { yEnd: summaryEnd } = drawSummary(doc, filas, y, { codsino });
  y = summaryEnd + 12; // margen extra para que NO se monte el texto

  /* ----------------------- Mensaje y datos bancarios ----------------------- */
  const blockWidth = 520;
  const pageBottom = 800; // umbral seguro para salto de página

  const nota = normalizeMultiline(emisor.mensaje_invoice);
  if (nota) {
    const hNota = doc.heightOfString(nota, { width: blockWidth, lineGap: 1 });
    if (y + hNota > pageBottom) {
      doc.addPage();
      y = 60;
    }
    doc.font('Helvetica').fontSize(8).text(nota, 36, y, { width: blockWidth, lineGap: 1 });
    y += hNota + 10;
  }

  const bank = normalizeMultiline(emisor.datos_bancarios);
  if (bank) {
    const hBankTitle = 10;
    const hBank = doc.heightOfString(bank, { width: blockWidth, lineGap: 1 });
    if (y + hBankTitle + hBank > pageBottom) {
      doc.addPage();
      y = 60;
    }
    doc.font('Helvetica-Bold').fontSize(10).text('BANK INFORMATION', 36, y);
    y += 12;
    doc.font('Helvetica').fontSize(9).text(bank, 36, y, { width: blockWidth, lineGap: 1 });
    y += hBank + 6;
  }

  doc.end();

  const buffer = await done;
  const base64 = buffer.toString('base64');
  return { buffer, base64, totales };
}

module.exports = { generarPdfInvoice };
