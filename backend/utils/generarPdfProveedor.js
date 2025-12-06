const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const db = require('../db');

const generarPdfProveedor = async (detalle = []) => {
  return new Promise(async (resolve, reject) => {
    if (!detalle || detalle.length === 0) {
      return reject(new Error('No hay datos para generar PDF'));
    }

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = new PassThrough();
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    const proveedor = detalle[0].proveedorNombre || detalle[0].proveedor;
    const factura = detalle[0].idfactura;

    let cargueraNombre = '---';
    let fechaEntrega = new Date().toISOString().substring(0, 10);
    let clienteNombre = '---';

    try {
      const [[facturaInfo]] = await db.query(`
        SELECT 
          f.idcarguera, 
          f.fecha, 
          f.idcliente, 
          c.valor AS carguera,
          t.nombre AS cliente
        FROM factura_consolidada f
        LEFT JOIN catalogo_simple c ON f.idcarguera = c.id AND c.categoria = 'carguera'
        LEFT JOIN terceros t ON f.idcliente = t.idtercero AND t.tipo = 'cliente'
        WHERE f.id = ?
      `, [factura]);

      if (facturaInfo) {
        cargueraNombre = facturaInfo.carguera || '---';
        fechaEntrega = facturaInfo.fecha?.toISOString?.().substring(0, 10) || fechaEntrega;
        clienteNombre = facturaInfo.cliente || '---';
      }
    } catch (err) {
      console.warn('⚠️ Error obteniendo datos de cabecera:', err.message);
    }

    const mapaNombres = { productos: {}, variedades: {}, longitudes: {}, tipocajas: {} };
    try {
      const [productos] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'producto'");
      const [variedades] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'variedad'");
      const [longitudes] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'longitud'");
      const [tipocajas] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'tipocaja'");

      productos.forEach(p => mapaNombres.productos[p.id] = p.valor);
      variedades.forEach(v => mapaNombres.variedades[v.id] = v.valor);
      longitudes.forEach(l => mapaNombres.longitudes[l.id] = l.valor);
      tipocajas.forEach(t => mapaNombres.tipocajas[t.id] = t.valor);
    } catch (err) {
      console.warn('❌ No se pudieron cargar nombres legibles:', err.message);
    }

    // ENCABEZADO
    doc.fontSize(16).font('Helvetica-Bold').text('ORDEN DE COMPRA', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Proveedor: ${proveedor}`);
    doc.text(`Cliente: ${clienteNombre}`);
    doc.text(`Pedido Nº: ${factura}`);
    doc.text(`Agencia de Carga: ${cargueraNombre}`);
    doc.text(`Fecha Entrega: ${fechaEntrega}`);
    doc.moveDown();

    // TABLA
    const headers = ['Caja', 'Cant.', 'Código', 'Producto', 'Variedad', 'Long', 'Ramos', 'Tallos', 'P.Unit', 'Subtotal'];
    const columnWidths = [40, 45, 55, 70, 90, 40, 45, 50, 50, 65];
    const startX = 50;
    let startY = doc.y;

    const drawRow = (y, row, isHeader = false, isBold = false, textColors = []) => {
      let x = startX;
      const height = 20;
      if (isHeader) {
        doc.rect(x, y, columnWidths.reduce((a, b) => a + b), height).fillAndStroke('#f0f0f0', 'black');
        doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
      } else {
        doc.fontSize(9).font(isBold ? 'Helvetica-Bold' : 'Helvetica');
      }

      for (let i = 0; i < row.length; i++) {
        doc.rect(x, y, columnWidths[i], height).stroke();
        const color = textColors[i] || 'black';
        doc.fillColor(color).text(row[i], x + 3, y + 6, { width: columnWidths[i] - 6 });
        x += columnWidths[i];
      }

      return y + height;
    };

    startY = drawRow(startY, headers, true);

    let totalCantidad = 0;
    let totalTallos = 0;
    let totalGlobal = 0;

    // Para controlar visual de mix
    const primerIdPorMix = {};
    detalle.forEach(d => {
      if (d.idmix && (!primerIdPorMix[d.idmix] || d.iddetalle < primerIdPorMix[d.idmix])) {
        primerIdPorMix[d.idmix] = d.iddetalle;
      }
    });

    for (const item of detalle) {
      const esMixta = item.idmix;
      const esPrincipal = !esMixta || item.iddetalle === primerIdPorMix[item.idmix];

      const row = [
        esPrincipal ? (mapaNombres.tipocajas[item.idtipocaja] || item.idtipocaja) : '',
        esPrincipal ? item.cantidad : '',
        esPrincipal ? item.codigo || '' : '',
        mapaNombres.productos[item.idproducto] || item.idproducto,
        mapaNombres.variedades[item.idvariedad] || item.idvariedad,
        mapaNombres.longitudes[item.idlongitud] || item.idlongitud,
        item.cantidadRamos || '',
        item.cantidadTallos || '',
        item.precio_unitario,
        parseFloat(item.subtotal).toFixed(2)
      ];

      const textColors = esMixta && !esPrincipal
        ? ['white', 'white', 'white', 'black', 'black', 'black', 'black', 'black', 'black', 'black']
        : Array(headers.length).fill('black');

      startY = drawRow(startY, row, false, false, textColors);
      if (esPrincipal) totalCantidad += parseFloat(item.cantidad || 0);
      totalTallos += parseFloat(item.cantidadTallos || 0);
      totalGlobal += parseFloat(item.subtotal || 0);
    }

    // Fila TOTAL
    startY = drawRow(startY, ['Total', totalCantidad, '', '', '', '', '', totalTallos, '', totalGlobal.toFixed(2)], false, true);

    doc.end();
  });
};

module.exports = generarPdfProveedor;
