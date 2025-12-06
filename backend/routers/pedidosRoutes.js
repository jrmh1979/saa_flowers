const express = require('express');
const router = express.Router();
const verificarToken = require('../middlewares/verificarToken');
const registrarAuditoria = require('../utils/registrarAuditoria');
const db = require('../db');

// ✅ Calcular pesos en pedidos
router.post('/calcular-pesos', async (req, res) => {
  try {
    const [pedidos] = await db.query(`
      SELECT idpedido, idproducto, idtipocaja, tallos, cantidad
      FROM pedidos
      WHERE tallos IS NOT NULL
    `);

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

    const calcularPeso = (pedido) => {
      for (const regla of reglas) {
        const [min, max] = regla.rango.split('-').map(Number);
        if (
          pedido.idtipocaja === regla.idtipocaja &&
          pedido.idproducto === regla.idproducto &&
          pedido.tallos >= min &&
          pedido.tallos <= max
        ) {
          return regla.peso;
        }
      }
      return 0.0;
    };

    for (const pedido of pedidos) {
      const pesoUnidad = calcularPeso(pedido);
      const pesoTotal = pesoUnidad * (pedido.cantidad || 1);
      await db.query(`UPDATE pedidos SET peso = ? WHERE idpedido = ?`, [
        pesoTotal,
        pedido.idpedido
      ]);
    }

    res.status(200).json({ message: '✅ Pesos actualizados correctamente en pedidos' });
  } catch (error) {
    console.error('❌ Error al calcular pesos en pedidos:', error);
    res.status(500).json({ error: 'Error al calcular pesos en pedidos' });
  }
});

// ✅ Obtener pedidos válidos
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM pedidos
      WHERE cantidad > 0
      ORDER BY idpedido DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener pedidos:', err.message);
    res.status(500).send('Error al obtener pedidos');
  }
});

// ✅ Insertar nuevo pedido con idtipocaja
router.post('/', async (req, res) => {
  try {
    const {
      idfactura,
      idcliente,
      codigo,
      idproducto,
      idvariedad,
      idlongitud,
      idempaque,
      cantidad,
      tallos,
      totaltallos,
      observaciones,
      idtipocaja,
      idOrder
    } = req.body;

    if (!idfactura || !idcliente) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const sql = `
      INSERT INTO pedidos (
        idfactura, idcliente, codigo,
        idproducto, idvariedad, idlongitud, idempaque,
        cantidad, tallos, totaltallos, observaciones, idtipocaja,idOrder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
    `;

    const valores = [
      idfactura,
      idcliente,
      codigo,
      idproducto,
      idvariedad,
      idlongitud,
      idempaque,
      cantidad,
      tallos,
      totaltallos,
      observaciones,
      idtipocaja,
      idOrder
    ];

    const [result] = await db.query(sql, valores);
    res.json({ success: true, idpedido: result.insertId });
  } catch (err) {
    console.error('❌ Error al insertar pedido:', err.message);
    res.status(500).json({ error: 'Error al insertar pedido' });
  }
});

