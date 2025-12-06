const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/crear-mixta', async (req, res) => {
  const { idpedido_original, totalOriginal, mixItems, cajasCompradasTotales } = req.body;

  if (!idpedido_original || !Array.isArray(mixItems) || mixItems.length === 0) {
    return res.status(400).json({ error: 'Datos incompletos para la caja mixta' });
  }

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    const totalTallosComprados = mixItems.reduce(
      (sum, item) => sum + Number(item.cantidadTallos || 0),
      0
    );

    const idfactura = mixItems[0].idfactura;

    // ✅ Obtener último idmix existente en esa factura
    const [[ultimoMix]] = await connection.query(`
      SELECT MAX(idmix) AS maxMix
      FROM factura_consolidada_detalle
      WHERE idfactura = ?
    `, [idfactura]);

    const nuevoIdMix = (ultimoMix?.maxMix || 1000) + 1;

    // ✅ Insertar todos los ítems de la caja mixta
    for (const item of mixItems) {
      const {
        idfactura, codigo, idproveedor, idpedido,
        idusuario, idproducto, idvariedad, idlongitud,
        idempaque, idtipocaja, cantidad, cantidadRamos,
        cantidadTallos, precio_unitario, subtotal, idOrder,
        documento_proveedor
      } = item;

      await connection.query(
        `INSERT INTO factura_consolidada_detalle 
          (idfactura, codigo, idproveedor, idpedido,
          idusuario, idproducto, idvariedad, idlongitud,
          idempaque, idtipocaja, cantidad, cantidadRamos,
          cantidadTallos, tallos, precio_unitario, subtotal, idOrder, fechacompra, idmix, documento_proveedor, idgrupo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
          idfactura, codigo, idproveedor, idpedido,
          idusuario, idproducto, idvariedad, idlongitud,
          idempaque, idtipocaja, cantidad, cantidadRamos,
          cantidadTallos, cantidadTallos, precio_unitario, subtotal, idOrder,
          nuevoIdMix, documento_proveedor || null, item.idgrupo || 5 
        ]
      );
    }

    // ✅ Obtener cantidad y totaltallos actuales del pedido original
    const [datos] = await connection.query(
      `SELECT cantidad, totaltallos FROM pedidos WHERE idpedido = ?`,
      [idpedido_original]
    );

    const pedido = datos[0];

    // ✅ Convertir y validar los valores
    const cantidadOriginal = Number(pedido.cantidad);
    const totaltallosOriginal = Number(pedido.totaltallos);
    const cajasUsadas = Number(cajasCompradasTotales);
    const tallosUsados = Number(totalTallosComprados);

    if (
      isNaN(cantidadOriginal) || isNaN(totaltallosOriginal) ||
      isNaN(cajasUsadas) || isNaN(tallosUsados)
    ) {
      connection.release();
      return res.status(400).json({
        error: '❌ Error: uno de los valores (cantidad, tallos, cajas o tallos usados) no es numérico.'
      });
    }

    if (cajasUsadas > cantidadOriginal || tallosUsados > totaltallosOriginal) {
      connection.release();
      return res.status(400).json({
        error: '❌ No puedes usar más cajas o tallos de los disponibles en el pedido original.'
      });
    }

    const nuevaCantidad = cantidadOriginal - cajasUsadas;
    const nuevoTotalTallos = totaltallosOriginal - tallosUsados;

    if (isNaN(nuevaCantidad) || isNaN(nuevoTotalTallos)) {
      connection.release();
      return res.status(400).json({ error: '❌ Error: cálculo inválido, revisa los valores recibidos.' });
    }

    if (nuevaCantidad <= 0 || nuevoTotalTallos <= 0) {
      // 🗑️ Eliminar pedido si ya no hay saldo
      await connection.query(`DELETE FROM pedidos WHERE idpedido = ?`, [idpedido_original]);
    } else {
      // 🔁 Actualizar saldo
      await connection.query(
        `UPDATE pedidos SET cantidad = ?, totaltallos = ? WHERE idpedido = ?`,
        [nuevaCantidad, nuevoTotalTallos, idpedido_original]
      );
    }

    await connection.commit();
    connection.release();
    res.json({ message: '✅ Cajas mixtas guardadas correctamente' });

  } catch (err) {
    console.error('❌ Error al guardar caja mixta:', err);
    res.status(500).json({ error: 'Error interno al guardar caja mixta' });
  }
});

module.exports = router;
