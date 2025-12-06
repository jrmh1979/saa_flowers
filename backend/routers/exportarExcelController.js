const ExcelJS = require('exceljs');
const db = require('../db');

const exportarExcelFactura = async (req, res) => {
  const { idfactura } = req.params;

  try {
    const [detalles] = await db.query(`
      SELECT 
        fcd.iddetalle,
        fcd.codigo AS customer_code,
        fcd.idproducto,
        fcd.idvariedad,
        fcd.idlongitud,
        fcd.idproveedor,
        fcd.cantidad AS number_of_boxes,
        fcd.cantidadTallos AS total_stems,
        fcd.idempaque AS steem,
        fcd.precio_unitario AS price,
        fcd.subtotal,
        fcd.idgrupo,
        fcd.idOrder,
        fcd.documento_proveedor,
        fcd.guia_master,
        fcd.cantidadRamos,
        fcd.idmix,
        fcd.codetiqueta,
        fc.fecha_vuelo
      FROM factura_consolidada_detalle fcd
      LEFT JOIN factura_consolidada fc ON fcd.idfactura = fc.id
      WHERE fcd.idfactura = ?
    `, [idfactura]);

    if (detalles.length === 0) {
      return res.status(404).json({ error: 'No hay datos para exportar.' });
    }

    const camposObligatorios = [
      'customer_code', 'idproducto', 'idvariedad', 'idlongitud', 'idproveedor',
      'number_of_boxes', 'total_stems', 'steem', 'price', 'subtotal',
      'idgrupo', 'idOrder', 'documento_proveedor', 'guia_master', 'codetiqueta', 'fecha_vuelo'
    ];

    const registrosInvalidos = detalles
      .map(d => {
        const faltantes = camposObligatorios.filter(campo => d[campo] === null || d[campo] === undefined);
        return faltantes.length > 0 ? { iddetalle: d.iddetalle, faltantes } : null;
      })
      .filter(Boolean);

    if (registrosInvalidos.length > 0) {
      return res.status(400).json({
        error: '⚠️ No se puede exportar: hay registros con campos obligatorios vacíos.',
        detalles: registrosInvalidos
      });
    }

    // Catálogos legibles
    const [productos] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'producto'");
    const [variedades] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'variedad'");
    const [longitudes] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'longitud'");
    const [tipocajas] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'tipocaja'");
    const [empaques] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'empaque'");
    const [ordenes] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'tipopedido'");
    const [grupos] = await db.query("SELECT id, valor FROM catalogo_simple WHERE categoria = 'grupo'");
    const [proveedores] = await db.query("SELECT idtercero AS id, nombre FROM terceros WHERE tipo = 'proveedor'");

    const nombres = {
      productos: Object.fromEntries(productos.map(p => [p.id, p.valor])),
      variedades: Object.fromEntries(variedades.map(v => [v.id, v.valor])),
      longitudes: Object.fromEntries(longitudes.map(l => [l.id, l.valor])),
      tipocajas: Object.fromEntries(tipocajas.map(t => [t.id, t.valor])),
      empaques: Object.fromEntries(empaques.map(e => [e.id, e.valor])),
      ordenes: Object.fromEntries(ordenes.map(o => [o.id, o.valor])),
      grupos: Object.fromEntries(grupos.map(g => [g.id, g.valor])),
      proveedores: Object.fromEntries(proveedores.map(p => [p.id, p.nombre]))
    };

    // Ordenar por codetiqueta numérica
    const detallesOrdenados = detalles
      .map(d => {
        const boxNumber = d.codetiqueta ? parseInt(d.codetiqueta.toString().slice(-5)) : 0;
        return { ...d, boxNumber };
      })
      .sort((a, b) => a.boxNumber - b.boxNumber);

    // Crear Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Orden');

    const encabezados = [
      'Customer code', 'Product group', 'Product name', 'Length', 'Farm',
      'Number of boxes', 'Item', 'Stems per box', 'Steem', 'Gypso_Gram',
      'Total stems', 'Split box?', 'Box number', 'Code', 'Price', 'Status',
      'Orden Type', 'Invoice number', 'AWB-number', 'Arrival date NL', 'Total', 'Grupo'
    ];

    sheet.addRow(encabezados);
    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    for (const d of detallesOrdenados) {
      const esMixta = !!d.idmix;

      const row = sheet.addRow([
        d.customer_code,
        nombres.productos[d.idproducto] || d.idproducto,
        nombres.variedades[d.idvariedad] || d.idvariedad,
        nombres.longitudes[d.idlongitud] || d.idlongitud,
        nombres.proveedores[d.idproveedor] || d.idproveedor,
        d.number_of_boxes,
        'x',
        d.tallos || '',
        nombres.empaques[d.steem] || d.steem,
        '',
        d.total_stems,
        esMixta ? 'Yes' : 'No',
        d.boxNumber,
        d.codetiqueta,
        d.price,
        'Confirmed',
        nombres.ordenes[d.idOrder] || d.idOrder,
        d.documento_proveedor,
        d.guia_master,
        d.fecha_vuelo.toISOString().split('T')[0],
        d.subtotal,
        nombres.grupos[d.idgrupo] || d.idgrupo
      ]);

      row.eachCell(cell => {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }

    // Autoajustar columnas
    sheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, cell => {
        const value = cell.value ? cell.value.toString() : '';
        if (value.length > maxLength) maxLength = value.length;
      });
      column.width = maxLength + 2;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="export_factura_${idfactura}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('❌ Error exportando Excel:', err);
    res.status(500).json({ error: 'Error generando Excel' });
  }
};

module.exports = exportarExcelFactura;