// ✅ Actualizar múltiples campos
router.put('/:id', async (req, res) => {
  try {
    const idpedido = req.params.id;
    const data = req.body.valor;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Datos inválidos' });
    }

    const fields = Object.keys(data).filter((k) => k !== 'id');
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    const updates = fields.map((f) => `\`${f}\` = ?`).join(', ');
    const values = fields.map((f) => data[f]);

    const sql = `UPDATE pedidos SET ${updates} WHERE idpedido = ?`;
    await db.query(sql, [...values, idpedido]);

    res.json({ message: '✅ Pedido actualizado correctamente' });
  } catch (err) {
    console.error('❌ Error al actualizar pedido:', err.message);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// ✅ Eliminar múltiples pedidos con auditoría
router.delete('/multiples', verificarToken, async (req, res) => {
  try {
    const ids = req.body.ids;
    const idusuario = req.user.idusuario;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).send('No se proporcionaron IDs válidos');
    }

    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM pedidos WHERE idpedido IN (${placeholders})`;

    const [result] = await db.query(sql, ids);

    await registrarAuditoria(
      db,
      idusuario,
      'eliminar',
      'pedidos',
      `Eliminó ${result.affectedRows} pedido(s): [${ids.join(', ')}]`
    );

    res.send(`✅ ${result.affectedRows} pedidos eliminados`);
  } catch (err) {
    console.error('❌ Error al eliminar pedidos:', err.message);
    res.status(500).send('Error al eliminar pedidos');
  }
});

// ✅ Agregar vacíos o líneas por texto
router.post('/agregar-vacios', async (req, res) => {
  try {
    const { idfactura, cantidad, lineasTexto } = req.body;

    if (!idfactura) {
      return res.status(400).json({ error: 'Falta idfactura' });
    }

    let values = [];

    if (Array.isArray(lineasTexto) && lineasTexto.length > 0) {
      values = lineasTexto.map((linea) => [
        idfactura,
        null,
        '',
        null,
        null,
        null,
        null,
        null,
        1,
        0,
        0,
        linea.trim()
      ]);
    } else {
      if (!cantidad || isNaN(cantidad) || cantidad <= 0) {
        return res.status(400).json({ error: 'Cantidad inválida' });
      }

      values = Array.from({ length: cantidad }, () => [
        idfactura,
        null,
        '',
        null,
        null,
        null,
        null,
        null,
        1,
        0,
        0,
        ''
      ]);
    }

    const sql = `
      INSERT INTO pedidos (
        idfactura, idcliente, codigo, idproducto, idvariedad, idlongitud,
        idempaque, idproveedor, cantidad, tallos, totaltallos, observaciones
      ) VALUES ?
    `;

    const [result] = await db.query(sql, [values]);
    res.json({ success: true, inserted: result.affectedRows });
  } catch (err) {
    console.error('❌ Error al insertar pedidos:', err.message);
    res.status(500).json({ error: 'Error al insertar pedidos' });
  }
});

// 🔓 Desbloqueo manual para usar desde admin o interfaz especial
router.post('/:id/desbloquear', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE pedidos SET editando_por = NULL WHERE idpedido = ?', [id]);
    res.json({ mensaje: 'Pedido desbloqueado' });
  } catch (err) {
    console.error('❌ Error al desbloquear pedido:', err);
    res.status(500).json({ error: 'Error al desbloquear pedido' });
  }
});

// ✅ Bloquear (marcar seleccionados)
router.post('/marcar-seleccionado', async (req, res) => {
  const { ids, idusuario } = req.body;

  if (!Array.isArray(ids) || !idusuario) {
    return res.status(400).json({ error: 'Datos inválidos: se requieren ids y idusuario' });
  }

  try {
    if (!ids.length) {
      return res.json({ message: '⚠️ Ningún ID recibido, nada que bloquear.' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const sql = `UPDATE pedidos SET editando_por = ? WHERE idpedido IN (${placeholders})`;
    await db.query(sql, [idusuario, ...ids]);

    res.json({ message: `✅ ${ids.length} pedidos bloqueados para usuario ${idusuario}` });
  } catch (err) {
    console.error('❌ Error al marcar seleccionados:', err);
    res.status(500).json({ error: 'Error al bloquear pedidos' });
  }
});

// ✅ Desbloquear (desmarcar seleccionados)
router.post('/desmarcar-seleccionado', async (req, res) => {
  const { ids, idusuario } = req.body;

  if (!Array.isArray(ids) || !idusuario) {
    return res.status(400).json({ error: 'Datos inválidos: se requiere array de ids e idusuario' });
  }

  try {
    if (!ids.length) {
      return res.json({ message: '⚠️ Ningún ID recibido, nada que desbloquear.' });
    }

    // 🔐 Solo desbloquear si está bloqueado POR ESE USUARIO
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      UPDATE pedidos
      SET editando_por = NULL
      WHERE idpedido IN (${placeholders}) AND editando_por = ?
    `;

    await db.query(sql, [...ids, idusuario]);

    res.json({ message: `✅ ${ids.length} pedidos desbloqueados para usuario ${idusuario}` });
  } catch (err) {
    console.error('❌ Error al desmarcar seleccionados:', err);
    res.status(500).json({ error: 'Error al desbloquear pedidos' });
  }
});

router.post('/desmarcar-todos-usuario', async (req, res) => {
  const { idusuario } = req.body;
  if (!idusuario) return res.status(400).send('idusuario requerido');

  try {
    await db.query('UPDATE pedidos SET editando_por = NULL WHERE editando_por = ?', [idusuario]);
    res.json({ message: '✅ Bloqueos limpiados para el usuario' });
  } catch (err) {
    console.error('❌ Error limpiando bloqueos:', err);
    res.status(500).send('Error limpiando bloqueos');
  }
});

// ✅ Obtener un pedido por ID (solo si cantidad > 0)
router.get('/:id', async (req, res) => {
  const idpedido = req.params.id;

  try {
    const [rows] = await db.query(`SELECT * FROM pedidos WHERE idpedido = ? AND cantidad > 0`, [
      idpedido
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado o con cantidad en cero' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error al obtener pedido por ID:', err.message);
    res.status(500).send('Error al obtener pedido');
  }
});

module.exports = router;
