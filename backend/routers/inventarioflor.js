const { formatoFechaEcuador } = require('../utils/fechaEcuador');
const hoyEcuador = formatoFechaEcuador();
const express = require('express');
const router = express.Router();
const db = require('../db');

/* ------------------------ Helpers de catálogo/IDs ------------------------ */

// Buscar ID en catalogo_simple por valor (texto) — robusto
async function obtenerIdDesdeCatalogo(categoria, valorTexto) {
  const v = String(valorTexto ?? '').trim();
  if (!v) return null;

  // Intento 1: match exacto por texto (normalizado)
  const [r1] = await db.query(
    `SELECT id
       FROM catalogo_simple
      WHERE categoria = ?
        AND TRIM(LOWER(valor)) = TRIM(LOWER(?))
      LIMIT 1`,
    [categoria, v]
  );
  if (r1[0]?.id) return r1[0].id;

  // Intento 2: si es numérico, comparar por valor numérico almacenado como texto
  if (/^\d+$/.test(v)) {
    const [r2] = await db.query(
      `SELECT id
         FROM catalogo_simple
        WHERE categoria = ?
          AND CAST(TRIM(valor) AS UNSIGNED) = CAST(TRIM(?) AS UNSIGNED)
        LIMIT 1`,
      [categoria, v]
    );
    if (r2[0]?.id) return r2[0].id;
  }

  return null;
}

// Acepta id numérico o valor texto y devuelve SIEMPRE el id correcto
async function resolverId(categoria, posibleId, posibleTexto) {
  // 1) Prioriza texto si viene (ej. "25", "HB", etc.)
  if (posibleTexto != null && String(posibleTexto).trim() !== '') {
    const idFromText = await obtenerIdDesdeCatalogo(categoria, posibleTexto);
    if (idFromText) return idFromText;
  }

  // 2) Si viene un "id" numérico, verifica que exista para esa categoría
  if (posibleId != null) {
    const raw = String(posibleId).trim();

    // a) Si es numérico, valida que realmente sea un ID existente
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) {
      const [r] = await db.query(
        `SELECT id FROM catalogo_simple WHERE categoria = ? AND id = ? LIMIT 1`,
        [categoria, n]
      );
      if (r[0]?.id) return n; // ✅ es un ID real de esta categoría
      // b) Si no existe como ID, trátalo como TEXTO (ej. "25" que en realidad es valor)
      const idFromText = await obtenerIdDesdeCatalogo(categoria, raw);
      if (idFromText) return idFromText;
    }

    // c) Si no es numérico, intenta como texto
    const idFromText = await obtenerIdDesdeCatalogo(categoria, raw);
    if (idFromText) return idFromText;
  }

  return null;
}

/* ------------------------- codagrupa sin timezone ------------------------ */

function buildCodAgrupa(fechaISO, idproducto, idvariedad, idempaque, idlongitud) {
  try {
    const fechaBase = String(fechaISO || hoyEcuador);
    const [yyyy, mmStr, ddStr] = fechaBase.slice(0, 10).split('-');
    const mm = Number(mmStr); // sin leading zero
    const dd = Number(ddStr); // sin leading zero
    const yy = String(yyyy).slice(-2);
    return `${mm}${dd}${yy}${idproducto}${idvariedad}${idempaque}${idlongitud}`;
  } catch {
    return '';
  }
}

/* ---------------------------- Guardar movimientos ---------------------------- */

