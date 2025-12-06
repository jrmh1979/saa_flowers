// utils/generarPrepackingPorCodigo.js
const PDFDocument = require('pdfkit');
const db = require('../db');

// --------------------------------- helpers ---------------------------------
function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

const FACTOR_FULL = { QB: 0.25, HB: 0.5, FB: 1, EB: 1 };
const safe = (v, d = '') => (v === null || v === undefined ? d : String(v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const fmtInt = (v) => (v === null || v === undefined ? '' : String(Math.round(Number(v) || 0)));
const fmtDec = (v, n = 2) => (v === null || v === undefined ? '' : Number(v).toFixed(n));

function inferUnitBun(producto = '', variedad = '') {
  const t = `${producto} ${variedad}`.toLowerCase();
  if (t.includes('spray')) return 10;
  return 25;
}

function colStarts(x, widths) {
  const xs = [x];
  for (let i = 1; i < widths.length; i++) xs[i] = xs[i - 1] + widths[i - 1];
  return xs;
}

// Altura dinámica de fila: FARM + DESCRIPTION envuelven (wrap)
function measureRowHeight(doc, widths, row) {
  const base = 12; // altura mínima por fila
  const farm = String(row.proveedor ?? '');
  const desc = `${row.producto ?? ''} ${row.variedad ?? ''} ${row.longitud ?? ''}`.trim();

  doc.font('Helvetica').fontSize(9);
  const farmH = Math.ceil(doc.heightOfString(farm, { width: widths[2] - 4 }));
  const descH = Math.ceil(doc.heightOfString(desc, { width: widths[3] - 4 }));
  return Math.max(base, farmH, descH) + 2; // +2 de aire inferior
}

// ------------------------------- data queries ------------------------------
async function getHeader(idfactura) {
  const [rows] = await db.query(
    `
    SELECT 
      f.id AS idfactura,
      DATE_FORMAT(f.fecha, '%d/%m/%Y') AS fecha,
      c.nombre AS cliente,
      f.awb AS awb,
      carg.valor AS airline
    FROM factura_consolidada f
    LEFT JOIN terceros        c    ON c.idtercero = f.idcliente
    LEFT JOIN catalogo_simple carg ON carg.id      = f.idcarguera
    WHERE f.id = ? 
    LIMIT 1
    `,
    [idfactura]
  );
  return rows?.[0] || {};
}

async function getDetallePorCodigos(idfactura, codigos) {
  if (!Array.isArray(codigos) || codigos.length === 0) return [];
  const inPlaceholders = codigos.map(() => '?').join(',');
  const params = [idfactura, ...codigos];

  const [rows] = await db.query(
    `
    SELECT 
      d.codigo,
      d.cantidad,
      d.tallos,
      COALESCE(d.\`cantidadTallos\`, d.cantidad * d.tallos) AS totaltallos,
      tc.valor      AS caja,                -- QB/HB/FB
      prov.nombre   AS proveedor,           -- FARM
      prod.valor    AS producto,
      var.valor     AS variedad,
      lon.valor     AS longitud,
      d.documento_proveedor AS inv_number,  -- # INV
      d.idpedido                         AS idpedido       -- # BOX
    FROM factura_consolidada_detalle d
    LEFT JOIN catalogo_simple tc   ON tc.id = d.idtipocaja
    LEFT JOIN terceros        prov ON prov.idtercero = d.idproveedor
    LEFT JOIN catalogo_simple prod ON prod.id = d.idproducto
    LEFT JOIN catalogo_simple var  ON var.id  = d.idvariedad
    LEFT JOIN catalogo_simple lon  ON lon.id  = d.idlongitud
    WHERE d.idfactura = ?
      AND d.cantidad > 0
      AND d.codigo IN (${inPlaceholders})
    ORDER BY d.codigo, prov.nombre, prod.valor, var.valor, lon.valor
    `,
    params
  );

  return rows.map((r) => ({
    codigo: safe(r.codigo),
    caja: safe(r.caja),
    cantidad: num(r.cantidad),
    proveedor: safe(r.proveedor),
    producto: safe(r.producto),
    variedad: safe(r.variedad),
    longitud: safe(r.longitud),
    tallos: num(r.tallos),
    totaltallos: num(r.totaltallos),
    invNumber: safe(r.inv_number), // # INV
    idpedido: safe(r.idpedido) // # BOX
  }));
}

// ------------------------------- PDF drawing -------------------------------
function drawHeader(doc, header, codeLabel = '') {
  const L = 36,
    R = 559;

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('J VAN VLIET', L, 38, { width: R - L, align: 'center' });

  // línea bajo el título
  doc.moveTo(L, 58).lineTo(R, 58).stroke();

  // Datos generales (9pt)
  doc.font('Helvetica').fontSize(9);
  const y = 66;
  doc.text(`Predespacho No.: ${header.idfactura ?? ''}`, L, y);
  doc.text(`Date : ${header.fecha ?? ''}`, R - 200, y, { width: 200, align: 'left' });

  doc.text(`J VAN VLIET BLOEMENEXPORT`, L, y + 12);
  doc.text(`Airline : ${header.airline ?? ''}`, R - 200, y + 12, { width: 200, align: 'left' });

  doc.text(`Matriz`, L, y + 24);
  doc.text(`AWB : ${header.awb ?? ''}`, R - 200, y + 24, { width: 200, align: 'left' });

  // Código grande y en negrita
  const codeY = y + 36;
  const label = 'Code : ';
  const labelW = doc.widthOfString(label);
  doc.font('Helvetica').fontSize(9).text(label, L, codeY);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(String(codeLabel || ''), L + labelW + 2, codeY);

  // Obs
  doc
    .font('Helvetica')
    .fontSize(9)
    .text('Obs :', R - 200, codeY, { width: 200, align: 'left' });
}

function drawTableHeader(doc, x, y, widths) {
  const headers = ['BOX', 'PCS', 'FARM', 'DESCRIPTION', 'U/B', 'BUN', 'QTY', '# INV', '# BOX'];
  const xs = colStarts(x, widths);
  const totalW = widths.reduce((a, b) => a + b, 0);

  doc.save();
  doc.rect(x, y - 2, totalW, 16).fill('#F2F2F2');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
  for (let i = 0; i < headers.length; i++) {
    const centerThese = new Set(['U/B', 'BUN', 'QTY', 'PCS', '# BOX']);
    const align = centerThese.has(headers[i]) ? 'center' : 'left';
    doc.text(headers[i], xs[i] + 2, y, { width: widths[i] - 4, align });
  }
  doc.restore();
}

function drawRow(doc, x, y, widths, row, rowH) {
  const unitBun = inferUnitBun(row.producto, row.variedad);
  const qty = row.totaltallos || row.cantidad * row.tallos;
  const bunch = unitBun ? Math.round(qty / unitBun) : 0;
  const desc = `${row.producto} ${row.variedad} ${row.longitud}`.trim();
  const xs = colStarts(x, widths);

  const vals = [
    row.caja, // BOX
    fmtDec(row.cantidad, 2), // PCS
    row.proveedor, // FARM (wrap)
    desc, // DESCRIPTION (wrap)
    fmtInt(unitBun), // U/B
    fmtInt(bunch), // BUN
    fmtInt(qty), // QTY
    row.invNumber || '', // # INV
    row.idpedido || '' // # BOX
  ];

  // Alineaciones: U/B, BUN, QTY centradas; PCS a la derecha; #BOX centrado
  const aligns = ['left', 'left', 'left', 'left', 'center', 'center', 'center', 'left', 'center'];

  doc.font('Helvetica').fontSize(9);

  // Columnas que envuelven: FARM (idx 2) y DESCRIPTION (idx 3)
  for (let i = 0; i < vals.length; i++) {
    const options = { width: widths[i] - 4, align: aligns[i], height: rowH };
    const isWrap = i === 2 || i === 3;
    const text = String(vals[i] ?? '');
    if (isWrap) {
      doc.text(text, xs[i] + 2, y, options); // PDFKit envuelve automáticamente
    } else {
      doc.text(text, xs[i] + 2, y, options);
    }
  }

  const factor = FACTOR_FULL[row.caja?.toUpperCase()] ?? 1;
  return { pieces: num(row.cantidad), fulls: num(row.cantidad) * factor, bunch, qty };
}

function drawSubtotalsLine(doc, x, y, widths, totals) {
  const xs = colStarts(x, widths);
  const totalW = widths.reduce((a, b) => a + b, 0);

  doc.save();
  doc.rect(x, y - 2, totalW, 16).fill('#F2F2F2');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
  const beforeBunchWidth = widths[0] + widths[1] + widths[2] + widths[3] + widths[4];
  doc.text('Totales :', x + 4, y, { width: beforeBunchWidth - 8, align: 'left' });
  doc.text(String(fmtInt(totals.bunch)), xs[5] + 2, y, { width: widths[5] - 4, align: 'center' });
  doc.text(String(fmtInt(totals.qty)), xs[6] + 2, y, { width: widths[6] - 4, align: 'center' });
  doc.restore();
}

function drawBottomTotals(doc, left, y, totals, firmaNombre = 'Dario Orozco') {
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Pieces :  ${totals.pieces.toFixed(2)}`, left, y);
  doc.text(`Fulls  :  ${totals.fulls.toFixed(2)}`, left, y + 14);
  doc.text(`Totales :`, left + 300, y);

  doc.text(`Total Fulls  :  ${totals.fulls.toFixed(2)}`, left, y + 32);
  doc.text(`Total Piezas :  ${totals.pieces.toFixed(2)}`, left, y + 46);

  // línea sobre la firma
  const lineX1 = left + 300;
  const lineX2 = left + 520;
  const lineY = y + 56;
  doc.moveTo(lineX1, lineY).lineTo(lineX2, lineY).stroke();

  doc.font('Helvetica').text(firmaNombre, left + 300, y + 58, { width: 220, align: 'center' });
}

// ------------------------------------ main ---------------------------------
async function generarPrepackingPorCodigo({ idfactura, codigos }) {
  const header = await getHeader(idfactura);
  const detalle = await getDetallePorCodigos(idfactura, codigos);

  // Agrupar por código
  const groups = new Map();
  for (const r of detalle) {
    if (!groups.has(r.codigo)) groups.set(r.codigo, []);
    groups.get(r.codigo).push(r);
  }

  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const bufferPromise = streamToBuffer(doc);

  let firstPage = true;
  for (const [codigo, rows] of groups.entries()) {
    if (!firstPage) doc.addPage();
    firstPage = false;

    drawHeader(doc, header, codigo);

    const left = 30,
      top = 140;
    // [BOX, PCS, FARM, DESCRIPTION, U/B, BUN, QTY, # INV, # BOX]
    const widths = [30, 34, 100, 160, 36, 36, 46, 59, 30]; // total ≈ 531
    let y = top;

    drawTableHeader(doc, left, y, widths);
    y += 18;

    const totals = { pieces: 0, fulls: 0, bunch: 0, qty: 0 };
    const pageBottom = 720;

    for (const r of rows) {
      const rowH = measureRowHeight(doc, widths, r);

      if (y + rowH > pageBottom) {
        drawSubtotalsLine(doc, left, y, widths, totals);
        doc.addPage();
        drawHeader(doc, header, codigo);
        y = top;
        drawTableHeader(doc, left, y, widths);
        y += 18;
      }

      const inc = drawRow(doc, left, y, widths, r, rowH);
      totals.pieces += num(inc.pieces);
      totals.fulls += num(inc.fulls);
      totals.bunch += num(inc.bunch);
      totals.qty += num(inc.qty);

      y += rowH; // avance según la altura calculada
    }

    y += 4;
    drawSubtotalsLine(doc, left, y, widths, totals);
    y += 24;

    drawBottomTotals(doc, left, y, totals);
  }

  doc.end();
  return bufferPromise;
}

module.exports = { generarPrepackingPorCodigo };
