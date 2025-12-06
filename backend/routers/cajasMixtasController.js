const express = require('express');
const router = express.Router();
const db = require('../db');

/* ---------------- codagrupa helper (string-based) ---------------- */
function buildCodAgrupa(fechaISO, idproducto, idvariedad, idempaque, idlongitud) {
  try {
    const [yyyy, mmStr, ddStr] = String(fechaISO).slice(0, 10).split('-');
    const mm = Number(mmStr); // sin zero padding
    const dd = Number(ddStr); // sin zero padding
    const yy = String(yyyy).slice(-2);
    return `${mm}${dd}${yy}${idproducto}${idvariedad}${idempaque}${idlongitud}`;
  } catch {
    return '';
  }
}

/* ------------------------ Actualizar caja mixta ------------------------ */
router.post('/factura-detalle/actualizar-mixta', async (req, res) => {
  const { iddetalle_original, mixItems, devolverCajas, cajasDevueltas } = req.body;

  if (!iddetalle_original || !Array.isArray(mixItems) || mixItems.length === 0) {
    return res.status(400).json({ success: false, error: 'Datos incompletos para actualizar mix' });
  }

  // 🔐 NUEVO: asegurarnos que tenemos idfactura y que es única para toda la mix
  const idfacturaMix = Number(mixItems?.[0]?.idfactura || 0);
  if (!idfacturaMix) {
    return res
      .status(400)
      .json({ success: false, error: 'Falta idfactura en mixItems[0] para actualizar mix' });
  }

  const hayFacturaInconsistente = mixItems.some((it) => Number(it.idfactura || 0) !== idfacturaMix);
  if (hayFacturaInconsistente) {
    return res.status(400).json({
      success: false,
      error: 'Todos los items de la mix deben tener la misma idfactura'
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 🔐 ANTES: WHERE idmix = ?
    // 🔐 AHORA: restringimos también por idfactura
    const [[detalleBase]] = await connection.query(
      `
      SELECT idpedido, idOrder
      FROM factura_consolidada_detalle
      WHERE idmix = ? AND idfactura = ?
      LIMIT 1
      `,
      [iddetalle_original, idfacturaMix]
    );

    if (!detalleBase) {
      await connection.rollback();
      connection.release();
      return res
        .status(404)
        .json({ success: false, error: 'No se encontró el detalle original para el mix.' });
    }

    const idpedidoOriginal = detalleBase.idpedido;
    const idOrderOriginal = detalleBase.idOrder;

    // 🔐 Borrar solo el mix de ESA factura
    await connection.query(
      `DELETE FROM factura_consolidada_detalle WHERE idmix = ? AND idfactura = ?`,
      [iddetalle_original, idfacturaMix]
    );

    const modoSolido = mixItems.length === 1;

    // cantidad común para toda la mix (si alguna fila viene 0/undefined)
    const cantidadGlobal = Number(mixItems?.[0]?.cantidad ?? 0);

    // Reinsertar con piezas/cantidad correctas
    for (let i = 0; i < mixItems.length; i++) {
      const item = mixItems[i];

      // Normalizar / asegurar números
      // 🔐 forzamos que idfactura sea la misma que validamos arriba
      const idfactura = Number(item.idfactura || idfacturaMix);
      const codigo = item.codigo ?? '0';
      const idgrupo = Number(item.idgrupo ?? 5);
      const idproveedor = item.idproveedor ?? null;
      const idproducto = Number(item.idproducto);
      const idvariedad = Number(item.idvariedad);
      const idlongitud = Number(item.idlongitud);
      const idempaque = Number(item.idempaque);
      const tipo_caja_variedad = item.tipo_caja_variedad ?? item.idtipocaja ?? null;

      // cantidad final: usar la del item si >0, si no la global
      const cantidadItem = Number(item.cantidad ?? 0);
      const cantidad = cantidadItem > 0 ? cantidadItem : cantidadGlobal;

      const cantidadRamos = Number(item.cantidadRamos || 0);
      const cantidadTallos = Number(item.cantidadTallos || 0);
      const precio_unitario = Number(item.precio_unitario || 0);
      const precio_venta = Number(item.precio_venta || 0);
      const subtotal = Number(item.subtotal || 0);
      const documento_proveedor = item.documento_proveedor ?? null;
      const idusuario = item.idusuario ?? null;
      const codagrupaEntrada = (item.codagrupa ?? '').toString().trim();

      // guía master (HAWB)
      const guia_master = item.guia_master ?? null;

      const fecha = new Date(item.fechacompra || Date.now());
      const fechaMysql = fecha.toISOString().slice(0, 19).replace('T', ' ');

      const subtotalVenta = precio_venta * cantidadTallos;
      const totalRamos = cantidad * cantidadRamos;

      // codagrupa: si no viene, construirlo
      const codagrupaFinal =
        codagrupaEntrada !== ''
          ? codagrupaEntrada
          : buildCodAgrupa(fechaMysql, idproducto, idvariedad, idempaque, idlongitud);

      // PIEZAS: prioriza lo que manda el front; si no viene, fallback con la cantidad final
      const piezas = Number(item?.piezas ?? (modoSolido ? cantidad : i === 0 ? cantidad : 0));

      const insertData = {
        idfactura,
        codigo,
        idpedido: idpedidoOriginal,
        idOrder: idOrderOriginal,
        idgrupo,
        idproveedor,
        idproducto,
        idvariedad,
        idlongitud,
        idempaque,
        idtipocaja: tipo_caja_variedad,
        cantidad, // todas las filas con la misma cantidad
        piezas, // solo primera fila en mixta
        cantidadRamos,
        totalRamos,
        cantidadTallos,
        tallos: cantidadTallos,
        precio_unitario,
        precio_venta,
        subtotal,
        subtotalVenta,
        documento_proveedor,
        guia_master,
        idusuario,
        fechacompra: fechaMysql,
        codagrupa: codagrupaFinal
      };

      if (!modoSolido) {
        insertData.idmix = iddetalle_original;
      }

      await connection.query(`INSERT INTO factura_consolidada_detalle SET ?`, insertData);
    }

    if (devolverCajas && cajasDevueltas > 0 && idpedidoOriginal) {
      await connection.query(`UPDATE pedidos SET cantidad = cantidad + ? WHERE idpedido = ?`, [
        cajasDevueltas,
        idpedidoOriginal
      ]);
    }

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: modoSolido
        ? '✅ Registro convertido en caja sólida.'
        : '✅ Mix actualizada correctamente.'
    });
  } catch (err) {
    console.error('❌ Error al actualizar caja mixta:', err);
    try {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
    } catch {}
    res.status(500).json({ success: false, error: 'Error al actualizar caja mixta' });
  }
});

