const express = require('express');
const router = express.Router();
const db = require('../db');
const verificarToken = require('../middlewares/verificarToken');
const registrarAuditoria = require('../utils/registrarAuditoria');
const generarPdfPorCodigo = require('../utils/generarPdfPorCodigo');
const generarPdfPacking = require('../utils/generarPdfPacking');
const { generarPdfInvoice } = require('../utils/generarPdfInvoice');

// Exportar Excel
const exportarExcelFactura = require('./exportarExcelController');
router.get('/exportar-excel/:idfactura', exportarExcelFactura);

const { generarPdfEtiquetas } = require('../utils/generarPdfEtiquetas');
const { enviarCorreoOrden, enviarCorreoInvoice } = require('../utils/correo');

function normalizarDecimal(valor) {
  if (typeof valor === 'string') {
    return parseFloat(valor.replace(',', '.')) || 0;
  }
  return Number(valor) || 0;
}

// Helpers usados por varias rutas (normalizar strings y fechas)
const normStr = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const normDate = (v) => {
  const s = normStr(v);
  if (s == null) return null;
  // acepta solo 'YYYY-MM-DD'
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

router.get('/:idfactura/etiquetas/pdf', async (req, res) => {
  const { idfactura } = req.params;
  const connection = await db.getConnection();

  try {
    const [rows] = await connection.query(
      `
      SELECT 
      f.iddetalle, f.codetiqueta, f.codigo, f.cantidadRamos, f.cantidadTallos, 
      f.idmix, f.cantidad, f.guia_master AS awb,
      t.nombre AS proveedor,
      v.valor AS variedad,
      l.valor AS longitud,
      (SELECT valor FROM catalogo_simple WHERE categoria = 'carguera' AND id = fc.idcarguera) AS carguera,
      cli.nombre AS cliente
    FROM factura_consolidada_detalle f
    LEFT JOIN terceros t ON t.idtercero = f.idproveedor
    LEFT JOIN catalogo_simple v ON v.id = f.idvariedad AND v.categoria = 'variedad'
    LEFT JOIN catalogo_simple l ON l.id = f.idlongitud AND l.categoria = 'longitud'
    JOIN factura_consolidada fc ON fc.id = f.idfactura
    JOIN terceros cli ON cli.idtercero = fc.idcliente
    WHERE f.idfactura = ?
    ORDER BY FIELD(f.idmix IS NULL, 0, 1), f.iddetalle
    `,
      [idfactura]
    );

    // Agrupar manualmente sin duplicar etiquetas si ya están asignadas
    const agrupados = {};

    for (const row of rows) {
      const key = row.idmix || `solo-${row.iddetalle}`;

      if (!agrupados[key]) {
        agrupados[key] = {
          codetiqueta: row.codetiqueta,
          finca: row.proveedor,
          origen: 'EC',
          awb: row.awb,
          cliente: row.cliente,
          carguera: row.carguera || 'AMS',
          code: row.codigo,
          cantidad: 1, // Solo una etiqueta por grupo o iddetalle
          totalBunch: Number(row.cantidadRamos || 0),
          detallesTabla: [
            {
              variedad: row.variedad,
              longitud: row.longitud,
              bunches: row.cantidadRamos,
              tallos: row.cantidadTallos
            }
          ]
        };
      } else {
        agrupados[key].totalBunch += Number(row.cantidadRamos || 0);
        agrupados[key].detallesTabla.push({
          variedad: row.variedad,
          longitud: row.longitud,
          bunches: row.cantidadRamos,
          tallos: row.cantidadTallos
        });
      }
    }

    const etiquetas = Object.values(agrupados);
    const pdfBuffer = await generarPdfEtiquetas(etiquetas);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=etiquetas.pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('❌ Error generando PDF de etiquetas:', error);
    res.status(500).json({ error: 'Error generando PDF de etiquetas' });
  } finally {
    connection.release();
  }
});

// Validar campos requeridos
const validarCampos = (campos) =>
  campos.every((campo) => campo !== undefined && campo !== null && campo !== '');

// Confirmar compra individual
router.post('/confirmar-compra', async (req, res) => {
  const {
    idfactura,
    idpedido,
    codigo,
    idproveedor,
    idproducto,
    idvariedad,
    idlongitud,
    idempaque,
    idtipocaja,
    cantidad,
    precio_unitario,
    idusuario,
    cantidadTallos,
    cantidadRamos,
    subtotal,
    tallos
  } = req.body;

  const camposReq = [
    idfactura,
    idpedido,
    codigo,
    idproveedor,
    idproducto,
    idvariedad,
    idlongitud,
    idempaque,
    idtipocaja,
    cantidad,
    precio_unitario,
    idusuario,
    cantidadTallos,
    cantidadRamos,
    subtotal,
    tallos
  ];
  if (!validarCampos(camposReq)) {
    return res.status(400).send('Faltan datos requeridos');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const cant = Number(cantidad) || 0;
    const totRamos = (Number(cantidadRamos) || 0) * (cant || 1);

    // 👇 Columnas y valores alineados 1:1 (NOW() completa la última)
    await conn.query(
      `
      INSERT INTO factura_consolidada_detalle (
        idfactura, idpedido, codigo, idproveedor,
        idproducto, idvariedad, idlongitud, idempaque,
        idtipocaja, cantidad, precio_unitario,
        cantidadTallos, cantidadRamos, totalRamos, subtotal,
        idusuario, fechacompra
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        Number(idfactura),
        Number(idpedido),
        String(codigo || ''),
        idproveedor ?? null,
        idproducto ?? null,
        idvariedad ?? null,
        idlongitud ?? null,
        idempaque ?? null,
        idtipocaja ?? null,
        cant,
        Number(precio_unitario) || 0,
        Number(cantidadTallos) || 0,
        Number(cantidadRamos) || 0,
        totRamos,
        Number(subtotal) || 0,
        Number(idusuario) || 0
      ]
    );

    // Actualiza el pedido (usa tallos de la compra)
    await conn.query(
      `
      UPDATE pedidos
      SET
        cantidad = IFNULL(cantidad, 0) - ?,
        totaltallos = IFNULL(totaltallos, 0) - (? * ?)
      WHERE idpedido = ?
      `,
      [cant, cant, Number(tallos) || 0, Number(idpedido)]
    );

    await conn.commit();
    res.status(200).json({ success: true, message: '✅ Compra guardada y pedido actualizado' });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error en confirmar-compra:', err.message);
    res.status(500).send('Error al guardar compra');
  } finally {
    conn.release();
  }
});

// ✅ Confirmar compras múltiples
router.post('/confirmar-compras-multiples', async (req, res) => {
  const compras = req.body;

  if (!Array.isArray(compras) || compras.length === 0) {
    return res.status(400).json({ error: 'No hay datos para procesar' });
  }

  const idusuario = compras[0]?.idusuario || 1;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ✅ Preparar valores para el insert
    const values = compras.map((c) => [
      c.idfactura,
      c.idpedido,
      c.codigo,
      c.idproveedor,
      c.idproducto,
      c.idvariedad,
      c.idlongitud,
      c.idempaque,
      c.idtipocaja,
      c.cantidad,
      c.precio_unitario,
      c.cantidadTallos,
      c.cantidadRamos,
      Number(c.cantidadRamos) * Number(c.cantidad), // totalRamos
      c.subtotal,
      idusuario,
      new Date(),
      c.idmix || null,
      c.tallos,
      c.idOrder || null,
      c.gramaje || null,
      5 // idgrupo fijo
    ]);

    // ✅ Insertar en factura_consolidada_detalle (22 columnas)
    await conn.query(
      `
      INSERT INTO factura_consolidada_detalle (
        idfactura, idpedido, codigo, idproveedor,
        idproducto, idvariedad, idlongitud, idempaque,
        idtipocaja, cantidad, precio_unitario, 
        cantidadTallos, cantidadRamos, totalRamos, subtotal,
        idusuario, fechacompra, idmix, tallos,
        idOrder, gramaje, idgrupo
      ) VALUES ?
      `,
      [values]
    );

    // ✅ Actualizar pedidos originales
    for (const c of compras) {
      if (c.idpedido && c.cantidadTallos) {
        await conn.query(
          `
          UPDATE pedidos
          SET 
            cantidad = IFNULL(cantidad, 0) - ?,
            totaltallos = IFNULL(totaltallos, 0) - ?
          WHERE idpedido = ?
        `,
          [c.cantidad, c.cantidadTallos, c.idpedido]
        );

        // ✅ Poner idproveedor = NULL si queda saldo
        await conn.query(
          `UPDATE pedidos SET idproveedor = NULL WHERE idpedido = ? AND cantidad > 0`,
          [c.idpedido]
        );
      }
    }

    // ✅ Obtener pedidos actualizados
    const idsPedidosAfectados = compras.map((c) => c.idpedido).filter((id) => id);

    let actualizados = [];
    if (idsPedidosAfectados.length) {
      const [rows] = await conn.query(
        `SELECT * FROM pedidos WHERE idpedido IN (${idsPedidosAfectados.map(() => '?').join(',')})`,
        idsPedidosAfectados
      );

      actualizados = rows.map((r) => ({
        ...r,
        id: Number(r.idpedido)
      }));
    }

    const idsEliminados = actualizados.filter((r) => Number(r.cantidad) <= 0).map((r) => r.id);
    actualizados = actualizados.filter((r) => Number(r.cantidad) > 0);

    await conn.commit();

    res.json({
      success: true,
      message: '✅ Compras múltiples registradas y pedidos actualizados',
      actualizados,
      idsEliminados
    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error en confirmar-compras-múltiples:', err.message);
    res.status(500).send('Error al guardar compras múltiples');
  } finally {
    conn.release();
  }
});

// ✅ Copiar múltiples detalles a otra factura (sin afectar pedidos)
router.post('/copiar-detalles', async (req, res) => {
  const { ids, idfacturaDestino } = req.body;
  const idusuario = req.user?.id || req.user?.idusuario || req.body?.idusuario || null;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No se enviaron IDs válidos' });
  }
  if (!idfacturaDestino) {
    return res.status(400).json({ error: 'Falta idfacturaDestino' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1️⃣ Validar que el destino esté en proceso
    const [[dest]] = await conn.query(
      `SELECT estado FROM factura_consolidada WHERE id = ? LIMIT 1`,
      [idfacturaDestino]
    );
    if (!dest) {
      await conn.rollback();
      return res.status(404).json({ error: 'Factura destino no existe' });
    }
    if (String(dest.estado).toLowerCase() !== 'proceso') {
      await conn.rollback();
      return res.status(400).json({ error: 'La factura destino no está en estado "proceso"' });
    }

    // 2️⃣ Traer filas a copiar (NO incluye documento_proveedor ni guia_master)
    const [rows] = await conn.query(
      `
      SELECT 
        iddetalle,
        idfactura,
        codigo,
        idgrupo,
        idproveedor,
        idproducto,
        idvariedad,
        idlongitud,
        idempaque,
        idtipocaja,
        cantidad,
        piezas,
        precio_unitario,
        precio_venta,
        tallos,
        cantidadTallos,
        cantidadRamos,
        totalRamos,
        subtotal,
        subtotalVenta,
        idmix,
        peso,
        esramo
      FROM factura_consolidada_detalle
      WHERE iddetalle IN (${ids.map(() => '?').join(',')})
      `,
      ids
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'No se encontraron registros para copiar' });
    }

    // 3️⃣ Mapear idmix origen -> idmix nuevo en destino (para mantener los grupos)
    const mixesOrigen = [...new Set(rows.map((r) => r.idmix).filter((v) => v !== null))];
    let maxMixDestino = 0;
    if (mixesOrigen.length > 0) {
      const [[m]] = await conn.query(
        `SELECT IFNULL(MAX(idmix), 0) AS maxMix
           FROM factura_consolidada_detalle
          WHERE idfactura = ?`,
        [idfacturaDestino]
      );
      maxMixDestino = Number(m?.maxMix || 0);
    }

    const mapMix = {};
    for (const mix of mixesOrigen) {
      maxMixDestino += 1;
      mapMix[mix] = maxMixDestino;
    }

    // 4️⃣ Preparar valores (incluye precio_venta y esramo; NO documento_proveedor, NO guia_master)
    const values = rows.map((r) => [
      Number(idfacturaDestino),
      r.codigo || '',
      isNaN(parseInt(r.idgrupo)) ? null : parseInt(r.idgrupo),
      isNaN(parseInt(r.idproveedor)) ? null : parseInt(r.idproveedor),
      isNaN(parseInt(r.idproducto)) ? null : parseInt(r.idproducto),
      isNaN(parseInt(r.idvariedad)) ? null : parseInt(r.idvariedad),
      isNaN(parseInt(r.idlongitud)) ? null : parseInt(r.idlongitud),
      isNaN(parseInt(r.idempaque)) ? null : parseInt(r.idempaque),
      isNaN(parseInt(r.idtipocaja)) ? null : parseInt(r.idtipocaja),
      Number(r.cantidad) || 0,
      Number(r.piezas) || 0,
      Number(r.precio_unitario) || 0,
      Number(r.precio_venta) || 0,
      Number(r.tallos) || 0,
      Number(r.cantidadTallos) || 0,
      Number(r.cantidadRamos) || 0,
      Number(r.totalRamos) || 0,
      Number(r.subtotal) || 0,
      Number(r.subtotalVenta) || 0,
      r.idmix === null ? null : mapMix[r.idmix],
      Number(r.peso) || 0,
      r.esramo === null || r.esramo === undefined
        ? null
        : Number(r.esramo) === 1 || r.esramo === true || r.esramo === '1'
          ? 1
          : 0,
      idusuario
    ]);

    const cols = `
      idfactura,
      codigo,
      idgrupo,
      idproveedor,
      idproducto,
      idvariedad,
      idlongitud,
      idempaque,
      idtipocaja,
      cantidad,
      piezas,
      precio_unitario,
      precio_venta,
      tallos,
      cantidadTallos,
      cantidadRamos,
      totalRamos,
      subtotal,
      subtotalVenta,
      idmix,
      peso,
      esramo,
      idusuario,
      fechacompra
    `;

    const perRowParams = values[0].length; // nº de ? antes de NOW()
    const rowPH = '(' + new Array(perRowParams).fill('?').join(', ') + ', NOW())';
    const placeholders = values.map(() => rowPH).join(', ');
    const flat = values.flat();

    await conn.query(
      `INSERT INTO factura_consolidada_detalle (${cols}) VALUES ${placeholders}`,
      flat
    );

    // 5️⃣ Auditoría (si tenemos usuario)
    if (idusuario) {
      await registrarAuditoria(
        conn,
        idusuario,
        'copiar',
        'factura_consolidada_detalle',
        `Copiados ${rows.length} registros a factura #${idfacturaDestino}`
      );
    }

    await conn.commit();
    res.json({
      success: true,
      message: `✅ ${rows.length} registros copiados a la factura destino`
    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error copiar-detalles:', err);
    res.status(500).json({ error: 'Error al copiar registros' });
  } finally {
    conn.release();
  }
});

// Crear factura (pedido en proceso)
router.post('/', verificarToken, async (req, res) => {
  // Campos que puede mandar el FE (algunos opcionales)
  let {
    numero_factura,
    idcliente,
    fecha, // si no llega => CURDATE()
    fecha_vuelo,
    fecha_entrega,
    idcarguera,
    awb,
    hawb,
    observaciones,
    idcliente_padre: idcliente_padre_body
  } = req.body || {};

  // Validación mínima: necesitamos al menos cliente
  if (!idcliente) {
    return res.status(400).json({ error: 'idcliente es requerido' });
  }

  // Normalizar vacíos a null
  const nil = (v) => (v === '' || v === undefined ? null : v);
  fecha_vuelo = nil(fecha_vuelo);
  fecha_entrega = nil(fecha_entrega);
  idcarguera = nil(idcarguera);
  awb = nil(awb);
  hawb = nil(hawb);
  observaciones = nil(observaciones);
  numero_factura = nil(numero_factura);

  const conn = await db.getConnection();
  try {
    // Obtener padre del cliente
    const [rows] = await conn.query(
      'SELECT idcliente_padre, idcarguera FROM terceros WHERE idtercero = ?',
      [idcliente]
    );
    if (!rows.length) {
      return res.status(400).json({ error: 'Cliente no existe' });
    }
    const idcliente_padre = (idcliente_padre_body ?? rows[0].idcliente_padre) || Number(idcliente);
    // Si el FE no manda idcarguera, usamos la del cliente
    if (idcarguera === undefined || idcarguera === null || idcarguera === '') {
      idcarguera = row.idcarguera || null;
    }

    // Insert cumpliendo el esquema (incluye tipoMovimiento/tipoDocumento)
    const [result] = await conn.query(
      `
      INSERT INTO factura_consolidada (
        numero_factura,
        idcliente,
        idcliente_padre,
        fecha,
        fecha_vuelo,
        fecha_entrega,
        idcarguera,
        awb,
        hawb,
        observaciones,
        estado,
        tipoMovimiento,
        tipoDocumento
      )
      VALUES (
        ?, ?, ?, 
        COALESCE(?, CURDATE()), ?, ?, ?, ?, ?, ?, 
        'proceso', 'C', 'F'
      )
      `,
      [
        numero_factura,
        idcliente,
        idcliente_padre,
        fecha,
        fecha_vuelo,
        fecha_entrega,
        idcarguera,
        awb,
        hawb,
        observaciones
      ]
    );

    const idFactura = result.insertId;

    await registrarAuditoria(
      conn,
      req.user.id,
      'crear',
      'facturas',
      `Factura #${idFactura} creada`
    );
    res.json({ message: '✅ Pedido creado', idFactura });
  } catch (err) {
    console.error('❌ Error al insertar factura:', err.message);
    res.status(500).json({ error: 'Error al insertar factura' });
  } finally {
    conn.release();
  }
});

// Obtener facturas con clientes
router.get('/facturas-con-clientes', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        f.id AS idfactura, f.numero_factura, f.fecha, f.fecha_vuelo,
        f.awb, f.hawb, f.idcarguera, f.iddae, f.estado,f.observaciones,
        f.idcliente, t.nombre AS cliente
      FROM factura_consolidada f
      JOIN terceros t ON f.idcliente = t.idtercero
      WHERE f.estado = 'proceso'
      ORDER BY f.fecha DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener facturas:', err.message);
    res.status(500).send('Error al obtener facturas');
  }
});

