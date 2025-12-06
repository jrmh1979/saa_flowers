const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const db = require('../db');
const stringSimilarity = require('string-similarity');
const router = express.Router();

// 📦 Configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// 🔧 Funciones auxiliares
const normalizar = (t) =>
  t
    ?.toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const buscarIdPorValor = async (valor, categoria = null, tabla = 'catalogo_simple') => {
  const texto = normalizar(valor);
  if (!texto) return null;

  let sql = `SELECT id, valor FROM ${tabla}`;
  const params = [];

  if (categoria) {
    sql += ` WHERE categoria = ?`;
    params.push(categoria);
  }

  const [rows] = await db.query(sql, params);
  if (rows.length === 0) return null;

  const valoresNorm = rows.map((r) => normalizar(r.valor));
  const resultado = stringSimilarity.findBestMatch(texto, valoresNorm);
  const { bestMatch, bestMatchIndex } = resultado;

  // Aceptar si tiene ≥ 0.90 de similitud o si contiene el valor exacto
  if (bestMatch.rating >= 0.9 || texto.includes(valoresNorm[bestMatchIndex])) {
    return rows[bestMatchIndex].id;
  }

  // Opcional: log de coincidencias bajas
  if (bestMatch.rating >= 0.7) {
    console.warn(
      `⚠️ Coincidencia baja (${(bestMatch.rating * 100).toFixed(1)}%) entre "${valor}" y "${rows[bestMatchIndex].valor}"`
    );
  }

  return null;
};

const buscarIdProveedor = async (nombre) => {
  const texto = normalizar(nombre);
  if (!texto) return null;
  const [rows] = await db.query(
    `SELECT idtercero, nombre FROM terceros WHERE LOWER(TRIM(nombre)) LIKE ? AND tipo = 'proveedor' LIMIT 1`,
    [`%${texto}%`]
  );
  return rows.length > 0 ? rows[0].idtercero : null;
};

// 🧠 Función para determinar tipo de caja por reglas de empaque
const determinarTipoCajaPorReglaEmpaque = async (idproductoCatalogo, longitud, stems) => {
  const longitudNum = parseInt((longitud || '').toString().match(/\d+/)?.[0]);
  if (isNaN(longitudNum) || !idproductoCatalogo || !stems) return null;

  const [reglas] = await db.query(
    `SELECT valor FROM catalogo_simple WHERE categoria = 'regla_empaque'`
  );

  for (const { valor } of reglas) {
    const [idCaja, idCatalogoProducto, long, rango] = valor.split('|');
    const longRegla = parseInt(long);
    const [minTallos, maxTallos] = rango.split('-').map(Number);

    if (
      parseInt(idCatalogoProducto) === parseInt(idproductoCatalogo) &&
      longRegla === longitudNum &&
      stems >= minTallos &&
      stems <= maxTallos
    ) {
      return parseInt(idCaja);
    }
  }

  return null;
};

