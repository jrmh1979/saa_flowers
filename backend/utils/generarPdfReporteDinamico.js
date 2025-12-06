const PDFDocument = require('pdfkit');

function generarPdfReporteDinamico(datos, consolidado, filtros, chartImage, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  res.setHeader('Content-Disposition', 'inline; filename="ReporteDinamico.pdf"');
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);

  // Título principal
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .text('INFORME DINÁMICO DE FACTURACIÓN', { align: 'center', underline: true })
    .moveDown(0.5);

  // Filtros aplicados
  doc.fontSize(9).font('Helvetica').text(`Filtros aplicados:`, { underline: true }).moveDown(0.2);

  doc.fontSize(8);
  if (filtros?.Desde) doc.text(`Desde: ${filtros.Desde}`);
  if (filtros?.Hasta) doc.text(`Hasta: ${filtros.Hasta}`);
  doc.moveDown();

  // Tabla consolidado
  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('Tabla Consolidado', { underline: true })
    .moveDown(0.5);

  const colWidths = {
    clave: 150,
    subtotal: 60,
    cantidad: 45,
    tallos: 45,
    precio: 50,
    porcentaje: 50
  };
  const colSpacing = 5;

  // Encabezados
  let y = doc.y;
  doc
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('Grupo', 40, y, { width: colWidths.clave, align: 'center' })
    .text('Subtotal $', 40 + colWidths.clave + colSpacing, y, {
      width: colWidths.subtotal,
      align: 'center'
    })
    .text('Cant', 40 + colWidths.clave + colWidths.subtotal + 2 * colSpacing, y, {
      width: colWidths.cantidad,
      align: 'center'
    })
    .text(
      'Tallos',
      40 + colWidths.clave + colWidths.subtotal + colWidths.cantidad + 3 * colSpacing,
      y,
      { width: colWidths.tallos, align: 'center' }
    )
    .text(
      'Precio',
      40 +
        colWidths.clave +
        colWidths.subtotal +
        colWidths.cantidad +
        colWidths.tallos +
        4 * colSpacing,
      y,
      { width: colWidths.precio, align: 'center' }
    )
    .text(
      '% Total',
      40 +
        colWidths.clave +
        colWidths.subtotal +
        colWidths.cantidad +
        colWidths.tallos +
        colWidths.precio +
        5 * colSpacing,
      y,
      { width: colWidths.porcentaje, align: 'center' }
    )
    .moveDown(0.5);

  y = doc.y;
  doc.moveTo(40, y).lineTo(550, y).stroke();

  // Filas
  let rowCount = 0;
  const rowsPerPageLimit = 25;
  consolidado.forEach((fila, index) => {
    if (rowCount >= rowsPerPageLimit) {
      doc.addPage();
      y = doc.y;
      rowCount = 0;

      // Encabezados en nueva página
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .text('Grupo', 40, y, { width: colWidths.clave, align: 'center' })
        .text('Subtotal $', 40 + colWidths.clave + colSpacing, y, {
          width: colWidths.subtotal,
          align: 'center'
        })
        .text('Cant', 40 + colWidths.clave + colWidths.subtotal + 2 * colSpacing, y, {
          width: colWidths.cantidad,
          align: 'center'
        })
        .text(
          'Tallos',
          40 + colWidths.clave + colWidths.subtotal + colWidths.cantidad + 3 * colSpacing,
          y,
          { width: colWidths.tallos, align: 'center' }
        )
        .text(
          'Precio',
          40 +
            colWidths.clave +
            colWidths.subtotal +
            colWidths.cantidad +
            colWidths.tallos +
            4 * colSpacing,
          y,
          { width: colWidths.precio, align: 'center' }
        )
        .text(
          '% Total',
          40 +
            colWidths.clave +
            colWidths.subtotal +
            colWidths.cantidad +
            colWidths.tallos +
            colWidths.precio +
            5 * colSpacing,
          y,
          { width: colWidths.porcentaje, align: 'center' }
        )
        .moveDown(0.5);
      y = doc.y;
      doc.moveTo(40, y).lineTo(550, y).stroke();
    }

    y = doc.y + 2;

    doc
      .font('Helvetica')
      .fontSize(8)
      .text(fila.clave, 40, y, { width: colWidths.clave, align: 'left' })
      .text(fila.subtotal.toFixed(2), 40 + colWidths.clave + colSpacing, y, {
        width: colWidths.subtotal,
        align: 'right'
      })
      .text(fila.cantidad, 40 + colWidths.clave + colWidths.subtotal + 2 * colSpacing, y, {
        width: colWidths.cantidad,
        align: 'right'
      })
      .text(
        fila.cantidadTallos,
        40 + colWidths.clave + colWidths.subtotal + colWidths.cantidad + 3 * colSpacing,
        y,
        { width: colWidths.tallos, align: 'right' }
      )
      .text(
        fila.cantidadTallos ? (fila.subtotal / fila.cantidadTallos).toFixed(4) : '0.0000',
        40 +
          colWidths.clave +
          colWidths.subtotal +
          colWidths.cantidad +
          colWidths.tallos +
          4 * colSpacing,
        y,
        { width: colWidths.precio, align: 'right' }
      )
      .text(
        `${fila.porcentaje.toFixed(2)}%`,
        40 +
          colWidths.clave +
          colWidths.subtotal +
          colWidths.cantidad +
          colWidths.tallos +
          colWidths.precio +
          5 * colSpacing,
        y,
        { width: colWidths.porcentaje, align: 'right' }
      );

    doc.moveDown(0.5);
    rowCount++;
  });

  doc.moveDown(1);

  // Gráfico
  if (chartImage) {
    // Si la tabla fue muy larga, ya forzó nueva página
    if (rowCount >= rowsPerPageLimit || doc.y > 500) {
      doc.addPage();
    } else {
      doc.moveDown(1);
    }

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Gráfico del Consolidado', { underline: true, align: 'center' })
      .moveDown(0.5);

    const pageWidth = doc.page.width;
    const margin = doc.page.margins.left;
    const usableWidth = pageWidth - margin * 2;

    // Define máximo ancho deseado (ajústalo a gusto, pero menor al usable)
    const maxChartWidth = Math.min(usableWidth, 380);

    // Calcula posición x para centrar
    const chartX = margin + (usableWidth - maxChartWidth) / 2;

    doc.image(chartImage, chartX, doc.y, {
      fit: [maxChartWidth, 240]
    });
  }

  doc.end();
}

module.exports = generarPdfReporteDinamico;