/* -------------------------- Crear caja mixta -------------------------- */
router.post('/factura-detalle/crear-mixta', async (req, res) => {
  const { iddetalle_original, mixItems, crearMix = true } = req.body;

  if (!Array.isArray(mixItems) || mixItems.length === 0) {
    return res.status(400).json({ success: false, error: 'No hay elementos en la caja mixta' });
  }

  try {
    const [[detalleOriginal]] = await db.query(
      'SELECT idpedido, idOrder FROM factura_consolidada_detalle WHERE iddetalle = ?',
      [iddetalle_original]
    );

    const idpedidoOriginal = detalleOriginal?.idpedido || null;
    const idOrderOriginal = detalleOriginal?.idOrder || null;

    // Borrar el detalle original (sólido) que se está convirtiendo
    await db.query('DELETE FROM factura_consolidada_detalle WHERE iddetalle = ?', [
      iddetalle_original
    ]);

    const modoSolido = mixItems.length === 1 || !crearMix;

    // 👇 cantidad común para toda la mix (si alguna fila viene 0/undefined)
    const cantidadGlobal = Number(mixItems?.[0]?.cantidad ?? 0);

    for (let i = 0; i < mixItems.length; i++) {
      const item = mixItems[i];

      // Normalizar / asegurar números
      const idfactura = Number(item.idfactura);
      const codigo = item.codigo ?? '0';
      const idgrupo = Number(item.idgrupo ?? 5);
      const idproveedor = item.idproveedor ?? null;
      const idproducto = Number(item.idproducto);
      const idvariedad = Number(item.idvariedad);
      const idlongitud = Number(item.idlongitud);
      const idempaque = Number(item.idempaque);
      const tipo_caja_variedad = item.tipo_caja_variedad ?? item.idtipocaja ?? null;

      // cantidad final: usar la del item si >0, si no la global
      const cantidadItem = Number(item.cantidad ?? 0);
      const cantidad = cantidadItem > 0 ? cantidadItem : cantidadGlobal;

      const cantidadRamos = Number(item.cantidadRamos || 0);
      const cantidadTallos = Number(item.cantidadTallos || 0);
      const precio_unitario = Number(item.precio_unitario || 0);
      const precio_venta = Number(item.precio_venta || 0);
      const subtotal = Number(item.subtotal || 0);
      const documento_proveedor = item.documento_proveedor ?? null;
      const idusuario = item.idusuario ?? null;
      const codagrupaEntrada = (item.codagrupa ?? '').toString().trim();

      // 🆕 guía master (HAWB)
      const guia_master = item.guia_master ?? null;

      const fecha = new Date(item.fechacompra || Date.now());
      const fechaMysql = fecha.toISOString().slice(0, 19).replace('T', ' ');

      const subtotalVenta = precio_venta * cantidadTallos;
      const totalRamos = cantidad * cantidadRamos;

      // codagrupa: si no viene, construirlo
      const codagrupaFinal =
        codagrupaEntrada !== ''
          ? codagrupaEntrada
          : buildCodAgrupa(fechaMysql, idproducto, idvariedad, idempaque, idlongitud);

      // PIEZAS: prioriza item.piezas; fallback con la cantidad final
      const piezas = Number(item?.piezas ?? (modoSolido ? cantidad : i === 0 ? cantidad : 0));

      const insertData = {
        idfactura,
        codigo,
        idpedido: idpedidoOriginal,
        idOrder: idOrderOriginal,
        idgrupo,
        idproveedor,
        idproducto,
        idvariedad,
        idlongitud,
        idempaque,
        idtipocaja: tipo_caja_variedad,
        cantidad, // ✅ todas las filas con la misma cantidad
        piezas, // ✅ solo primera en mixta
        cantidadRamos,
        totalRamos,
        cantidadTallos,
        tallos: cantidadTallos,
        precio_unitario,
        precio_venta,
        subtotal,
        subtotalVenta,
        documento_proveedor,
        guia_master, // 🆕 se guarda guía master al crear
        idusuario,
        fechacompra: fechaMysql,
        codagrupa: codagrupaFinal
      };

      if (!modoSolido) {
        insertData.idmix = iddetalle_original;
      }

      await db.query('INSERT INTO factura_consolidada_detalle SET ?', insertData);
    }

    res.json({
      success: true,
      message: modoSolido
        ? '✅ Caja sólida guardada correctamente.'
        : '✅ Caja mixta creada correctamente.'
    });
  } catch (error) {
    console.error('❌ Error al guardar caja mixta:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------------- Obtener detalle de una mix ---------------------- */
router.get('/factura-detalle/mix/:idmix', async (req, res) => {
  const { idmix } = req.params;

  try {
    const [filas] = await db.query(
      `
      SELECT 
        idproducto,
        idvariedad,
        idlongitud,
        idempaque,
        cantidad,
        piezas,
        cantidadRamos,
        precio_unitario,
        precio_venta,
        subtotal,
        subtotalVenta,
        documento_proveedor,
        idpedido,
        idOrder,
        idfactura,
        codigo,
        idgrupo,
        idproveedor,
        idtipocaja,
        idusuario,
        fechacompra,
        codagrupa,
        guia_master              -- 👈 AQUÍ LA CLAVE
      FROM factura_consolidada_detalle
      WHERE idmix = ?
    `,
      [idmix]
    );

    res.json(filas);
  } catch (error) {
    console.error('❌ Error al obtener detalle de la mix:', error);
    res.status(500).json({ error: 'Error al cargar detalle de la mix' });
  }
});

router.get('/test', (req, res) => {
  res.send('✅ Caja mixta conectada');
});

module.exports = router;
