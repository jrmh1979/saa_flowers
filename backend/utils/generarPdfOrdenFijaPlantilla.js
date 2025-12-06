// backend/utils/generarPdfOrdenFijaPlantilla.js
const PDFDocument = require('pdfkit');
const db = require('../db');

const FACTOR_FULLS = { HB: 0.5, QB: 0.25, EB: 0.125, FB: 1, '1/2HB': 0.5 };

function abreviarCaja(valorTipocaja = '') {
  const s = String(valorTipocaja).toUpperCase();
  if (s.includes('1/2HB')) return '1/2HB';
  if (s.includes('EB')) return 'EB';
  if (s.includes('HB')) return 'HB';
  if (s.includes('QB')) return 'QB';
  if (s.includes('FB')) return 'FB';
  return s || '-';
}

const fmtInt = (n) => String(Number(n || 0));
const fmtDec = (n, d = 2) => Number(n || 0).toFixed(d);
const fmtMoney = (n) => Number(n || 0).toFixed(2); // ← para $

// Mantengo la misma firma que ya te funciona
module.exports = async function generarPdfOrdenFijaPlantilla({
  idfactura = null,
  orden_fija_id = null,
  id = null, // alias por compatibilidad
  idsProveedores = []
}) {
  return new Promise(async (resolve, reject) => {
    try {
      const isPlantilla = !!(orden_fija_id || id);
      const plantillaId = orden_fija_id || id || null;

      // ===== Cabecera =====
      let headerInfo = {
        id: idfactura,
        fecha: new Date(),
        clienteNombre: '---',
        cargueraNombre: '---',
        awb: null
      };

      if (!isPlantilla && idfactura) {
        const [[facturaInfo]] = await db.query(
          `
          SELECT 
            f.id, f.fecha, f.idcliente, f.idcarguera,
            c.valor AS cargueraNombre,
            cli.nombre AS clienteNombre,
            f.awb
          FROM factura_consolidada f
          LEFT JOIN catalogo_simple c 
            ON c.id = f.idcarguera AND c.categoria = 'carguera'
          LEFT JOIN terceros cli 
            ON cli.idtercero = f.idcliente AND cli.tipo = 'cliente'
          WHERE f.id = ?
        `,
          [idfactura]
        );
        if (facturaInfo) headerInfo = facturaInfo;
      }

      if (isPlantilla && plantillaId) {
        const [[plantilla]] = await db.query(
          `
          SELECT ofi.*, 
                 cli.nombre AS clienteNombre,
                 c.valor   AS cargueraNombre
          FROM orden_fija ofi
          LEFT JOIN terceros cli 
                 ON cli.idtercero = ofi.Idcliente AND cli.tipo='cliente'
          LEFT JOIN catalogo_simple c 
                 ON c.id = ofi.idcarguera AND c.categoria='carguera'
          WHERE ofi.id = ?
        `,
          [plantillaId]
        );
        if (!plantilla) throw new Error('Plantilla no encontrada');
        headerInfo = {
          id: plantilla.id,
          fecha: new Date(),
          clienteNombre: plantilla.clienteNombre || '---',
          cargueraNombre: plantilla.cargueraNombre || '---',
          awb: null
        };
      }

      // ===== Mapas legibles =====
      const mapa = { productos: {}, variedades: {}, longitudes: {}, tipocajas: {} };
      const [productos] = await db.query(
        "SELECT id, valor FROM catalogo_simple WHERE categoria='producto'"
      );
      const [variedades] = await db.query(
        "SELECT id, valor FROM catalogo_simple WHERE categoria='variedad'"
      );
      const [longitudes] = await db.query(
        "SELECT id, valor FROM catalogo_simple WHERE categoria='longitud'"
      );
      const [tipocajas] = await db.query(
        "SELECT id, valor FROM catalogo_simple WHERE categoria='tipocaja'"
      );
      productos.forEach((x) => (mapa.productos[x.id] = x.valor));
      variedades.forEach((x) => (mapa.variedades[x.id] = x.valor));
      longitudes.forEach((x) => (mapa.longitudes[x.id] = x.valor));
      tipocajas.forEach((x) => (mapa.tipocajas[x.id] = x.valor));

      // ===== Detalle =====
      let params = [];
      let detalleSql = '';
      if (!isPlantilla) {
        params = [idfactura];
        let filtroProv = '';
        if (idsProveedores?.length) {
          filtroProv = ` AND d.idproveedor IN (${idsProveedores.map(() => '?').join(',')}) `;
          params.push(...idsProveedores);
        }
        detalleSql = `
          SELECT 
            d.iddetalle, d.idfactura, d.idproveedor, p.nombre AS proveedorNombre,
            d.idproducto, d.idvariedad, d.idlongitud, d.idtipocaja,
            d.idempaque, emp.valor AS empaqueValor,
            d.cantidad, d.codigo,
            d.cantidadRamos, d.cantidadTallos,
            d.documento_proveedor AS documentoProveedor,
            d.idpedido,
            d.precio_unitario, d.subtotal
          FROM factura_consolidada_detalle d
          LEFT JOIN terceros p 
                 ON p.idtercero = d.idproveedor AND p.tipo='proveedor'
          LEFT JOIN catalogo_simple emp
                 ON emp.id = d.idempaque AND emp.categoria = 'empaque'
          WHERE d.idfactura = ? ${filtroProv}
          ORDER BY p.nombre, d.idtipocaja, d.idproducto, d.idvariedad, d.idlongitud
        `;
      } else {
        params = [plantillaId];
        detalleSql = `
          SELECT 
            d.orden_fija_id, 
            NULL       AS idfactura,
            d.idproveedor, p.nombre AS proveedorNombre,
            d.idproducto, d.idvariedad, d.idlongitud, d.idtipocaja,
            d.idempaque, emp.valor AS empaqueValor,
            d.cantidad, d.codigo,
            d.cantidadRamos, d.cantidadTallos,
            NULL AS documentoProveedor,
            NULL AS idpedido,
            d.precio_unitario, d.subtotal
          FROM orden_fija_detalle d
          LEFT JOIN terceros p 
                 ON p.idtercero = d.idproveedor AND p.tipo='proveedor'
          LEFT JOIN catalogo_simple emp
                 ON emp.id = d.idempaque AND emp.categoria = 'empaque'
          WHERE d.orden_fija_id = ?
          ORDER BY p.nombre, d.idtipocaja, d.idproducto, d.idvariedad, d.idlongitud
        `;
      }

      const [detalle] = await db.query(detalleSql, params);
      if (!detalle.length) throw new Error('No hay datos para el PDF');

      // ===== Agrupar por proveedor =====
      const porProveedor = new Map();
      for (const r of detalle) {
        const key = r.idproveedor || r.proveedorNombre || 'SIN PROVEEDOR';
        if (!porProveedor.has(key)) porProveedor.set(key, []);
        porProveedor.get(key).push(r);
      }

      // ===== PDF =====
      const doc = new PDFDocument({ size: 'A4', margin: 28 });
      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Encabezado
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .text(
          isPlantilla
            ? 'ORDEN FIJA (Consolidado por Proveedor)'
            : 'PACKING LIST (Consolidado por Proveedor)',
          { align: 'center' }
        );
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10);
      doc.text(`${isPlantilla ? 'Plantilla Nº' : 'Predespacho Nº'}: ${headerInfo?.id ?? ''}`);
      doc.text(`Cliente: ${headerInfo?.clienteNombre ?? '---'}`);
      doc.text(`Agencia de Carga: ${headerInfo?.cargueraNombre ?? '---'}`);
      if (!isPlantilla && headerInfo?.awb) doc.text(`AWB: ${headerInfo.awb}`);
      doc.text(
        `Fecha: ${(headerInfo?.fecha?.toISOString?.() ?? new Date().toISOString()).slice(0, 10)}`
      );
      doc.moveDown(0.8);

      // ---------- Tabla ----------
      // 10 columnas: TYPE, BOX QTY, DESCRIPTION, UNIT/BUN, BUNCH, QTY, PRICE, TOTAL, INV#, #BOX
      // Ajuste de anchos para A4 con margen 28 (≈ 539–540pt útiles). Suma = 531.
      const headers = [
        'TYPE',
        'BOX QTY',
        'DESCRIPTION',
        'UNIT/BUN',
        'BUNCH',
        'QTY',
        'PRICE',
        'TOTAL',
        'INV#',
        '# BOX'
      ];
      const widths = [28, 40, 160, 36, 40, 56, 46, 56, 38, 31];

      const startX = doc.x;
      let y = doc.y;
      const rowH = 18;
      const totalWidth = widths.reduce((a, b) => a + b);
      const pageBottom = () => doc.page.height - doc.page.margins.bottom - 24;

      const lightFill = '#f5f5f5';
      const lightStroke = '#e6e6e6';

      const drawHeader = () => {
        doc.save();
        doc.rect(startX, y, totalWidth, rowH).fillAndStroke(lightFill, lightStroke);
        doc.restore();
        doc.font('Helvetica-Bold').fontSize(8.8).fillColor('#000'); // un pelín más pequeño
        let x = startX;
        headers.forEach((h, i) => {
          doc.text(h, x + 5, y + 5, { width: widths[i] - 10, align: 'left' });
          x += widths[i];
        });
        y += rowH;
      };

      const drawBodyRow = (cells) => {
        doc.font('Helvetica').fontSize(8.6).fillColor('#000');
        let x = startX;
        cells.forEach((cell, i) => {
          doc.text(String(cell ?? ''), x + 5, y + 4, { width: widths[i] - 10, align: 'left' });
          x += widths[i];
        });
        y += rowH;
      };

      // Subtotales por proveedor (incluye $)
      const drawBandPiecesFull = (pieces, fulls, bunchTot, qtyTot, moneyTot) => {
        doc.save();
        doc.rect(startX, y, totalWidth, rowH).fillAndStroke(lightFill, lightStroke);
        doc.restore();
        doc.font('Helvetica-Bold').fontSize(8.8).fillColor('#000');

        // "Pieces" ocupa TYPE + BOX QTY
        const wPieces = widths[0] + widths[1] - 10;
        doc.text(`Pieces ${fmtInt(pieces)}`, startX + 5, y + 4, { width: wPieces });

        // "Full" en DESCRIPTION
        const xFull = startX + widths[0] + widths[1];
        const wFull = widths[2] - 10;
        doc.text(`Full ${fmtDec(fulls)}`, xFull + 5, y + 4, { width: wFull });

        // BUNCH y QTY
        const xBunch = startX + widths.slice(0, 4).reduce((a, b) => a + b, 0);
        doc.text(fmtInt(bunchTot), xBunch + 5, y + 4, { width: widths[4] - 10 });

        const xQty = xBunch + widths[4];
        doc.text(fmtInt(qtyTot), xQty + 5, y + 4, { width: widths[5] - 10 });

        // TOTAL $ en su columna (index 7)
        const xTot = startX + widths.slice(0, 7).reduce((a, b) => a + b, 0);
        doc.text(fmtMoney(moneyTot), xTot + 5, y + 4, { width: widths[7] - 10, align: 'left' });

        y += rowH;
      };

      // Totales globales (incluye $)
      const drawBandTotalsGlobal = (pieces, fulls, bunchTot, qtyTot, moneyTot) => {
        doc.save();
        doc.rect(startX, y, totalWidth, rowH).fillAndStroke(lightFill, lightStroke);
        doc.restore();
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');

        const wPieces = widths[0] + widths[1] - 10;
        doc.text(`Pieces ${fmtInt(pieces)}`, startX + 5, y + 3, { width: wPieces });

        const xFull = startX + widths[0] + widths[1];
        const wFull = widths[2] - 10;
        doc.text(`Full ${fmtDec(fulls)}`, xFull + 5, y + 3, { width: wFull });

        const xBunch = startX + widths.slice(0, 4).reduce((a, b) => a + b, 0);
        doc.text(fmtInt(bunchTot), xBunch + 5, y + 3, { width: widths[4] - 10 });

        const xQty = xBunch + widths[4];
        doc.text(fmtInt(qtyTot), xQty + 5, y + 3, { width: widths[5] - 10 });

        const xTot = startX + widths.slice(0, 7).reduce((a, b) => a + b, 0);
        doc.text(fmtMoney(moneyTot), xTot + 5, y + 3, { width: widths[7] - 10, align: 'left' });

        y += rowH;
      };

      drawHeader();

      let gPieces = 0;
      let gFulls = 0;
      let gBunch = 0;
      let gQty = 0;
      let gMoney = 0;

      for (const [, rows] of porProveedor) {
        if (y + rowH * 2 > pageBottom()) {
          doc.addPage();
          y = doc.y;
          drawHeader();
        }

        const nombreFinca = rows[0].proveedorNombre || '---';
        doc
          .font('Helvetica-Bold')
          .fontSize(10.6)
          .text(nombreFinca, startX, y + 5);
        y += rowH;

        let pPieces = 0,
          pFulls = 0,
          pBunch = 0,
          pQty = 0,
          pMoney = 0;

        for (const r of rows) {
          if (y + rowH > pageBottom()) {
            doc.addPage();
            y = doc.y;
            drawHeader();
          }

          const cajaLegible = mapa.tipocajas[r.idtipocaja] || r.idtipocaja;
          const type = abreviarCaja(cajaLegible);
          const desc = `${mapa.productos[r.idproducto] || r.idproducto} ${mapa.variedades[r.idvariedad] || r.idvariedad} ${mapa.longitudes[r.idlongitud] || r.idlongitud}`;
          const unit = r.empaqueValor != null ? String(r.empaqueValor) : '';
          const bunch = r.cantidadRamos ?? '';
          const quantity = r.cantidadTallos ?? '';
          const boxQty = r.cantidad ?? '';
          const priceNum = Number(r.precio_unitario ?? 0);
          const rowTotalNum =
            r.subtotal != null ? Number(r.subtotal) : priceNum * Number(quantity || 0);
          const price = fmtMoney(priceNum);
          const total = fmtMoney(rowTotalNum);
          const invNo = r.documentoProveedor || '';
          const nBox = r.idpedido ?? '';

          drawBodyRow([type, boxQty, desc, unit, bunch, quantity, price, total, invNo, nBox]);

          const factor = FACTOR_FULLS[type] ?? 1;
          pPieces += Number(boxQty || 0);
          pFulls += Number(boxQty || 0) * factor;
          pBunch += Number(bunch || 0);
          pQty += Number(quantity || 0);
          pMoney += rowTotalNum;

          gPieces += Number(boxQty || 0);
          gFulls += Number(boxQty || 0) * factor;
          gBunch += Number(bunch || 0);
          gQty += Number(quantity || 0);
          gMoney += rowTotalNum;
        }

        drawBandPiecesFull(pPieces, pFulls, pBunch, pQty, pMoney);
        y += 4;
      }

      if (y + rowH > pageBottom()) {
        doc.addPage();
        y = doc.y;
        drawHeader();
      }
      drawBandTotalsGlobal(gPieces, gFulls, gBunch, gQty, gMoney);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
