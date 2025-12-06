const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const bwipjs = require('bwip-js');

function mmToPt(mm) {
  return mm * 2.83465;
}

// Agrupa registros por mix o por iddetalle si no es mix
function agruparPorMix(rows) {
  const agrupados = {};

  for (const d of rows) {
    const key = d.idmix || `solo-${d.iddetalle}`;

    if (!agrupados[key]) {
      agrupados[key] = {
        codetiqueta: d.codetiqueta,
        code: d.code || d.tipocaja || '',
        finca: d.proveedor || '',
        cliente: d.cliente,
        carguera: d.carguera,
        origen: d.origen || 'EC',
        awb: d.guia_master || '', // actualizado a guia_master
        cantidad: Number(d.cantidad), // Solo se toma del primer registro
        totalBunch: Number(d.cantidadRamos || 0),
        detallesTabla: [
          {
            variedad: d.variedad,
            longitud: d.longitud,
            bunches: d.cantidadRamos,
            tallos: d.cantidadTallos
          }
        ]
      };
    } else {
      // 🔒 NO volvemos a sumar cantidad para evitar etiquetas duplicadas
      agrupados[key].totalBunch += Number(d.cantidadRamos || 0);
      agrupados[key].detallesTabla.push({
        variedad: d.variedad,
        longitud: d.longitud,
        bunches: d.cantidadRamos,
        tallos: d.cantidadTallos
      });
    }
  }

  return Object.values(agrupados);
}

const generarPdfEtiquetas = async (detalles = []) => {
  return new Promise(async (resolve, reject) => {
    if (!detalles || detalles.length === 0) {
      return reject(new Error('No hay datos para generar etiquetas'));
    }

    const doc = new PDFDocument({ autoFirstPage: false });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    const totalEtiquetas = detalles.reduce((sum, d) => sum + Number(d.cantidad || 0), 0);
    let etiquetaActual = 1;

    for (const d of detalles) {
      const totalCajas = Number(d.cantidad || 0);

      for (let i = 0; i < totalCajas; i++) {
        doc.addPage({
          size: [mmToPt(77), mmToPt(100)],
          margin: 0
        });

        let y = 6;

        // === FARM ===
        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .text(`FARM : ${d.finca || ''}`, 10, y);
        y += 10;

        // === Línea horizontal ===
        doc
          .moveTo(10, y)
          .lineTo(mmToPt(77) - 10, y)
          .stroke();
        y += 4;

        // === Código de barras ===
        if (d.codetiqueta) {
          const barcodeBuffer = await bwipjs.toBuffer({
            bcid: 'code128',
            text: String(d.codetiqueta),
            scale: 1.3,
            height: mmToPt(13),
            includetext: false
          });

          const barcodeWidth = 120;
          const xCenter = (mmToPt(77) - barcodeWidth) / 2;
          doc.image(barcodeBuffer, xCenter, y, {
            width: barcodeWidth,
            height: mmToPt(13)
          });

          y += mmToPt(15) + 2;
        }

        // === CODE y código ===
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text(`${d.codetiqueta}`, 10, y);
        doc.text(`CODE : ${d.code || ''}`, mmToPt(77) / 2, y, { align: 'left' });
        y += 15;

        // === BOX y ORIGIN ===
        doc.font('Helvetica').fontSize(10);
        doc.text(`BOX : ${etiquetaActual} / ${totalEtiquetas}`, 10, y);
        doc.text(`ORIGIN: ${d.origen || 'EC'}`, mmToPt(77) / 2, y, { align: 'left' });
        y += 12;

        // === AWB ===
        doc.text(`AWB : ${d.awb || '---'}`, mmToPt(77) / 2, y, { align: 'left' });
        y += 15;

        // === Customer ===
        doc.font('Helvetica').fontSize(8).text(`Customer : __________________________`, 12, y);
        y += 12;
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(`${d.cliente || ''}`, 12, y);
        y += 15;

        // === Tabla ===
        const tableY = y;
        const tableCols = ['VARIETY', 'LENG', 'BUNCH', 'T.STEMS'];
        const cellWidths = [80, 40, 40, 46]; // Restaurado
        const startX = 10;
        const rowHeight = 13;
        const filas = d.detallesTabla || [
          {
            variedad: d.variedad,
            longitud: d.longitud,
            bunches: d.bunches,
            tallos: d.tallos
          }
        ];

        // Header
        doc.font('Helvetica-Bold').fontSize(8);
        let x = startX;
        for (let i = 0; i < tableCols.length; i++) {
          doc.text(tableCols[i], x + 1, tableY + 1, {
            width: cellWidths[i] - 2,
            align: 'center'
          });
          x += cellWidths[i];
        }

        // Líneas
        x = startX;
        for (let i = 0; i <= tableCols.length; i++) {
          const xPos = x;
          doc
            .moveTo(xPos, tableY)
            .lineTo(xPos, tableY + rowHeight * (filas.length + 1))
            .stroke();
          if (i < tableCols.length) x += cellWidths[i];
        }
        doc.moveTo(startX, tableY).lineTo(x, tableY).stroke();
        for (let r = 1; r <= filas.length; r++) {
          doc
            .moveTo(startX, tableY + rowHeight * r)
            .lineTo(x, tableY + rowHeight * r)
            .stroke();
        }
        // Línea inferior final de la tabla
        doc
          .moveTo(startX, tableY + rowHeight * (filas.length + 1))
          .lineTo(x, tableY + rowHeight * (filas.length + 1))
          .stroke();

        // Contenido
        doc.font('Helvetica').fontSize(8);
        for (let r = 0; r < filas.length; r++) {
          const item = filas[r];
          const values = [item.variedad, item.longitud, item.bunches, item.tallos];
          x = startX;
          for (let i = 0; i < values.length; i++) {
            doc.text(String(values[i] || ''), x + 1, tableY + rowHeight * (r + 1) + 1, {
              width: cellWidths[i] - 2,
              align: 'center'
            });
            x += cellWidths[i];
          }
        }

        y = tableY + rowHeight * (filas.length + 1) + 4;

        // === TOTAL BUNCH ===
        doc.font('Helvetica-Bold').text('TOTAL BUNCH: ', 10, y);
        doc.font('Helvetica').text(String(d.totalBunch || ''), 120, y);

        // === Footer: Cargo Agency ===
        const footerY = mmToPt(100) - 20;
        doc
          .moveTo(10, footerY)
          .lineTo(mmToPt(77) - 10, footerY)
          .stroke();
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .text('Cargo Agency :', 10, footerY + 2);
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(`${d.carguera || ''}`, 120, footerY + 1, { align: 'left' });
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('AMS', mmToPt(77) - 35, footerY + 1);

        etiquetaActual++;
      }
    }

    doc.end();
  });
};

module.exports = {
  generarPdfEtiquetas,
  agruparPorMix
};
