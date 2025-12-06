const PDFDocument = require('pdfkit');
const db = require('../db');
const { PassThrough } = require('stream');

const generarPdfPorCodigo = async (grupos = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      const getStream = await import('get-stream').then((m) => m.default);
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = new PassThrough();
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // 🔹 Nombres legibles
      const mapaNombres = { productos: {}, variedades: {}, longitudes: {}, cajas: {} };
      try {
        const [productos] = await db.query(
          "SELECT id, valor FROM catalogo_simple WHERE categoria = 'producto'"
        );
        const [variedades] = await db.query(
          "SELECT id, valor FROM catalogo_simple WHERE categoria = 'variedad'"
        );
        const [longitudes] = await db.query(
          "SELECT id, valor FROM catalogo_simple WHERE categoria = 'longitud'"
        );
        const [tipocaja] = await db.query(
          "SELECT id, valor FROM catalogo_simple WHERE categoria = 'tipo_caja'"
        );

        productos.forEach((p) => (mapaNombres.productos[p.id] = p.valor));
        variedades.forEach((v) => (mapaNombres.variedades[v.id] = v.valor));
        longitudes.forEach((l) => (mapaNombres.longitudes[l.id] = l.valor));
        tipocaja.forEach((c) => (mapaNombres.cajas[c.id] = c.valor));
      } catch (err) {
        console.warn('⚠️ Error al cargar nombres legibles:', err.message);
      }

      doc.fontSize(16).font('Helvetica-Bold').text('REPORTE POR CÓDIGO', { align: 'center' });
      doc.moveDown();

      const headers = [
        'Proveedor',
        'Producto',
        'Variedad',
        'Long.',
        'Cajas',
        'Tipo',
        'Ramos',
        'Tallos',
        'Subtotal'
      ];
      const columnWidths = [100, 70, 80, 40, 40, 40, 40, 50, 60];
      const startX = 50;
      let startY = doc.y;

      const drawRow = (y, row, isHeader = false, isBold = false) => {
        let x = startX;
        const height = 15;
        if (isHeader) {
          doc
            .rect(
              x,
              y,
              columnWidths.reduce((a, b) => a + b),
              height
            )
            .fillAndStroke('#f0f0f0', 'black');
          doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
        } else {
          doc.fontSize(8).font(isBold ? 'Helvetica-Bold' : 'Helvetica');
        }

        for (let i = 0; i < row.length; i++) {
          doc.rect(x, y, columnWidths[i], height).stroke();
          doc.fillColor('black').text(row[i], x + 2, y + 3, {
            width: columnWidths[i] - 4,
            height,
            lineBreak: true,
            ellipsis: false
          });
          x += columnWidths[i];
        }

        return y + height;
      };

      let totalGlobal = { cajas: 0, ramos: 0, tallos: 0, subtotal: 0 };

      for (const [codigo, items] of Object.entries(grupos)) {
        // 🔷 Título del código
        doc.moveDown(1);
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text(`CÓD: ${codigo}`, startX, doc.y, { align: 'left' });
        startY = doc.y + 5;

        startY = drawRow(startY, headers, true);

        let subtotalTotal = 0;
        let cajasTotal = 0;
        let ramosTotal = 0;
        let tallosTotal = 0;

        for (const item of items) {
          const cantidad = parseFloat(item.cantidad || 0);
          const ramos = parseFloat(item.cantidadRamos || 0);
          const tallos = parseFloat(item.cantidadTallos || 0);
          const subtotal = parseFloat(item.subtotal || 0);

          const row = [
            item.proveedor || '',
            mapaNombres.productos[item.idproducto] || item.idproducto,
            mapaNombres.variedades[item.idvariedad] || item.idvariedad,
            mapaNombres.longitudes[item.idlongitud] || item.idlongitud,
            cantidad,
            mapaNombres.cajas[item.idtipocaja] || item.idtipocaja,
            ramos,
            tallos,
            subtotal.toFixed(2)
          ];

          subtotalTotal += subtotal;
          cajasTotal += cantidad;
          ramosTotal += ramos;
          tallosTotal += tallos;

          totalGlobal.subtotal += subtotal;
          totalGlobal.cajas += cantidad;
          totalGlobal.ramos += ramos;
          totalGlobal.tallos += tallos;

          startY = drawRow(startY, row);

          if (startY > 730) {
            doc.addPage();
            startY = drawRow(50, headers, true);
          }
        }

        startY = drawRow(
          startY,
          ['TOTAL', '', '', '', cajasTotal, '', ramosTotal, tallosTotal, subtotalTotal.toFixed(2)],
          false,
          true
        );

        doc.moveDown();
        startY += 5;
      }

      // 🔚 Totales globales (con formato visual como bloques anteriores)
      doc.moveDown(1);
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(`TOTAL GENERAL`, startX, doc.y, { align: 'left' });
      startY = doc.y + 5;

      startY = drawRow(
        startY,
        [
          '',
          '',
          '',
          '',
          totalGlobal.cajas,
          '',
          totalGlobal.ramos,
          totalGlobal.tallos,
          totalGlobal.subtotal.toFixed(2)
        ],
        false,
        true
      );

      doc.end();
    } catch (err) {
      console.error('❌ Error en generarPdfPorCodigo:', err.message);
      reject(err);
    }
  });
};

module.exports = generarPdfPorCodigo;