// Obtener detalle de factura
router.get('/factura-detalle/:idfactura', async (req, res) => {
  try {
    const [results] = await db.query(
      `
      SELECT *,
        IFNULL(cantidadRamos, 0) * IFNULL(cantidad, 1) AS totalRamos
      FROM factura_consolidada_detalle
      WHERE idfactura = ?
    `,
      [req.params.idfactura]
    );

    const normalizados = results.map((row) => ({
      ...row,
      subtotal: normalizarDecimal(row.subtotal),
      subtotalVenta: normalizarDecimal(row.subtotalVenta),
      peso: normalizarDecimal(row.peso),
      precio_unitario: normalizarDecimal(row.precio_unitario),
      precio_venta: normalizarDecimal(row.precio_venta),
      totalRamos: Number(row.totalRamos || 0)
    }));

    res.json(normalizados);
  } catch (err) {
    console.error('❌ Error al obtener detalles:', err.message);
    res.status(500).send('Error al obtener detalles');
  }
});

// Editar campo(s) del detalle
router.put('/factura-detalle/:iddetalle', async (req, res) => {
  const iddetalle = Number(req.params.iddetalle);
  const { campo, valor, campos } = req.body;

  if (!Number.isFinite(iddetalle)) {
    return res.status(400).send('iddetalle inválido');
  }

  // 🛡️ Lista blanca de columnas permitidas a actualizar
  const ALLOWED = new Set([
    'codigo',
    'idproveedor',
    'idproducto',
    'idvariedad',
    'idlongitud',
    'idempaque',
    'idtipocaja',
    'piezas',
    'cantidad',
    'cantidadRamos',
    'precio_unitario',
    'precio_venta',
    'tallos',
    'cantidadTallos',
    'totalRamos',
    'subtotal',
    'subtotalVenta',
    'documento_proveedor',
    'guia_master', // ← HAWB
    'fechacompra', // ← YYYY-MM-DD
    'idfactura', // traslado
    'esramo' // ← NUEVO (0/1)
  ]);

  const NUMERIC_FIELDS = new Set([
    'idproveedor',
    'idproducto',
    'idvariedad',
    'idlongitud',
    'idempaque',
    'idtipocaja',
    'piezas',
    'cantidad',
    'cantidadRamos',
    'precio_unitario',
    'precio_venta',
    'tallos',
    'cantidadTallos',
    'totalRamos',
    'subtotal',
    'subtotalVenta',
    'idfactura',
    'esramo' // ← NUEVO
  ]);

  const normStr = (v) => {
    if (v === undefined) return undefined; // distinguir "no enviado"
    if (v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };

  const normDate = (v) => {
    const s = normStr(v);
    if (s == null) return null;
    // acepta solo 'YYYY-MM-DD'
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const normValue = (key, v) => {
    if (key === 'fechacompra') return normDate(v);
    if (NUMERIC_FIELDS.has(key)) {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return normStr(v);
  };

  // 🔍 Campos que disparan recálculo automático
  // (OJO: ya NO recalculamos con 'cantidadRamos'; ahora es 'totalRamos')
  const RECALC_KEYS = new Set([
    'esramo',
    'cantidadTallos',
    'totalRamos',
    'precio_unitario',
    'precio_venta'
  ]);

  // Helper: obtener fila actual (solo si hace falta recalcular)
  const getFilaActual = async () => {
    const [rows] = await db.query(
      `SELECT cantidadTallos, totalRamos, precio_unitario, precio_venta, esramo
         FROM factura_consolidada_detalle
        WHERE iddetalle = ?`,
      [iddetalle]
    );
    return rows?.[0] || {};
  };

  // Helper: recalcular sub-totales con la regla
  const recalcular = (data) => {
    const toNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const cantidadTallos = toNum(data.cantidadTallos);
    const totalRamos = toNum(data.totalRamos);
    const precio_unitario = toNum(data.precio_unitario);
    const precio_venta = toNum(data.precio_venta);

    const esRamoFlag = data.esramo === 1 || data.esramo === true || data.esramo === '1';

    const subtotal = esRamoFlag
      ? Number((totalRamos * precio_unitario).toFixed(2))
      : Number((cantidadTallos * precio_unitario).toFixed(2));

    const subtotalVenta = esRamoFlag
      ? Number((totalRamos * precio_venta).toFixed(2))
      : Number((cantidadTallos * precio_venta).toFixed(2));

    return { subtotal, subtotalVenta };
  };

  // Determina si hay que recalcular por el set de claves enviado
  const requiereRecalc = (keys) => keys.some((k) => RECALC_KEYS.has(k));

  try {
    // ✅ Múltiples campos enviados como objeto
    if (campos && typeof campos === 'object') {
      const entries = Object.entries(campos)
        .filter(([k]) => ALLOWED.has(k))
        .map(([k, v]) => [k, normValue(k, v)]);

      if (!entries.length) {
        return res.status(400).send('Sin campos válidos para actualizar.');
      }

      const keys = entries.map(([k]) => k);
      const safeUpdate = {};
      for (const [k, v] of entries) safeUpdate[k] = v;

      // ¿Debemos recalcular?
      if (requiereRecalc(keys)) {
        // Fila actual para completar valores faltantes
        const actual = await getFilaActual();

        // Construir dataset efectivo con prioridad a lo enviado
        const data = {
          cantidadTallos: safeUpdate.cantidadTallos ?? actual.cantidadTallos,
          totalRamos: safeUpdate.totalRamos ?? actual.totalRamos,
          precio_unitario: safeUpdate.precio_unitario ?? actual.precio_unitario,
          precio_venta: safeUpdate.precio_venta ?? actual.precio_venta,
          esramo: safeUpdate.esramo ?? actual.esramo
        };

        const { subtotal, subtotalVenta } = recalcular(data);
        safeUpdate.subtotal = subtotal;
        safeUpdate.subtotalVenta = subtotalVenta;
      }

      await db.query('UPDATE factura_consolidada_detalle SET ? WHERE iddetalle = ?', [
        safeUpdate,
        iddetalle
      ]);

      return res.json({ success: true, updated: Object.keys(safeUpdate) });
    }

    // ✅ Compatibilidad: un solo campo
    if (campo && valor !== undefined) {
      if (!ALLOWED.has(campo)) {
        return res.status(400).send(`Campo no permitido: ${campo}`);
      }
      const v = normValue(campo, valor);

      // Si el campo único toca recálculo, calculamos y actualizamos en un solo UPDATE
      if (RECALC_KEYS.has(campo)) {
        const actual = await getFilaActual();
        const data = {
          cantidadTallos: campo === 'cantidadTallos' ? v : actual.cantidadTallos,
          totalRamos: campo === 'totalRamos' ? v : actual.totalRamos,
          precio_unitario: campo === 'precio_unitario' ? v : actual.precio_unitario,
          precio_venta: campo === 'precio_venta' ? v : actual.precio_venta,
          esramo: campo === 'esramo' ? v : actual.esramo
        };
        const { subtotal, subtotalVenta } = recalcular(data);

        // Armar update con los 3 campos (el editado + subtotales)
        const safeUpdate = { [campo]: v, subtotal, subtotalVenta };
        await db.query('UPDATE factura_consolidada_detalle SET ? WHERE iddetalle = ?', [
          safeUpdate,
          iddetalle
        ]);
        return res.json({ success: true, updated: Object.keys(safeUpdate) });
      }

      // Si no afecta cálculo, actualiza solo ese campo
      await db.query(
        `UPDATE factura_consolidada_detalle SET \`${campo}\` = ? WHERE iddetalle = ?`,
        [v, iddetalle]
      );
      return res.json({ success: true, updated: [campo] });
    }

    return res.status(400).send('Solicitud inválida: especifica "campo y valor" o "campos".');
  } catch (err) {
    console.error('❌ Error al actualizar detalle:', err.message);
    res.status(500).send('Error al actualizar detalle');
  }
});

// Editar encabezado de factura
router.put('/factura/:id', async (req, res) => {
  const { campo, valor } = req.body;
  const id = Number(req.params.id);

  if (!campo) return res.status(400).send('Campo requerido');
  if (!Number.isFinite(id)) return res.status(400).send('Id inválido');

  try {
    // 🔒 Validación especial para número de factura (clientes)
    if (campo === 'numero_factura') {
      const numero = valor == null ? null : String(valor).trim();

      if (!numero) {
        return res.status(400).json({ error: 'El número de factura es obligatorio' });
      }

      // ¿Ya existe otra factura de clientes con ese número?
      const [[existe]] = await db.query(
        `
        SELECT id
        FROM factura_consolidada
        WHERE tipoMovimiento = 'C'
          AND tipoDocumento = 'F'
          AND numero_factura = ?
          AND id <> ?
        LIMIT 1
      `,
        [numero, id]
      );

      if (existe) {
        return res.status(400).json({ error: `El número de factura ${numero} ya existe` });
      }

      await db.query('UPDATE factura_consolidada SET numero_factura = ? WHERE id = ?', [
        numero,
        id
      ]);

      return res.json({ success: true });
    }

    // 🔁 Resto de campos: comportamiento normal
    await db.query(`UPDATE factura_consolidada SET \`${campo}\` = ? WHERE id = ?`, [valor, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al actualizar factura:', err.message);
    res.status(500).send('Error al actualizar factura');
  }
});

// Obtener máximo número de factura solo para tipoMovimiento = 'C'
router.get('/max-numero', async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT MAX(CAST(numero_factura AS UNSIGNED)) AS max
      FROM factura_consolidada
      WHERE tipoMovimiento = 'C'
    `);
    res.json({ max: results[0].max || 0 });
  } catch (err) {
    console.error('❌ Error al obtener número de factura:', err.message);
    res.status(500).json({ error: 'Error al obtener número' });
  }
});

// Obtener códigos por cliente
router.get('/codigos-por-cliente', async (req, res) => {
  const { idcliente } = req.query;
  if (!idcliente) return res.status(400).json({ error: 'Falta el parámetro idcliente' });

  try {
    const [results] = await db.query(
      `
      SELECT DISTINCT d.codigo
      FROM factura_consolidada_detalle d
      JOIN factura_consolidada f ON d.idfactura = f.id
      WHERE f.idcliente = ? AND d.codigo IS NOT NULL AND d.codigo <> ''
      ORDER BY d.codigo
    `,
      [idcliente]
    );

    res.json(results.map((r) => r.codigo));
  } catch (err) {
    console.error('❌ Error al obtener códigos:', err.message);
    res.status(500).json({ error: 'Error al obtener códigos' });
  }
});

// Calcular pesos (sólidas y mixtas)
router.post('/calcular-pesos/:idFactura', async (req, res) => {
  const { idFactura } = req.params;

  try {
    // Traer todos los detalles de la factura
    const [detalles] = await db.query(
      `
      SELECT iddetalle, idproducto, idtipocaja, tallos, cantidad, idmix
      FROM factura_consolidada_detalle
      WHERE idfactura = ?
    `,
      [idFactura]
    );

    // Cargar reglas de peso desde el catálogo
    const [reglasRaw] = await db.query(`
      SELECT valor FROM catalogo_simple WHERE categoria = 'regla_peso'
    `);

    const reglas = reglasRaw.map((r) => {
      const [idtipocaja, idproducto, rango, peso] = r.valor.split('|');
      return {
        idtipocaja: parseInt(idtipocaja),
        idproducto: parseInt(idproducto),
        rango,
        peso: parseFloat(peso)
      };
    });

    // Función para encontrar el peso aplicable según reglas
    const buscarPesoPorRegla = (idtipocaja, idproducto, totalTallos) => {
      for (const regla of reglas) {
        const [min, max] = regla.rango.split('-').map(Number);
        if (
          idtipocaja === regla.idtipocaja &&
          idproducto === regla.idproducto &&
          totalTallos >= min &&
          totalTallos <= max
        ) {
          return regla.peso;
        }
      }
      return 0.0;
    };

    // Agrupar por idmix
    const detallesSolidos = detalles.filter((d) => d.idmix === null);
    const detallesMixtos = detalles.filter((d) => d.idmix !== null);

    // 🔹 1. Procesar sólidos normalmente
    for (const detalle of detallesSolidos) {
      const pesoUnitario = buscarPesoPorRegla(
        detalle.idtipocaja,
        detalle.idproducto,
        detalle.tallos
      );
      const pesoTotal = pesoUnitario * (detalle.cantidad || 1);
      await db.query(
        `
        UPDATE factura_consolidada_detalle
        SET peso = ?
        WHERE iddetalle = ?
      `,
        [pesoTotal, detalle.iddetalle]
      );
    }

    // 🔹 2. Procesar mixes agrupados por idmix
    const mixesPorId = {};

    for (const detalle of detallesMixtos) {
      if (!mixesPorId[detalle.idmix]) {
        mixesPorId[detalle.idmix] = [];
      }
      mixesPorId[detalle.idmix].push(detalle);
    }

    for (const idmix in mixesPorId) {
      const grupo = mixesPorId[idmix];

      // ⚠️ Usamos el primer ítem como base para idtipocaja y producto
      const primer = grupo[0];
      const totalTallos = grupo.reduce((sum, d) => sum + Number(d.tallos || 0), 0);

      if (totalTallos === 0) {
        console.warn(`⚠️ Mix con idmix ${idmix} tiene 0 tallos. Se omite el cálculo de peso.`);
        continue;
      }

      const pesoTotalMix = buscarPesoPorRegla(primer.idtipocaja, primer.idproducto, totalTallos);

      for (const item of grupo) {
        const porcentaje = (item.tallos || 0) / totalTallos;
        const pesoItem = parseFloat((pesoTotalMix * porcentaje).toFixed(3));
        await db.query(
          `
          UPDATE factura_consolidada_detalle
          SET peso = ?
          WHERE iddetalle = ?
        `,
          [pesoItem, item.iddetalle]
        );
      }
    }

    res.status(200).json({ message: '✅ Pesos calculados correctamente en factura' });
  } catch (err) {
    console.error('❌ Error al calcular pesos:', err.message);
    res.status(500).json({ error: 'Error al calcular pesos en factura' });
  }
});

// ✅ Obtener proveedores únicos de una factura por su id real
router.get('/:idfactura/proveedores', async (req, res) => {
  const { idfactura } = req.params;

  try {
    const [rows] = await db.query(
      `
      SELECT DISTINCT t.idtercero AS idproveedor, t.nombre, t.correo
      FROM factura_consolidada_detalle d
      JOIN terceros t ON t.idtercero = d.idproveedor
      WHERE d.idfactura = ?
        AND t.tipo = 'proveedor'
    `,
      [idfactura]
    );

    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener proveedores de la factura:', error.message);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

//generar pdf orden compra
const generarPdfProveedor = require('../utils/generarPdfProveedor');
router.post('/:idfactura/orden/ver', async (req, res) => {
  const { idfactura } = req.params;
  const { proveedores } = req.body;

  if (!Array.isArray(proveedores) || proveedores.length === 0) {
    return res.status(400).json({ error: 'Debes seleccionar al menos un proveedor' });
  }

  try {
    const resultados = {};

    for (const idproveedor of proveedores) {
      const [detalle] = await db.query(
        `
        SELECT f.*, t.nombre AS proveedor
        FROM factura_consolidada_detalle f
        JOIN terceros t ON t.idtercero = f.idproveedor
        WHERE f.idfactura = ? AND f.idproveedor = ?
      `,
        [idfactura, idproveedor]
      );

      if (!detalle.length) continue;

      const pdfBuffer = await generarPdfProveedor(detalle);
      resultados[idproveedor] = pdfBuffer.toString('base64');
    }

    res.json(resultados);
  } catch (err) {
    console.error('❌ Error al generar vista previa de órdenes:', err.message);
    res.status(500).json({ error: 'Error al generar orden de compra' });
  }
});

// enviar correo orden de compra proveedores
const enviarCorreoOrden = require('../utils/correo');
router.post('/:idfactura/orden/enviar', async (req, res) => {
  const { idfactura } = req.params;
  const { proveedores } = req.body;

  if (!Array.isArray(proveedores) || proveedores.length === 0) {
    return res.status(400).json({ error: 'Debes seleccionar al menos un proveedor' });
  }

  try {
    for (const idproveedor of proveedores) {
      const [detalle] = await db.query(
        `
        SELECT d.*, t.nombre AS proveedorNombre, t.correo
        FROM factura_consolidada_detalle d
        JOIN terceros t ON t.idtercero = d.idproveedor
        WHERE d.idfactura = ? AND d.idproveedor = ?
      `,
        [idfactura, idproveedor]
      );

      if (!detalle.length || !detalle[0].correo) {
        console.warn(`⚠️ Proveedor ${idproveedor} sin correo registrado o sin detalle`);
        continue;
      }

      const pdfBuffer = await generarPdfProveedor(detalle);
      await enviarCorreoOrden(detalle[0].correo, pdfBuffer, detalle[0].proveedorNombre, idfactura);
    }

    res.json({ success: true, message: '📧 Órdenes enviadas correctamente' });
  } catch (err) {
    console.error('❌ Error al enviar órdenes:', err.message);
    res.status(500).json({ error: 'Error al enviar órdenes de compra' });
  }
});

// ✅ Listar facturas por rango de fecha (nuevo endpoint)
router.get('/listar', async (req, res) => {
  const { desde, hasta } = req.query;

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Debes proporcionar las fechas "desde" y "hasta"' });
  }

  try {
    const [rows] = await db.query(
      `
      SELECT 
        f.id AS idfactura, f.numero_factura, f.fecha, f.fecha_vuelo,observaciones,f.fecha_entrega,
        f.awb, f.hawb, f.idcarguera, f.iddae, f.estado,
        f.idcliente, t.nombre AS cliente
      FROM factura_consolidada f
      JOIN terceros t ON f.idcliente = t.idtercero
      WHERE f.fecha BETWEEN ? AND ?
        AND f.tipoMovimiento = 'C'
        AND f.tipoDocumento = 'F'
      ORDER BY f.fecha DESC
      `,
      [desde, hasta]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener facturas por fecha:', err.message);
    res.status(500).json({ error: 'Error al obtener facturas por fecha' });
  }
});

// Actualizar factura
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { numero_factura, idcliente, fecha, fecha_vuelo, fecha_entrega } = req.body;

  try {
    await db.query(
      `UPDATE factura_consolidada 
       SET numero_factura = ?, idcliente = ?, fecha = ?, fecha_vuelo = ?, fecha_entrega = ?
       WHERE id = ?`,
      [numero_factura, idcliente, fecha, fecha_vuelo, fecha_entrega, id]
    );

    res.json({ message: 'Factura actualizada correctamente' });
  } catch (err) {
    console.error('❌ Error al actualizar factura:', err);
    res.status(500).json({ error: 'Error al actualizar factura' });
  }
});

//Eliminar Factura sin confirmar
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const [[detalleCount]] = await conn.query(
      `
      SELECT COUNT(*) AS total FROM factura_consolidada_detalle WHERE idfactura = ?
    `,
      [id]
    );

    const [[pedidosCount]] = await conn.query(
      `
      SELECT COUNT(*) AS total FROM pedidos WHERE idfactura = ?
    `,
      [id]
    );

    const totalRelacionados = detalleCount.total + pedidosCount.total;

    if (totalRelacionados > 0) {
      return res.status(409).json({
        relacionados: true,
        message: `⚠️ Esta factura tiene ${detalleCount.total} compras y ${pedidosCount.total} pedidos relacionados.`
      });
    }

    // Si no tiene relaciones, eliminar normalmente
    await conn.query('DELETE FROM factura_consolidada WHERE id = ?', [id]);
    res.json({ success: true, message: '✅ Factura eliminada' });
  } catch (err) {
    console.error('❌ Error al eliminar factura:', err.message);
    res.status(500).json({ error: 'Error al eliminar factura' });
  } finally {
    conn.release();
  }
});

// Elimina con verificación y auditoría
router.delete('/eliminar/:id', verificarToken, async (req, res) => {
  const id = req.params.id;
  const idusuario = req.user.idusuario;
  const conn = await db.getConnection();

  try {
    const [[detalleCount]] = await conn.query(
      `SELECT COUNT(*) AS total FROM factura_consolidada_detalle WHERE idfactura = ?`,
      [id]
    );

    const [[pedidosCount]] = await conn.query(
      `SELECT COUNT(*) AS total FROM pedidos WHERE idfactura = ?`,
      [id]
    );

    if (detalleCount.total > 0 || pedidosCount.total > 0) {
      return res.status(409).json({
        warning: true,
        mensaje: '🚫 No se puede eliminar este pedido porque tiene registros vinculados.'
      });
    }

    await conn.query(`DELETE FROM factura_consolidada WHERE id = ?`, [id]);

    // 📝 Registrar en la auditoría
    await registrarAuditoria(conn, idusuario, 'eliminar', 'facturas', `Factura #${id} eliminada`);

    res.json({ success: true, mensaje: '✅ Factura eliminada correctamente.' });
  } catch (err) {
    console.error('❌ Error al eliminar factura:', err.message);
    res.status(500).json({ error: 'Error al eliminar factura' });
  } finally {
    conn.release();
  }
});

// Finalizar Factura con eliminación de pedidos y generación de cartera
router.put('/finalizar/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const idusuario = req.user.idusuario;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1️⃣ Cambiar estado de la factura CLIENTE a 'listo'
    await conn.query(`UPDATE factura_consolidada SET estado = 'listo' WHERE id = ?`, [id]);

    // 2️⃣ Eliminar todos los pedidos vinculados
    const [result] = await conn.query(`DELETE FROM pedidos WHERE idfactura = ?`, [id]);

    const pedidosEliminados = result.affectedRows;

    // 3️⃣ Auditoría
    await registrarAuditoria(
      conn,
      idusuario,
      'finalizar',
      'facturas',
      `Factura #${id} finalizada. Se eliminaron ${pedidosEliminados} pedidos.`
    );

    // 4️⃣ Datos base de la factura (cliente)
    const [facturaBaseRows] = await conn.query(
      `SELECT idcliente, fecha FROM factura_consolidada WHERE id = ?`,
      [id]
    );

    if (!facturaBaseRows.length) {
      throw new Error('Factura base no encontrada.');
    }

    const facturaBase = facturaBaseRows[0];

    // 5️⃣ Obtener totales por proveedor
    const [totalesProveedores] = await conn.query(
      `
      SELECT 
        idproveedor, 
        documento_proveedor AS numero_factura, 
        SUM(subtotal) AS total
      FROM factura_consolidada_detalle
      WHERE idfactura = ? AND idproveedor IS NOT NULL
      GROUP BY idproveedor, documento_proveedor
      `,
      [id]
    );

    // Validar y registrar por cada proveedor
    for (const prov of totalesProveedores) {
      const idproveedor = prov.idproveedor;
      const numeroFacturaProveedor = prov.numero_factura?.trim();
      const totalProveedor = prov.total;

      // ⚠️ Validar que tenga número de factura
      if (!numeroFacturaProveedor) {
        throw new Error(
          `El proveedor con ID ${idproveedor} no tiene número de factura asignado. Debes completar el número de factura antes de finalizar.`
        );
      }

      // ⚠️ Verificar duplicados para ese proveedor
      const [dupCheck] = await conn.query(
        `
        SELECT COUNT(*) AS count
        FROM factura_consolidada
        WHERE idcliente = ?
          AND tipoMovimiento = 'P'
          AND numero_factura = ?
        `,
        [idproveedor, numeroFacturaProveedor]
      );

      if (dupCheck[0].count > 0) {
        throw new Error(
          `Ya existe una factura del proveedor #${idproveedor} con número ${numeroFacturaProveedor}. No se pueden duplicar números para el mismo proveedor.`
        );
      }

      // ✅ Insertar en cartera (movimiento proveedor) con idcartera = id (de factura cliente)
      await conn.query(
        `
        INSERT INTO factura_consolidada (
          numero_factura, idcliente, fecha, estado,
          tipoMovimiento, tipoDocumento, valorTotal, idcartera
        )
        VALUES (?, ?, ?, 'listo', 'P', 'F', ?, ?)
        `,
        [numeroFacturaProveedor, idproveedor, facturaBase.fecha, totalProveedor, id]
      );
    }

    // 6️⃣ Calcular total CLIENTE
    const [totalClienteRows] = await conn.query(
      `
      SELECT SUM(subtotalVenta) AS total
      FROM factura_consolidada_detalle
      WHERE idfactura = ?
      `,
      [id]
    );

    const totalCliente = totalClienteRows[0]?.total || 0;

    // 7️⃣ Actualizar factura original (cliente) con tipoMovimiento, valorTotal e idcartera
    await conn.query(
      `
      UPDATE factura_consolidada
      SET valorTotal = ?, tipoMovimiento = 'C', tipoDocumento = 'F', idcartera = ?
      WHERE id = ?
      `,
      [totalCliente, id, id]
    );

    await conn.commit();

    res.json({
      success: true,
      message: '✅ Factura finalizada, pedidos eliminados y cartera generada correctamente.'
    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error al finalizar factura:', err.message);
    res.status(500).json({ error: err.message || 'Error al finalizar factura' });
  } finally {
    conn.release();
  }
});

// liberar factura (cualquier usuario autenticado)
router.put('/liberar/:id', verificarToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1) Eliminar P/F del idcartera
    const [delPF] = await conn.query(
      `DELETE FROM factura_consolidada
       WHERE idcartera = ?
         AND tipoMovimiento = 'P'
         AND tipoDocumento = 'F'`,
      [id]
    );

    // 2) Poner la factura en 'proceso'
    const [updF] = await conn.query(
      `UPDATE factura_consolidada
         SET estado = 'proceso'
       WHERE idcartera = ?
         AND tipoDocumento = 'F'`,
      [id]
    );

    let filasEstadoActualizadas = updF.affectedRows;
    if (filasEstadoActualizadas === 0) {
      const [updAll] = await conn.query(
        `UPDATE factura_consolidada
           SET estado = 'proceso'
         WHERE idcartera = ?`,
        [id]
      );
      filasEstadoActualizadas = updAll.affectedRows;
    }

    await registrarAuditoria(
      conn,
      req.user.id || req.user.idusuario, // 👉 cualquier usuario autenticado
      'liberar',
      'factura_consolidada',
      `Factura #${id} liberada — P/F borradas: ${delPF.affectedRows}, estado->proceso en ${filasEstadoActualizadas} fila(s)`
    );

    await conn.commit();

    return res.json({
      success: true,
      message: '✅ Factura liberada',
      eliminados_consolidada: delPF.affectedRows,
      filas_estado_actualizadas: filasEstadoActualizadas
    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error al liberar factura:', err.message);
    return res.status(500).json({ error: 'Error al liberar factura' });
  } finally {
    conn.release();
  }
});

// dividir cajas (con piezas)
router.post('/dividir-registro', async (req, res) => {
  const { iddetalle, cantidadDividir, idusuario } = req.body;
  const conn = await db.getConnection();

  try {
    if (!idusuario) {
      return res.status(400).json({ error: 'Usuario no proporcionado' });
    }

    await conn.beginTransaction();

    // Obtener el registro original
    const [originalRows] = await conn.query(
      'SELECT * FROM factura_consolidada_detalle WHERE iddetalle = ?',
      [iddetalle]
    );
    const original = originalRows[0];

    if (!original) {
      await conn.rollback();
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    const piezasOriginal = Number(original.piezas) || 0;
    const cantidadOriginal = Number(original.cantidad) || 0;
    // Base de reparto: si tiene piezas>0 usamos esas; si no, cantidad
    const baseOriginal = piezasOriginal > 0 ? piezasOriginal : cantidadOriginal;

    const cantidadDividirNum = Number(cantidadDividir) || 0;
    if (cantidadDividirNum < 1 || cantidadDividirNum >= baseOriginal) {
      await conn.rollback();
      return res.status(400).json({
        error: `Cantidad de división inválida. Debe ser mayor a 0 y menor que ${baseOriginal}.`
      });
    }

    // ¿Es MIX y esta fila es la primera del mix?
    let esMixPrimera = false;
    if (original.idmix != null) {
      const [[m]] = await conn.query(
        `SELECT MIN(iddetalle) AS first_id
           FROM factura_consolidada_detalle
          WHERE idmix = ?`,
        [original.idmix]
      );
      esMixPrimera = Number(original.iddetalle) === Number(m?.first_id || 0);
    }

    // Porciones proporcionales (usando baseOriginal)
    const partTallos = (Number(original.cantidadTallos) || 0) * (cantidadDividirNum / baseOriginal);
    const partRamos = (Number(original.cantidadRamos) || 0) * (cantidadDividirNum / baseOriginal);
    const partSubtotal = (Number(original.subtotal) || 0) * (cantidadDividirNum / baseOriginal);
    const piezasARestar = piezasOriginal > 0 ? cantidadDividirNum : 0; // sólo si el original tenía piezas
    const partSubtotalVenta =
      (Number(original.subtotalVenta) || 0) * (cantidadDividirNum / baseOriginal);

    // ✅ Actualizar registro original: restar cantidad y (si aplica) piezas
    await conn.query(
      `
      UPDATE factura_consolidada_detalle
   SET cantidad       = cantidad       - ?,
       piezas         = piezas         - ?,
       cantidadTallos = cantidadTallos - ?,
       cantidadRamos  = cantidadRamos  - ?,
       subtotal       = subtotal       - ?,
       subtotalVenta  = subtotalVenta  - ?
 WHERE iddetalle = ?

      `,
      [
        cantidadDividirNum,
        piezasARestar,
        partTallos,
        partRamos,
        partSubtotal,
        partSubtotalVenta,
        iddetalle
      ]
    );

    // ✅ Insertar el nuevo registro con la parte dividida
    // Reglas para "piezas" en el nuevo:
    // - Sólido (idmix NULL) y no-STEMS (piezasOriginal>0): piezas = cantidadDividirNum
    // - MIX (cualquiera) o STEMS (piezasOriginal=0): piezas = 0
    const piezasNueva = original.idmix == null && piezasOriginal > 0 ? cantidadDividirNum : 0;

    await conn.query(
      `
      INSERT INTO factura_consolidada_detalle (
  idfactura, idpedido, codigo, idproveedor, idproducto, idvariedad, idlongitud,
  idempaque, idtipocaja, cantidad, piezas, precio_unitario, precio_venta,
  cantidadTallos, cantidadRamos, subtotal, subtotalVenta,
  idusuario, fechacompra, idmix, tallos, idOrder, idgrupo
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)

      `,
      [
        original.idfactura,
        original.idpedido,
        original.codigo,
        original.idproveedor,
        original.idproducto,
        original.idvariedad,
        original.idlongitud,
        original.idempaque,
        original.idtipocaja,
        cantidadDividirNum,
        piezasNueva,
        original.precio_unitario,
        original.precio_venta, // 👈 NUEVO
        partTallos,
        partRamos,
        partSubtotal,
        partSubtotalVenta, // 👈 NUEVO
        idusuario,
        original.idmix,
        original.tallos,
        original.idOrder,
        original.idgrupo
      ]
    );

    await conn.commit();
    res.json({ success: true, message: '✅ División realizada' });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error al dividir registro:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ✅ Marcar o desmarcar pedido como seleccionado
router.put('/:idpedido/seleccionado', async (req, res) => {
  const { idpedido } = req.params;
  const { seleccionado } = req.body;

  if (typeof seleccionado !== 'boolean') {
    return res
      .status(400)
      .json({ error: 'El campo "seleccionado" es requerido y debe ser booleano' });
  }

  try {
    await db.query(`UPDATE pedidos SET seleccionado = ? WHERE idpedido = ?`, [
      seleccionado ? 1 : 0,
      idpedido
    ]);

    res.json({ success: true, message: `✅ Pedido #${idpedido} actualizado` });
  } catch (err) {
    console.error('❌ Error actualizando seleccionado:', err.message);
    res.status(500).json({ error: 'Error al actualizar campo seleccionado' });
  }
});

// ✅ Limpiar selección de todos los pedidos
router.put('/limpiar-seleccion', async (req, res) => {
  try {
    await db.query(`UPDATE pedidos SET seleccionado = 0`);
    res.json({ success: true, message: '✅ Todos los pedidos desmarcados' });
  } catch (err) {
    console.error('❌ Error limpiando selección:', err.message);
    res.status(500).json({ error: 'Error al limpiar selección' });
  }
});

// Obtener el siguiente idmix disponible por factura
router.get('/nuevo-idmix/:idfactura', async (req, res) => {
  const { idfactura } = req.params;
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      'SELECT MAX(idmix) AS maxMix FROM factura_consolidada_detalle WHERE idfactura = ? AND idmix IS NOT NULL',
      [idfactura]
    );
    const nuevoIdMix = (rows[0].maxMix || 0) + 1;
    res.json({ nuevoIdMix });
  } catch (err) {
    console.error('❌ Error al obtener nuevo idmix:', err);
    res.status(500).json({ error: '❌ Error al calcular idmix' });
  } finally {
    conn.release();
  }
});

// Función para obtener el siguiente idmix disponible por factura
async function obtenerNuevoIdMix(conn, idfactura) {
  const [rows] = await conn.query(
    `SELECT MAX(idmix) AS maxMix FROM factura_consolidada_detalle WHERE idfactura = ? AND idmix IS NOT NULL`,
    [idfactura]
  );
  return (rows[0].maxMix || 0) + 1;
}
// Ruta: agregar o duplicar registros (con PIEZAS y reglas mix/STEMS)
router.post('/factura-detalle', async (req, res) => {
  const {
    idfactura,
    codigo,
    idgrupo,
    idproveedor,
    idproducto,
    idvariedad,
    idlongitud,
    idempaque,
    idtipocaja,
    cantidad,
    piezas, // ⬅️ ahora aceptamos piezas
    precio_unitario,
    precio_venta, // ⬅️ precio de venta
    tallos,
    cantidadTallos,
    cantidadRamos,
    subtotal,
    subtotalVenta, // ⬅️ NUEVO: subtotalVenta
    peso,
    documento_proveedor,
    idusuario,
    idmix,
    generarNuevoMix,
    esramo // ⬅️ NUEVO: flag ramo/tallo
  } = req.body;

  if (!idfactura) {
    return res.status(400).json({ error: '⚠️ Falta el campo obligatorio: idfactura' });
  }

  const conn = await db.getConnection();
  try {
    let nuevoIdMix = idmix || null;

    // Si se solicita un mix nuevo, obtén uno
    if (generarNuevoMix) {
      nuevoIdMix = await obtenerNuevoIdMix(conn, idfactura);
    }

    // ¿Es STEMS? (tipocaja contiene "stem")
    let esStems = false;
    if (idtipocaja != null) {
      const [[tc]] = await conn.query(
        `SELECT valor FROM catalogo_simple WHERE categoria='tipocaja' AND id=? LIMIT 1`,
        [idtipocaja]
      );
      esStems = /stem/i.test(String(tc?.valor || ''));
    }

    const cant = parseInt(cantidad) || 0;
    const totalRamos = (Number(cantidadRamos) || 0) * (cant || 1);

    const esRamoFinal =
      esramo === undefined || esramo === null
        ? null
        : Number(esramo) === 1 || esramo === true || esramo === '1'
          ? 1
          : 0;

    // Regla de negocio para PIEZAS:
    // - STEMS => 0
    // - MIX   => solo la PRIMERA fila del idmix (en esta factura) puede llevar piezas>0
    // - SÓLIDA=> piezas(body) || cantidad
    let piezasFinal = 0;

    if (esStems) {
      piezasFinal = 0;
    } else if (nuevoIdMix == null) {
      // sólido
      piezasFinal = piezas !== undefined && piezas !== null ? Number(piezas) || 0 : cant;
    } else {
      // mix
      const [[ex]] = await conn.query(
        `SELECT COUNT(*) AS c 
           FROM factura_consolidada_detalle 
          WHERE idfactura = ? AND idmix = ?`,
        [idfactura, nuevoIdMix]
      );
      const yaExisteAlgunaFilaDeEseMix = Number(ex?.c || 0) > 0;
      if (yaExisteAlgunaFilaDeEseMix) {
        piezasFinal = 0; // no es la primera fila del mix
      } else {
        piezasFinal = piezas !== undefined && piezas !== null ? Number(piezas) || 0 : cant;
      }
    }

    await conn.query(
      `
      INSERT INTO factura_consolidada_detalle (
        idfactura, codigo, idgrupo, idproveedor,
        idproducto, idvariedad, idlongitud, idempaque, idtipocaja,
        cantidad, piezas, precio_unitario, precio_venta,
        tallos, cantidadTallos, cantidadRamos, totalRamos,
        subtotal, subtotalVenta,
        idmix, peso, documento_proveedor, idusuario, esramo, fechacompra
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        parseInt(idfactura),
        codigo || '',
        isNaN(parseInt(idgrupo)) ? null : parseInt(idgrupo),
        isNaN(parseInt(idproveedor)) ? null : parseInt(idproveedor),
        isNaN(parseInt(idproducto)) ? null : parseInt(idproducto),
        isNaN(parseInt(idvariedad)) ? null : parseInt(idvariedad),
        isNaN(parseInt(idlongitud)) ? null : parseInt(idlongitud),
        isNaN(parseInt(idempaque)) ? null : parseInt(idempaque),
        isNaN(parseInt(idtipocaja)) ? null : parseInt(idtipocaja),
        cant,
        piezasFinal,
        parseFloat(precio_unitario) || 0,
        parseFloat(precio_venta) || 0,
        parseInt(tallos) || 0,
        parseInt(cantidadTallos) || 0,
        parseInt(cantidadRamos) || 0,
        totalRamos,
        parseFloat(subtotal) || 0,
        parseFloat(subtotalVenta) || 0,
        isNaN(parseInt(nuevoIdMix)) ? null : parseInt(nuevoIdMix),
        parseFloat(peso) || 0,
        typeof documento_proveedor === 'string' ? documento_proveedor : '',
        isNaN(parseInt(idusuario)) ? null : parseInt(idusuario),
        esRamoFinal
      ]
    );

    res.json({ success: true, message: '✅ Detalle creado correctamente' });
  } catch (err) {
    console.error('❌ Error al crear detalle:', err.message);
    res.status(500).json({ error: err.message || '❌ Error al crear detalle' });
  } finally {
    conn.release();
  }
});

// ✅ Eliminar múltiples registros de factura, considerando mixes
router.post('/eliminar-multiples', async (req, res) => {
  const { ids, idfactura } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No se enviaron IDs válidos' });
  }

  const idfacturaNum = Number(idfactura || 0);
  if (!idfacturaNum) {
    return res.status(400).json({ error: 'Falta idfactura para eliminar múltiples' });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const placeholdersIds = ids.map(() => '?').join(',');

    // 1️⃣ Buscar todos los idmix asociados a los ids seleccionados, PERO solo de esa factura
    const [rows] = await conn.query(
      `
      SELECT DISTINCT idmix
      FROM factura_consolidada_detalle
      WHERE iddetalle IN (${placeholdersIds})
        AND idfactura = ?
      `,
      [...ids, idfacturaNum]
    );

    const idmixes = rows.map((r) => r.idmix).filter((id) => id !== null);

    // 2️⃣ Eliminar todas las filas mix de ESA factura
    if (idmixes.length > 0) {
      const placeholdersMix = idmixes.map(() => '?').join(',');
      await conn.query(
        `
        DELETE FROM factura_consolidada_detalle
        WHERE idfactura = ?
          AND idmix IN (${placeholdersMix})
        `,
        [idfacturaNum, ...idmixes]
      );
    }

    // 3️⃣ Eliminar las sólidas (las que fueron seleccionadas sin idmix) SOLO de esa factura
    await conn.query(
      `
      DELETE FROM factura_consolidada_detalle
      WHERE idfactura = ?
        AND iddetalle IN (${placeholdersIds})
      `,
      [idfacturaNum, ...ids]
    );

    await conn.commit();
    res.json({ success: true, message: '✅ Registros eliminados correctamente (incluidos mixes)' });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {}
    console.error('❌ Error al eliminar múltiples:', err.message);
    res.status(500).json({ error: 'Error al eliminar registros' });
  } finally {
    try {
      conn.release();
    } catch {}
  }
});

// ✅ Asignar documento_proveedor a varios registros
router.post('/asignar-documento-proveedor', async (req, res) => {
  try {
    const { ids, documento_proveedor, guia_master, fechacompra } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debes enviar "ids" con al menos un iddetalle.' });
    }

    // Normaliza valores (vacío -> null). Si es null, conservamos el valor actual (COALESCE)
    const doc = normStr(documento_proveedor);
    const guia = normStr(guia_master);
    const fecha = normDate(fechacompra);

    if (doc === null && guia === null && fecha === null) {
      return res.status(400).json({ error: 'No hay campos para actualizar.' });
    }

    // Armamos placeholders seguros para el IN (...)
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      UPDATE factura_consolidada_detalle
      SET
        documento_proveedor = COALESCE(?, documento_proveedor),
        guia_master         = COALESCE(?, guia_master),
        fechacompra         = COALESCE(?, fechacompra)
      WHERE iddetalle IN (${placeholders})
    `;

    const params = [doc, guia, fecha, ...ids.map((n) => Number(n))];

    const [result] = await db.query(sql, params);
    return res.json({
      message: 'Campos asignados correctamente',
      affectedRows: result.affectedRows || 0
    });
  } catch (err) {
    console.error('❌ /api/facturas/asignar-documento-proveedor:', err);
    return res.status(500).json({ error: 'Error al actualizar los registros' });
  }
});

router.post('/reporte-por-codigos', async (req, res) => {
  const { codigos } = req.body;

  if (!Array.isArray(codigos) || codigos.length === 0) {
    return res.status(400).json({ error: 'No se enviaron códigos válidos' });
  }

  try {
    const [rows] = await db.query(
      `
      SELECT d.*, t.nombre AS proveedor
      FROM factura_consolidada_detalle d
      LEFT JOIN terceros t ON d.idproveedor = t.idtercero
      WHERE d.codigo IN (?)
    `,
      [codigos]
    );

    // Agrupar por código
    const grupos = {};
    for (const row of rows) {
      if (!row.codigo) continue;
      if (!grupos[row.codigo]) grupos[row.codigo] = [];
      grupos[row.codigo].push(row);
    }

    const pdfBuffer = await generarPdfPorCodigo(grupos);
    const base64 = pdfBuffer.toString('base64');

    res.json({ base64 });
  } catch (err) {
    console.error('❌ Error al generar reporte por códigos:', err);
    res.status(500).json({ error: 'Error al generar el reporte PDF' });
  }
});

// (opcional) debug rápido para verificar montaje
router.get('/_debug/coordinaciones', (req, res) => res.json({ ok: true, base: '/api/facturas' }));

// Obtener estado guardado para la factura actual
router.get('/:idfactura/coordinaciones/estado', async (req, res) => {
  const { idfactura } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT idproveedor, seleccionado, confirmadas, observaciones
         FROM coordinaciones_factura
        WHERE idfactura = ?`,
      [idfactura]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /coordinaciones/estado:', e);
    res.status(500).json({ error: 'ERR_GET_ESTADO' });
  }
});

// Guardar/upsert selección, confirmadas y observaciones
router.post('/:idfactura/coordinaciones/guardar', async (req, res) => {
  const { idfactura } = req.params;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!idfactura) return res.status(400).json({ error: 'FALTA_IDFACTURA' });

  try {
    if (items.length === 0) return res.json({ ok: true, items: 0 });

    // Normaliza/limpia
    const cleaned = items.map((it) => {
      const idproveedor = Number(it.idproveedor);
      const seleccionado = it.seleccionado ? 1 : 0;
      const confirmadas =
        it.confirmadas === '' || it.confirmadas == null ? null : Number(it.confirmadas);
      const observaciones = String(it.observaciones || '').slice(0, 255);
      // gm como texto plano; si viene vacío => NULL
      const rawGM = (it.guia_master ?? '').toString().trim();
      const guia_master = rawGM ? rawGM.slice(0, 50) : null;

      return { idproveedor, seleccionado, confirmadas, observaciones, guia_master };
    });

    // --- 1) UPSERT en coordinaciones_factura (incluye guia_master) ---
    const values = cleaned.map((it) => [
      Number(idfactura),
      it.idproveedor,
      it.seleccionado,
      it.confirmadas,
      it.observaciones,
      it.guia_master
    ]);

    const sql = `
      INSERT INTO coordinaciones_factura
        (idfactura, idproveedor, seleccionado, confirmadas, observaciones, guia_master)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        seleccionado = VALUES(seleccionado),
        confirmadas  = VALUES(confirmadas),
        observaciones= VALUES(observaciones),
        guia_master  = VALUES(guia_master)
    `;
    await db.query(sql, [values]);

    // --- 2) Actualiza guia_master en factura_consolidada_detalle por proveedor ---
    // (uno por uno es suficiente; normalmente son pocas fincas)
    const updSql = `
      UPDATE factura_consolidada_detalle
         SET guia_master = ?
       WHERE idfactura   = ?
         AND idproveedor = ?
    `;
    for (const it of cleaned) {
      await db.query(updSql, [it.guia_master, Number(idfactura), it.idproveedor]);
    }

    res.json({ ok: true, items: items.length });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('POST /coordinaciones/guardar:', e);
    res.status(500).json({ error: 'ERR_GUARDAR' });
  }
});

// Vista previa PACKING o INVOICE (mismo endpoint)
router.post('/:id/packing/ver', async (req, res) => {
  try {
    const idfactura = Number(req.params.id);
    const formato = String(req.query.formato || req.body?.formato || 'packing').toLowerCase();
    const proveedores = Array.isArray(req.body?.proveedores) ? req.body.proveedores : [];

    if (formato === 'invoice') {
      const { base64 } = await generarPdfInvoice(idfactura);
      return res.json({ base64 });
    }

    // packing por defecto
    const buffer = await generarPdfPacking({ idfactura, idsProveedores: proveedores });
    return res.json({ base64: buffer.toString('base64') });
  } catch (e) {
    console.error('packing/ver', e);
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});

// Enviar PACKING o INVOICE (mismo endpoint actualizado)
router.post('/:id/packing/enviar', async (req, res) => {
  try {
    const idfactura = Number(req.params.id);
    // Normalizamos el formato ('invoice' o 'packing')
    const formato = String(req.query.formato || req.body?.formato || 'packing').toLowerCase();
    const proveedores = Array.isArray(req.body?.proveedores) ? req.body.proveedores : [];
    const para = req.body?.para; // Permite forzar un correo desde el frontend si fuera necesario

    /* ---------------- LOGICA PARA INVOICE (CLIENTE) ---------------- */
    if (formato === 'invoice') {
      // 1. Buscamos el correo y nombre del cliente asociado a la factura
      const [rows] = await db.query(
        `
        SELECT f.numero_factura, c.nombre, c.correo 
        FROM factura_consolidada f
        JOIN terceros c ON f.idcliente = c.idtercero
        WHERE f.id = ? 
      `,
        [idfactura]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Factura o cliente no encontrados.' });
      }

      const datosCliente = rows[0];
      // Usamos el correo enviado manualmente ("para") o el de la base de datos
      const correoDestino = para || datosCliente.correo;

      if (!correoDestino) {
        return res
          .status(400)
          .json({ error: 'El cliente no tiene un correo registrado y no se proporcionó ninguno.' });
      }

      // 2. Generamos el PDF del Invoice
      const { buffer } = await generarPdfInvoice(idfactura);

      // 3. Enviamos el correo usando la función nueva
      await enviarCorreoInvoice(
        correoDestino,
        buffer,
        datosCliente.numero_factura || idfactura,
        datosCliente.nombre
      );

      return res.json({ ok: true, message: '✅ Invoice enviado correctamente al cliente.' });
    }

    /* ---------------- LOGICA PARA PACKING (DEFAULT) ---------------- */
    // Generamos el buffer del packing
    const buffer = await generarPdfPacking({ idfactura, idsProveedores: proveedores });

    // NOTA: Como aún no tienes una función específica 'enviarCorreoPacking' en tu archivo correo.js,
    // aquí solo dejamos la generación lista. Si quisieras enviarlo, deberías crear esa función similar a la de Invoice.

    // await enviarCorreoPacking(para, buffer, idfactura); // (Pendiente de implementar)

    return res.json({ ok: true, message: 'Packing generado (envío pendiente de configuración).' });
  } catch (e) {
    console.error('❌ Error en packing/enviar:', e);
    res.status(500).json({ error: 'No se pudo enviar el documento PDF.' });
  }
});

router.post('/prepacking-por-codigos', async (req, res) => {
  try {
    const idfactura = Number(req.body?.idfactura);
    const codigos = Array.isArray(req.body?.codigos) ? req.body.codigos : [];
    if (!idfactura || codigos.length === 0) {
      return res.status(400).json({ error: 'idfactura y codigos son requeridos' });
    }
    const buffer = await generarPrepackingPorCodigo({ idfactura, codigos });
    res.json({ base64: buffer.toString('base64') });
  } catch (err) {
    console.error('❌ prepacking-por-codigos:', err);
    res.status(500).json({ error: 'Error al generar prepacking por código' });
  }
});

// POST /api/facturas/duplicar
router.post('/duplicar', async (req, res) => {
  const { idfacturaOrigen, observaciones } = req.body || {};
  if (!idfacturaOrigen) {
    return res.status(400).json({ error: 'idfacturaOrigen es requerido' });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // 1) Encabezado origen
    const [hdrRows] = await conn.query('SELECT * FROM factura_consolidada WHERE id = ? LIMIT 1', [
      idfacturaOrigen
    ]);
    if (!hdrRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'La factura origen no existe' });
    }
    const src = hdrRows[0];

    // 2) CONSEUTIVO por tipoMovimiento='C' y tipoDocumento='F'
    const [[{ lastNum }]] = await conn.query(
      `SELECT COALESCE(MAX(CAST(numero_factura AS UNSIGNED)), 0) AS lastNum
         FROM factura_consolidada
        WHERE tipoMovimiento = 'C' AND tipoDocumento = 'F'`
    );
    const nuevoNumeroFactura = String(Number(lastNum) + 1);

    // 3) Crear encabezado nuevo (ajustado a tu esquema)
    const nuevoHdr = {
      Idcliente: src.Idcliente ?? null,
      idcarguera: src.idcarguera ?? null,
      fecha: src.fecha ?? new Date(),
      fecha_vuelo: src.fecha_vuelo ?? null,
      fecha_entrega: src.fecha_entrega ?? null,
      awb: src.awb ?? null,
      hawb: src.hawb ?? null,
      IdDae: src.IdDae ?? null,
      estado: 'proceso',
      idetiqueta: src.idetiqueta ?? null,
      valorTotal: 0.0,
      // 👇 Asignamos el consecutivo calculado
      numero_factura: nuevoNumeroFactura,
      observaciones: observaciones ?? null,
      // 👇 Forzamos los filtros deseados en el duplicado
      tipoMovimiento: 'C',
      tipoDocumento: 'F',
      idcartera: null,
      idpago: null
    };
    Object.keys(nuevoHdr).forEach((k) => nuevoHdr[k] === undefined && delete nuevoHdr[k]);

    const [insHdr] = await conn.query('INSERT INTO factura_consolidada SET ?', [nuevoHdr]);
    const idfacturaNueva = insHdr.insertId;

    // 4) Remapeo de MIX e inserción de detalle (igual que ya tienes)
    const [[{ maxmix }]] = await conn.query(
      'SELECT COALESCE(MAX(idmix), 0) AS maxmix FROM factura_consolidada_detalle WHERE idfactura = ?',
      [idfacturaNueva]
    );
    let nextMix = Number(maxmix) || 0;

    const [detRows] = await conn.query(
      'SELECT * FROM factura_consolidada_detalle WHERE idfactura = ? ORDER BY idmix, iddetalle',
      [idfacturaOrigen]
    );

    const mixMap = new Map();
    for (const d of detRows) {
      const row = { ...d };
      delete row.iddetalle;
      row.idfactura = idfacturaNueva;

      if (row.idmix != null) {
        if (!mixMap.has(row.idmix)) {
          nextMix += 1;
          mixMap.set(row.idmix, nextMix);
        }
        row.idmix = mixMap.get(row.idmix);
      } else {
        row.idmix = null;
      }

      // (opcional) limpiar campos heredados
      // row.documento_proveedor = null;
      // row.guia_master = null;
      // row.fechacompra = null;

      Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
      await conn.query('INSERT INTO factura_consolidada_detalle SET ?', [row]);
    }

    await conn.commit();
    return res.json({ ok: true, idfactura: idfacturaNueva, numero_factura: nuevoNumeroFactura });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ /api/facturas/duplicar:', err);
    return res
      .status(500)
      .json({ error: err.sqlMessage || err.message || 'Error duplicando la factura' });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/facturas/consolidada-detalle?ids=85,86
router.get('/consolidada-detalle', async (req, res) => {
  try {
    const idsParam = String(req.query.ids || '').trim();
    if (!idsParam) return res.status(400).json({ error: 'Parámetro ids requerido' });

    const ids = idsParam.split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Lista ids vacía' });

    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      SELECT
        d.iddetalle,
        d.idfactura,
        d.idproveedor AS proveedor_id,
        COALESCE(p.nombre, CONCAT('PROV-', d.idproveedor)) AS proveedor,
        d.idproducto,
        d.idvariedad,
        d.idlongitud,
        d.precio_unitario AS precio_unitario, 
        d.cantidadTallos AS cantidad_tallos,  -- ✅ directo desde la tabla
        d.subtotal          AS subtotal,      -- ✅ directo
        d.documento_proveedor                 -- ✅ directo
      FROM factura_consolidada_detalle d
      LEFT JOIN terceros p ON p.idtercero = d.idproveedor
      WHERE d.idfactura IN (${placeholders})
      ORDER BY d.idfactura, d.iddetalle
    `;
    const [rows] = await db.query(sql, ids);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error consultando detalle consolidado' });
  }
});

module.exports = router;
