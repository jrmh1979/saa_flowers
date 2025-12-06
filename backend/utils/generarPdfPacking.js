// utils/generarPdfPacking.js
const PDFDocument = require('pdfkit');
const db = require('../db');

// Factores a "FULLS"
const FACTOR_FULLS = {
  HB: 0.5,
  QB: 0.25,
  EB: 0.125,
  FB: 1,
  '1/2HB': 0.5
};

// Abreviatura de tipo de caja
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

module.exports = async function generarPdfPacking({ idfactura, idsProveedores = [] }) {
  return new Promise(async (resolve, reject) => {
    try {
      // === Cabecera ===
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

      // === Detalle ===
      const params = [idfactura];
      let filtroProv = '';
      if (idsProveedores?.length) {
        filtroProv = ` AND d.idproveedor IN (${idsProveedores.map(() => '?').join(',')}) `;
        params.push(...idsProveedores);
      }

      const [detalle] = await db.query(
        `
        SELECT 
          d.iddetalle, d.idfactura, d.idproveedor, p.nombre AS proveedorNombre,
          d.idproducto, d.idvariedad, d.idlongitud, d.idtipocaja,
          d.idempaque, emp.valor AS empaqueValor,
          d.cantidad, d.codigo,
          d.cantidadRamos, d.cantidadTallos,
          d.documento_proveedor AS documentoProveedor,
          d.idpedido,                              -- ← para # BOX
          d.precio_unitario, d.subtotal
        FROM factura_consolidada_detalle d
        LEFT JOIN terceros p 
          ON p.idtercero = d.idproveedor AND p.tipo='proveedor'
        LEFT JOIN catalogo_simple emp
          ON emp.id = d.idempaque AND emp.categoria = 'empaque'
        WHERE d.idfactura = ? ${filtroProv}
        ORDER BY p.nombre, d.idtipocaja, d.idproducto, d.idvariedad, d.idlongitud
        `,
        params
      );

      if (!detalle.length) throw new Error('No hay datos para el PACKING');

      // === Mapas legibles ===
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

      // === Agrupar por proveedor ===
      const porProveedor = new Map();
      for (const r of detalle) {
        const key = r.idproveedor || r.proveedorNombre || 'SIN PROVEEDOR';
        if (!porProveedor.has(key)) porProveedor.set(key, []);
        porProveedor.get(key).push(r);
      }

      // === PDF ===
      const doc = new PDFDocument({ size: 'A4', margin: 28 });
      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Encabezado
      doc.font('Helvetica-Bold').fontSize(16).text('PACKING LIST', { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Predespacho Nº: ${facturaInfo?.id ?? idfactura}`);
      doc.text(`Cliente: ${facturaInfo?.clienteNombre ?? '---'}`);
      doc.text(`Agencia de Carga: ${facturaInfo?.cargueraNombre ?? '---'}`);
      if (facturaInfo?.awb) doc.text(`AWB: ${facturaInfo.awb}`);
      doc.text(
        `Fecha: ${(facturaInfo?.fecha?.toISOString?.() ?? new Date().toISOString()).slice(0, 10)}`
      );
      doc.moveDown(0.8);

      // ===== Tabla =====
      // [TYPE] [BOX QTY] [DESCRIPTION] [UNIT/BUN] [BUNCH] [QTY] [INV#] [# BOX]
      const headers = [
        'TYPE',
        'BOX QTY',
        'DESCRIPTION',
        'UNIT/BUN',
        'BUNCH',
        'QTY',
        'INV#',
        '# BOX'
      ];

      // Reparto de anchos (total ≈ 539pt) — NO ampliamos DESCRIPTION
      const widths = [44, 60, 147, 50, 60, 72, 56, 50];

      const startX = doc.x;
      let y = doc.y;

      // Altura base y paddings
      const baseRowH = 18;
      const padX = 6;
      const padY = 4;

      const totalWidth = widths.reduce((a, b) => a + b);
      const pageBottom = () => doc.page.height - doc.page.margins.bottom - 24;

      const lightFill = '#f5f5f5';
      const lightStroke = '#e6e6e6';

      // Tamaños de fuente (body)
      const BODY_FONT = 9;
      const DESC_FONT = 8; // ← descripción más pequeña

      const drawHeader = () => {
        doc.save();
        doc.rect(startX, y, totalWidth, baseRowH).fillAndStroke(lightFill, lightStroke);
        doc.restore();
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
        let x = startX;
        headers.forEach((h, i) => {
          doc.text(h, x + padX, y + 5, { width: widths[i] - padX * 2 });
          x += widths[i];
        });
        y += baseRowH;
      };

      // Calcula altura de fila en función de DESCRIPTION (auto-expansible vertical)
      const calcRowHeight = (desc) => {
        // medir usando el tamaño de fuente de DESCRIPTION
        doc.font('Helvetica').fontSize(DESC_FONT);
        const descH = doc.heightOfString(String(desc ?? ''), {
          width: widths[2] - padX * 2,
          lineGap: 1
        });
        return Math.max(baseRowH, descH + padY * 2);
      };

      const drawBodyRow = (cells, rowH) => {
        let x = startX;

        cells.forEach((cell, i) => {
          const text = String(cell ?? '');
          const w = widths[i] - padX * 2;

          // fuente por columna
          if (i === 2) {
            doc.font('Helvetica').fontSize(DESC_FONT); // DESCRIPTION pequeño y envolvente
            doc.text(text, x + padX, y + padY, { width: w, lineGap: 1 });
          } else {
            doc.font('Helvetica').fontSize(BODY_FONT);
            doc.text(text, x + padX, y + padY, { width: w });
          }
          x += widths[i];
        });

        y += rowH;
      };

      // Banda de subtotales por finca
      const drawBandPiecesFull = (pieces, fulls, bunchTot, qtyTot) => {
        const rowH = baseRowH;
        doc.save();
        doc.rect(startX, y, totalWidth, rowH).fillAndStroke(lightFill, lightStroke);
        doc.restore();
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');

        // "Pieces" ocupa TYPE + BOX QTY
        const wPieces = widths[0] + widths[1] - padX * 2;
        doc.text(`Pieces ${fmtInt(pieces)}`, startX + padX, y + 5, { width: wPieces });

        // "Full" en DESCRIPTION
        const xFull = startX + widths[0] + widths[1];
        const wFull = widths[2] - padX * 2;
        doc.text(`Full ${fmtDec(fulls)}`, xFull + padX, y + 5, { width: wFull });

        // Totales BUNCH y QTY
        const xBunch = startX + widths[0] + widths[1] + widths[2] + widths[3];
        doc.text(fmtInt(bunchTot), xBunch + padX, y + 5, {
          width: widths[4] - padX * 2,
          align: 'left'
        });

        const xQty = xBunch + widths[4];
        doc.text(fmtInt(qtyTot), xQty + padX, y + 5, {
          width: widths[5] - padX * 2,
          align: 'left'
        });

        y += rowH;
      };

      // Totales globales (final)
      const drawBandTotalsGlobal = (pieces, fulls, bunchTot, qtyTot) => {
        const rowH = baseRowH;
        doc.save();
        doc.rect(startX, y, totalWidth, rowH).fillAndStroke(lightFill, lightStroke);
        doc.restore();
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000');

        // "Pieces" (col 0-1)
        const wPieces = widths[0] + widths[1] - padX * 2;
        doc.text(`Pieces ${fmtInt(pieces)}`, startX + padX, y + 4, { width: wPieces });

        // "Full" (DESCRIPTION)
        const xFull = startX + widths[0] + widths[1];
        const wFull = widths[2] - padX * 2;
        doc.text(`Full ${fmtDec(fulls)}`, xFull + padX, y + 4, { width: wFull });

        // Totales BUNCH y QTY
        const xBunch = startX + widths[0] + widths[1] + widths[2] + widths[3];
        doc.text(fmtInt(bunchTot), xBunch + padX, y + 4, {
          width: widths[4] - padX * 2,
          align: 'left'
        });

        const xQty = xBunch + widths[4];
        doc.text(fmtInt(qtyTot), xQty + padX, y + 4, {
          width: widths[5] - padX * 2,
          align: 'left'
        });

        y += rowH;
      };

      // Header
      drawHeader();

      let totalBoxQty = 0; // suma global BOX QTY (Pieces)
      let totalFulls = 0; // suma global FULLS
      let totalBunch = 0; // suma global BUNCH
      let totalQty = 0; // suma global QTY (cantidadTallos)

      for (const [, rows] of porProveedor) {
        // Espacio antes del título de finca
        if (y + baseRowH * 2 > pageBottom()) {
          doc.addPage();
          y = doc.y;
          drawHeader();
        }

        // Título de finca
        const nombreFinca = rows[0].proveedorNombre || '---';
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(nombreFinca, startX, y + 6);
        y += baseRowH;

        // Acumuladores por finca
        let piecesProv = 0; // BOX QTY
        let fullsProv = 0; // FULLS
        let bunchProv = 0; // BUNCH (cantidadRamos)
        let qtyProv = 0; // QTY (cantidadTallos)

        // Filas
        for (const r of rows) {
          const cajaLegible = mapa.tipocajas[r.idtipocaja] || r.idtipocaja;
          const type = abreviarCaja(cajaLegible); // HB/QB/EB/FB/1/2HB
          const desc = `${mapa.productos[r.idproducto] || r.idproducto} ${mapa.variedades[r.idvariedad] || r.idvariedad} ${mapa.longitudes[r.idlongitud] || r.idlongitud}`;
          const unit = r.empaqueValor != null ? String(r.empaqueValor) : ''; // catálogo 'empaque'
          const bunch = r.cantidadRamos ?? '';
          const quantity = r.cantidadTallos ?? '';
          const boxQty = r.cantidad ?? '';
          const invNo = r.documentoProveedor || '';
          const nBox = r.idpedido ?? ''; // ← idpedido en # BOX

          // Altura dinámica por DESCRIPTION (medida con fuente de 8pt)
          const rowH = calcRowHeight(desc);

          // Salto de página si no alcanza
          if (y + rowH > pageBottom()) {
            doc.addPage();
            y = doc.y;
            drawHeader();
            // volver a escribir título de finca en nueva página para contexto (opcional)
            doc
              .font('Helvetica-Bold')
              .fontSize(11)
              .text(nombreFinca, startX, y + 6);
            y += baseRowH;
          }

          //            TYPE  BOX QTY  DESCRIPTION  UNIT/BUN  BUNCH  QTY   INV#   # BOX (idpedido)
          drawBodyRow([type, boxQty, desc, unit, bunch, quantity, invNo, nBox], rowH);

          const factor = FACTOR_FULLS[type] ?? 1;
          piecesProv += Number(boxQty || 0);
          fullsProv += Number(boxQty || 0) * factor;
          bunchProv += Number(bunch || 0);
          qtyProv += Number(quantity || 0);

          totalBoxQty += Number(boxQty || 0);
          totalFulls += Number(boxQty || 0) * factor;
          totalBunch += Number(bunch || 0);
          totalQty += Number(quantity || 0);
        }

        // Subtotales por finca
        if (y + baseRowH > pageBottom()) {
          doc.addPage();
          y = doc.y;
          drawHeader();
        }
        drawBandPiecesFull(piecesProv, fullsProv, bunchProv, qtyProv);

        y += 4; // espacio entre fincas
      }

      // Totales globales
      if (y + baseRowH > pageBottom()) {
        doc.addPage();
        y = doc.y;
        drawHeader();
      }
      drawBandTotalsGlobal(totalBoxQty, totalFulls, totalBunch, totalQty);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
