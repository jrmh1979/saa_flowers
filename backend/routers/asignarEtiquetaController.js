const express = require('express');
const router = express.Router();
const db = require('../db');

// Ruta: POST /api/etiquetas/asignar
router.post('/asignar', async (req, res) => {
  const { idfactura, base } = req.body;
  if (!idfactura || !base) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
    const [detalles] = await db.query(`
      SELECT iddetalle, idmix
      FROM factura_consolidada_detalle
      WHERE idfactura = ?
      ORDER BY idmix, iddetalle
    `, [idfactura]);

    const codigosAsignados = {};
    let contador = 1;

    for (const d of detalles) {
      let codigo = '';
      if (d.idmix) {
        if (!codigosAsignados[d.idmix]) {
          codigosAsignados[d.idmix] = `${base}${contador}`;
          contador++;
        }
        codigo = codigosAsignados[d.idmix];
      } else {
        codigo = `${base}${contador}`;
        contador++;
      }

      await db.query(`
        UPDATE factura_consolidada_detalle
        SET codetiqueta = ?
        WHERE iddetalle = ?
      `, [codigo, d.iddetalle]);
    }

    res.json({ success: true, message: '✅ Etiquetas asignadas correctamente' });
  } catch (err) {
    console.error('❌ Error asignando etiquetas:', err.message);
    res.status(500).json({ error: 'Error asignando etiquetas' });
  }
});

module.exports = router;
