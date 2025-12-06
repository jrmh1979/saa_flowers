const express = require('express');
const db = require('../db');
const router = express.Router();

// ✅ Obtener el catálogo completo de permisos
router.get('/catalogo', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, permiso, descripcion FROM permisos_catalogo ORDER BY permiso'
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener catálogo de permisos:', err.message);
    res.status(500).send('Error al obtener permisos');
  }
});

// ✅ Obtener los permisos asignados a un usuario (sin excepción por admin)
router.get('/usuario/:idusuario', async (req, res) => {
  const { idusuario } = req.params;
  try {
    const [rows] = await db.query(
      `
      SELECT p.id AS idpermiso, p.permiso, p.descripcion
      FROM permisos_usuarios pu
      JOIN permisos_catalogo p ON pu.idpermiso = p.id
      WHERE pu.idusuario = ?
    `,
      [idusuario]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener permisos del usuario:', err.message);
    res.status(500).send('Error al obtener permisos del usuario');
  }
});

// ✅ Asignar uno o varios permisos a un usuario (reemplaza todos)
router.post('/asignar', async (req, res) => {
  const { idusuario, idpermisos } = req.body;

  if (!idusuario || !Array.isArray(idpermisos)) {
    return res.status(400).send('Faltan datos o el formato es incorrecto');
  }

  try {
    // 1. Eliminar permisos anteriores
    await db.query('DELETE FROM permisos_usuarios WHERE idusuario = ?', [idusuario]);

    // 2. Insertar los nuevos (si hay)
    if (idpermisos.length > 0) {
      const values = idpermisos.map((id) => [idusuario, id]);
      await db.query('INSERT INTO permisos_usuarios (idusuario, idpermiso) VALUES ?', [values]);
    }

    res.send('✅ Permisos actualizados correctamente');
  } catch (err) {
    console.error('❌ Error al asignar permisos:', err.message);
    res.status(500).send('Error al asignar permisos');
  }
});

// ✅ Eliminar uno o varios permisos de un usuario
router.post('/quitar', async (req, res) => {
  const { idusuario, idpermisos } = req.body;

  if (!idusuario || !Array.isArray(idpermisos)) {
    return res.status(400).send('Faltan datos o el formato es incorrecto');
  }

  try {
    const placeholders = idpermisos.map(() => '?').join(',');
    await db.query(
      `DELETE FROM permisos_usuarios WHERE idusuario = ? AND idpermiso IN (${placeholders})`,
      [idusuario, ...idpermisos]
    );
    res.send('✅ Permisos eliminados correctamente');
  } catch (err) {
    console.error('❌ Error al quitar permisos:', err.message);
    res.status(500).send('Error al quitar permisos');
  }
});

// ➕ Crear nuevo permiso en el catálogo
router.post('/catalogo', async (req, res) => {
  const { permiso, descripcion } = req.body;
  if (!permiso) return res.status(400).send('Falta el nombre del permiso');
  try {
    await db.query('INSERT INTO permisos_catalogo (permiso, descripcion) VALUES (?, ?)', [
      permiso,
      descripcion
    ]);
    res.send('✅ Permiso agregado al catálogo');
  } catch (err) {
    console.error('❌ Error al agregar permiso:', err.message);
    res.status(500).send('Error al agregar permiso');
  }
});

// 🗑️ Eliminar permiso del catálogo
router.delete('/catalogo/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM permisos_catalogo WHERE id = ?', [id]);
    res.send('✅ Permiso eliminado del catálogo');
  } catch (err) {
    console.error('❌ Error al eliminar permiso:', err.message);
    res.status(500).send('Error al eliminar permiso');
  }
});

// ✅ Ruta para obtener todos los permisos asignados por usuario
router.get('/todos', async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT pu.idusuario, pc.permiso, 1 as valor
      FROM permisos_usuarios pu
      JOIN permisos_catalogo pc ON pu.idpermiso = pc.id
    `);
    res.json(result);
  } catch (error) {
    console.error('Error en /api/permisos/todos:', error);
    res.status(500).json({ error: 'Error al obtener permisos' });
  }
});

module.exports = router;