/* -------------------- IMPORTAR PEDIDOS -------------------- */
router.post('/pedidos', upload.single('archivo'), async (req, res) => {
  try {
    const { idfactura } = req.body;
    if (!idfactura || !req.file) {
      console.warn('⚠️ Falta archivo o idfactura');
      return res.status(400).send('Faltan datos requeridos');
    }

    const [[factura]] = await db.query('SELECT idcliente FROM factura_consolidada WHERE id = ?', [
      idfactura
    ]);
    if (!factura) {
      console.warn('⚠️ Factura no encontrada:', idfactura);
      return res.status(404).send('Cliente no encontrado');
    }
    const idcliente = factura.idcliente;

    const workbook = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (data.length === 0) return res.status(400).send('Archivo vacío');

    const columnas = Object.keys(data[0]).reduce((acc, key) => {
      acc[normalizar(key)] = key;
      return acc;
    }, {});

    for (const fila of data) {
      const cantidad = parseFloat(fila[columnas['boxes']]) || 1;
      const stems = parseInt(fila[columnas['stems']]) || 0;
      const longitudRaw = fila[columnas['length/grade']];
      const variedad = fila[columnas['variety']];
      const producto = fila[columnas['product']];
      const farm = fila[columnas['farm']];
      const clientCode = fila[columnas['client code']];
      const stemsXBunch = fila[columnas['stems x bunch']];
      const orderType = fila[columnas['order type']];

      // ✅ Detectar la columna "Gyps (gr)" de forma segura
      const GypsKey = columnas[normalizar('Gyps (gr)')];
      const GypsgrRaw = fila[GypsKey];
      const GypsgrMatch = (GypsgrRaw ?? '').toString().match(/\d+/);
      const Gypsgr = GypsgrMatch ? parseInt(GypsgrMatch[0]) : null;

      const idproducto = await buscarIdPorValor(producto);
      const idlongitud = await buscarIdPorValor(longitudRaw, 'longitud');
      const idvariedad = await buscarIdPorValor(variedad, 'variedad');
      const idempaque = await buscarIdPorValor(stemsXBunch, 'empaque');
      const idOrder = await buscarIdPorValor(orderType, 'tipopedido');
      const idproveedor = farm ? await buscarIdProveedor(farm) : null;
      const idtipocaja = idproducto
        ? await determinarTipoCajaPorReglaEmpaque(idproducto, longitudRaw, stems)
        : null;

      const totaltallos = cantidad * stems;
      const price = parseFloat(fila[columnas['price']]) || 0;

      if (!idproducto || !idlongitud || !idvariedad) {
        console.warn('⚠️ Fila incompleta, pero se insertará sin valores clave:', {
          producto,
          variedad,
          longitudRaw
        });
      }

      // ✅ Log temporal de gramaje

      const valores = {
        idfactura,
        codigo: clientCode,
        observaciones: [variedad, farm && `Finca: ${farm}`].filter(Boolean).join(' | '),
        idproducto,
        idvariedad,
        idlongitud,
        idempaque,
        gramaje: Gypsgr,
        cantidad,
        tallos: stems,
        totaltallos,
        idtipocaja,
        idOrder,
        idcliente,
        idproveedor,
        precio_unitario: price
      };

      await db.query('INSERT INTO pedidos SET ?', [valores]);
    }

    res.json({ mensaje: '✅ Pedidos importados correctamente', cantidad: data.length });
  } catch (error) {
    console.error('❌ Error general al importar pedidos:', error);
    res.status(500).send('Error interno al procesar pedidos');
  }
});

/* -------------------- IMPORTAR VILNIUS -------------------- */
router.post('/vilnius', upload.single('archivo'), async (req, res) => {
  try {
    const { idfactura } = req.body;
    if (!idfactura || !req.file) return res.status(400).send('Faltan datos requeridos');

    const [[factura]] = await db.query('SELECT idcliente FROM factura_consolidada WHERE id = ?', [
      idfactura
    ]);
    if (!factura) return res.status(404).send('Cliente no encontrado');
    const idcliente = factura.idcliente;

    const workbook = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (data.length === 0) return res.status(400).send('Archivo vacío');

    for (const fila of data) {
      const cantidad = parseFloat(fila['number of boxes']) || 1;
      const stems = parseInt(fila['STEMS']) || 0;
      const length = fila['Length'];
      const boxType = fila['box type']?.toLowerCase().trim();
      const product = fila['Product']?.trim();
      const cod = fila['Cod']?.toString().trim();

      const idlongitud = await buscarIdPorValor(length, 'longitud');
      const idvariedad = await buscarIdPorValor(product, 'variedad');

      // ✅ Si se encuentra variedad, asignar producto = 25 (Rose)
      const idproducto = idvariedad ? 25 : null;

      let idtipocaja = boxType === 'qb' ? 1 : boxType === 'hb' ? 2 : null;

      if (!idtipocaja && stems === 100 && [40, 50, 60, 70, 80, 90].includes(parseInt(length))) {
        idtipocaja = 1;
      }

      let cantidadTallos =
        stems ||
        (idtipocaja === 1 && [40, 50, 60, 70, 80, 90].includes(parseInt(length))
          ? 100
          : idtipocaja === 2 && [40, 50].includes(parseInt(length))
            ? 300
            : idtipocaja === 2 && parseInt(length) === 60
              ? 250
              : 200);

      const totaltallos = cantidad * cantidadTallos;

      if (!idvariedad) {
        console.warn(`⚠️ Variedad no encontrada para "${product}"`);
      }

      const pedido = {
        idfactura,
        idcliente,
        codigo: cod,
        observaciones: product,
        idproducto,
        idvariedad,
        idlongitud,
        idtipocaja,
        cantidad,
        tallos: cantidadTallos,
        totaltallos
      };

      await db.query('INSERT INTO pedidos SET ?', [pedido]);
    }

    res.json({ mensaje: '✅ Pedidos de Vilnius importados correctamente', cantidad: data.length });
  } catch (error) {
    console.error('❌ Error al importar Vilnius:', error);
    res.status(500).send('Error al importar pedidos desde Vilnius');
  }
});

module.exports = router;