// ✅ POST: Guardar múltiples movimientos (acepta IDs o textos; guarda codagrupa)
router.post('/guardar-movimientos', async (req, res) => {
  const movimientos = req.body;

  if (!Array.isArray(movimientos)) {
    return res.status(400).json({ error: 'Formato incorrecto: se esperaba un array' });
  }

  try {
    for (const mov of movimientos) {
      const {
        fecha,
        tipo_movimiento,
        origen,

        // pueden venir como ID o como texto
        idproducto,
        producto,
        idvariedad,
        variedad,
        idlongitud,
        longitud,
        idempaque,
        empaque,

        cantidad,
        idmovimiento,
        idproveedor,
        codagrupa: codagrupaDesdeUI
      } = mov;

      // Usa la fecha enviada o la actual en Ecuador
      const fechaDia = fecha || hoyEcuador;

      // Resuelve cada catálogo (ID directo o lookup por valor)
      const idProd = await resolverId('producto', idproducto, producto);
      const idVar = await resolverId('variedad', idvariedad, variedad);
      const idLon = await resolverId('longitud', idlongitud, longitud);
      const idEmp = await resolverId('empaque', idempaque, empaque);

      if (!idProd || !idVar || !idLon || !idEmp) {
        console.warn('❌ Registro omitido por falta de datos:', {
          fecha: fechaDia,
          tipo_movimiento,
          origen,
          idproducto: idProd ?? null,
          idvariedad: idVar ?? null,
          idempaque: idEmp ?? null,
          idlongitud: idLon ?? null,
          cantidad,
          idproveedor,
          codagrupa: codagrupaDesdeUI ?? null
        });
        continue;
      }

      // codagrupa: usa el que venga del UI; si no, constrúyelo con los IDs
      const codagrupaFinal =
        codagrupaDesdeUI && String(codagrupaDesdeUI).trim() !== ''
          ? String(codagrupaDesdeUI).trim()
          : buildCodAgrupa(fechaDia, idProd, idVar, idEmp, idLon);

      await db.query(
        `INSERT INTO inventario_flor (
          fecha, tipo_movimiento, origen,
          idproducto, idvariedad, idempaque, idlongitud,
          cantidad, idproveedor, idmovimiento, codagrupa
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fechaDia,
          tipo_movimiento,
          origen,
          idProd,
          idVar,
          idEmp,
          idLon,
          Number(cantidad) || 0,
          idproveedor || null,
          idmovimiento || null,
          codagrupaFinal || ''
        ]
      );
    }

    // mantenemos la respuesta original para no romper el frontend
    res.json({ ok: true, cantidad: movimientos.length });
  } catch (error) {
    console.error('❌ Error al guardar movimientos de flor:', error);
    res.status(500).json({ error: 'Error interno al guardar movimientos' });
  }
});

/* ------------------------------- Catálogo Reglas ------------------------------ */

router.get('/reglas-ingreso', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, valor
      FROM catalogo_simple
      WHERE categoria = 'regla_ingreso'
    `);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener reglas de ingreso:', error);
    res.status(500).json({ error: 'Error al obtener reglas de ingreso' });
  }
});

/* ----------------------------------- Resumen ---------------------------------- */

// ✅ Resumen agrupado por codagrupa (usa codagrupa de la vista)
router.get('/resumen', async (req, res) => {
  try {
    const fecha = req.query.fecha;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro de fecha' });

    const [rows] = await db.query(
      `
      SELECT
        t.codagrupa,
        t.idmovimiento,
        t.idproducto,
        t.idvariedad,
        t.producto,
        t.variedad,
        t.empaque,
        t.longitud,
        t.idempaque,
        t.idlongitud,
        t.saldo_inicial,
        t.compras,
        t.proyeccion,
        t.ventas,
        t.orden_fija,
        t.preventa,
        CAST(COALESCE(t.saldo_inicial,0) + COALESCE(t.compras,0) - COALESCE(t.ventas,0) AS DECIMAL(18,2)) AS inv_post
      FROM (
        SELECT
          cs.id AS idmovimiento,              -- puede ser NULL
          f.codagrupa AS codagrupa,           -- ya normalizado en la vista
          f.idproducto,
          f.idvariedad,
          p.valor AS producto,
          v.valor AS variedad,
          e.valor AS empaque,
          l.valor AS longitud,
          f.idempaque,
          f.idlongitud,
          SUM(CASE WHEN f.tipo_movimiento = 'saldo_inicial' THEN f.cantidad ELSE 0 END) AS saldo_inicial,
          SUM(CASE WHEN f.tipo_movimiento = 'compras'       THEN f.cantidad ELSE 0 END) AS compras,
          SUM(CASE WHEN f.tipo_movimiento = 'proyeccion'    THEN f.cantidad ELSE 0 END) AS proyeccion,
          SUM(CASE WHEN f.tipo_movimiento = 'ventas'        THEN f.cantidad ELSE 0 END) AS ventas,
          SUM(CASE WHEN f.tipo_movimiento = 'orden_fija'    THEN f.cantidad ELSE 0 END) AS orden_fija,
          SUM(CASE WHEN f.tipo_movimiento = 'preventa'      THEN f.cantidad ELSE 0 END) AS preventa
        FROM v_inventario_flor f
        JOIN catalogo_simple p ON f.idproducto = p.id AND p.categoria = 'producto'
        JOIN catalogo_simple v ON f.idvariedad = v.id AND v.categoria = 'variedad'
        JOIN catalogo_simple e ON f.idempaque  = e.id AND e.categoria = 'empaque'
        JOIN catalogo_simple l ON f.idlongitud = l.id AND l.categoria = 'longitud'
        LEFT JOIN catalogo_simple cs
          ON cs.categoria = 'regla_ingreso'
         AND cs.valor = CONCAT(f.idproducto,'|',f.idvariedad,'|',f.idempaque,'|',f.idlongitud)
        WHERE f.fecha = ?
        GROUP BY
          f.codagrupa, cs.id,
          f.idproducto, f.idvariedad,
          producto, variedad, empaque, longitud,
          f.idempaque, f.idlongitud
      ) AS t
      ORDER BY t.producto, t.variedad, t.longitud
      `,
      [fecha]
    );

    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener resumen de inventario:', error);
    res.status(500).json({ error: 'Error al obtener resumen de inventario' });
  }
});

/* ----------------------------------- Detalle ---------------------------------- */

// ✅ Detalle por codagrupa + fecha (inventario + ventas). Flujo por idmovimiento queda legado.
router.get('/detalle', async (req, res) => {
  const { fecha, idmovimiento, codagrupa } = req.query;
  console.log('🟡 Detalle recibido:', { fecha, idmovimiento, codagrupa });

  if (!fecha) return res.status(400).json({ error: 'Falta el parámetro de fecha' });

  try {
    if (codagrupa) {
      const sql = `
        /* Inventario */
        SELECT 
          'inventario' AS fuente,
          f.idinventario,
          f.fecha,
          f.tipo_movimiento,
          f.origen,
          f.cantidad,
          f.idproveedor,
          t.nombre AS nombre_proveedor,
          NULL AS idcliente,
          NULL AS nombre_cliente
        FROM inventario_flor f
        LEFT JOIN terceros t ON f.idproveedor = t.idtercero
        WHERE DATE(f.fecha) = ?
          AND f.codagrupa = ?

        UNION ALL

        /* Ventas */
        SELECT
          'venta' AS fuente,
          d.iddetalle AS idinventario,
          d.fechacompra AS fecha,
          'ventas' AS tipo_movimiento,
          'propia' AS origen,
          d.totalRamos AS cantidad,                 -- ← totalRamos directo
          d.idproveedor,
          tp.nombre AS nombre_proveedor,
          fc.idcliente AS idcliente,
          cli.nombre AS nombre_cliente
        FROM factura_consolidada_detalle d
        LEFT JOIN terceros tp  ON d.idproveedor = tp.idtercero
        LEFT JOIN factura_consolidada fc ON fc.id = d.idfactura
        LEFT JOIN terceros cli ON cli.idtercero = fc.idcliente
        WHERE DATE(d.fechacompra) = ?
          AND d.codagrupa = ?
        ORDER BY fecha DESC, fuente DESC
      `;
      const [rows] = await db.query(sql, [fecha, codagrupa, fecha, codagrupa]);
      return res.json(rows);
    }

    // Legado por idmovimiento (inventario solo)
    if (!idmovimiento) {
      return res.status(400).json({ error: 'Faltan parámetros: idmovimiento o codagrupa' });
    }

    const [rows] = await db.query(
      `
      SELECT 
        f.idinventario,
        f.fecha,
        f.tipo_movimiento,
        f.origen,
        f.cantidad,
        f.idproveedor,
        t.nombre AS nombre_proveedor
      FROM inventario_flor f
      LEFT JOIN terceros t ON f.idproveedor = t.idtercero
      WHERE f.fecha = ?
        AND f.idmovimiento = ?
      ORDER BY f.fecha, f.tipo_movimiento
      `,
      [fecha, parseInt(idmovimiento)]
    );

    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener detalle de inventario:', error);
    res.status(500).json({ error: 'Error al obtener detalle' });
  }
});

module.exports = router;
