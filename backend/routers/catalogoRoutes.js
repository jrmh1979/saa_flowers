const express = require('express');
const db = require('../db');
const router = express.Router();

// ✅ Obtener valores por categoría
router.get('/', async (req, res) => {
  const { categoria } = req.query;

  if (!categoria) {
    return res.status(400).json({ error: 'Falta la categoría en la consulta' });
  }

  try {
    const [results] = await db.query(
      `SELECT id, valor, categoria, equivalencia, Otros
       FROM catalogo_simple
       WHERE categoria = ?
       ORDER BY valor`,
      [categoria]
    );
    res.json(results);
  } catch (err) {
    console.error('❌ Error al obtener catálogo:', err.message);
    res.status(500).json({ error: 'Error al obtener catálogo' });
  }
});

// ✅ Obtener categorías únicas
router.get('/categorias', async (req, res) => {
  try {
    const [results] = await db.query(
      `SELECT DISTINCT categoria FROM catalogo_simple ORDER BY categoria`
    );
    res.json(results);
  } catch (err) {
    console.error('❌ Error al obtener categorías:', err.message);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// ✅ Insertar nuevo valor
router.post('/catalogo-simple', async (req, res) => {
  const { valor, categoria, equivalencia, otros } = req.body;

  if (!valor || !categoria) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    if (categoria === 'carguera') {
      // Para carguera también guardamos contacto (equivalencia) y teléfono (Otros)
      await db.query(
        `INSERT INTO catalogo_simple (valor, categoria, equivalencia, Otros)
         VALUES (?, ?, ?, ?)`,
        [valor, categoria, equivalencia || null, otros || null]
      );
    } else {
      // Otras categorías como antes
      await db.query(
        `INSERT INTO catalogo_simple (valor, categoria)
         VALUES (?, ?)`,
        [valor, categoria]
      );
    }

    res.send('✅ Valor agregado al catálogo');
  } catch (err) {
    console.error('❌ Error al insertar valor en el catálogo:', err.message);
    res.status(500).json({ error: 'Error al insertar valor' });
  }
});

// ✅ Actualizar valor
router.put('/catalogo-simple/:id', async (req, res) => {
  const { valor, equivalencia, otros } = req.body;
  const { id } = req.params;

  if (!valor) {
    return res.status(400).json({ error: 'Valor requerido para actualización' });
  }

  try {
    // Construimos el UPDATE dinámicamente para no tocar equivalencia/Otros
    // en categorías que no los envían (evitamos romper otros catálogos).
    let query = 'UPDATE catalogo_simple SET valor = ?';
    const params = [valor];

    if (equivalencia !== undefined) {
      query += ', equivalencia = ?';
      params.push(equivalencia || null);
    }

    if (otros !== undefined) {
      query += ', Otros = ?';
      params.push(otros || null);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.query(query, params);
    res.send('✅ Valor actualizado correctamente');
  } catch (err) {
    console.error('❌ Error al actualizar valor del catálogo:', err.message);
    res.status(500).json({ error: 'Error al actualizar valor' });
  }
});

// ✅ Eliminar valor con verificación de uso
router.delete('/catalogo-simple/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar valor y categoría
    const [[registro]] = await db.query(
      `SELECT valor, categoria FROM catalogo_simple WHERE id = ?`,
      [id]
    );
    if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });

    const { valor, categoria } = registro;

    // Verificar uso según categoría
    let enUso = false;

    if (categoria === 'variedad') {
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total FROM pedidos WHERE idvariedad = ?`,
        [id]
      );
      const [[{ total2 }]] = await db.query(
        `SELECT COUNT(*) AS total FROM factura_consolidada_detalle WHERE idvariedad = ?`,
        [id]
      );
      enUso = total > 0 || total2 > 0;
    }

    if (categoria === 'producto') {
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total FROM pedidos WHERE idproducto = ?`,
        [id]
      );
      const [[{ total2 }]] = await db.query(
        `SELECT COUNT(*) AS total FROM factura_consolidada_detalle WHERE idproducto = ?`,
        [id]
      );
      enUso = total > 0 || total2 > 0;
    }

    if (enUso) {
      return res.status(400).json({ error: `No se puede eliminar porque "${valor}" está en uso` });
    }

    await db.query(`DELETE FROM catalogo_simple WHERE id = ?`, [id]);
    res.send('✅ Valor eliminado del catálogo');
  } catch (err) {
    console.error('❌ Error al eliminar valor del catálogo:', err.message);
    res.status(500).json({ error: 'Error al eliminar valor' });
  }
});

// ✅ Obtener todo el catálogo
router.get('/todo', async (req, res) => {
  try {
    const [results] = await db.query(`SELECT * FROM catalogo_simple`);
    res.json(results);
  } catch (err) {
    console.error('❌ Error al obtener catálogo completo:', err.message);
    res.status(500).json({ error: 'Error al obtener catálogo completo' });
  }
});

module.exports = router;
