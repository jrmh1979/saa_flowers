const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

// ✅ Registro de usuario
router.post('/', async (req, res) => {
  const { nombre, correo, contrasena, activo = 1, rol = 'usuario' } = req.body;
  if (!nombre || !correo || !contrasena) return res.status(400).send('Faltan datos requeridos');

  try {
    const [verificar] = await db.query('SELECT * FROM usuarios WHERE correo = ?', [correo]);
    if (verificar.length > 0) return res.status(409).send('Correo ya registrado');

    const hash = await bcrypt.hash(contrasena, 10);
    await db.query(
      'INSERT INTO usuarios (nombre, correo, contrasena, activo, rol) VALUES (?, ?, ?, ?, ?)',
      [nombre, correo, hash, activo, rol]
    );

    res.send('✅ Usuario registrado correctamente');
  } catch (error) {
    console.error('❌ Error al registrar usuario:', error.message);
    res.status(500).send('Error interno');
  }
});

// ✅ Login
router.post('/login', async (req, res) => {
  const { correo, contrasena } = req.body;
  if (!correo || !contrasena) return res.status(400).send('Faltan datos');

  try {
    const [results] = await db.query('SELECT * FROM usuarios WHERE correo = ?', [correo]);
    if (results.length === 0) return res.status(401).send('Correo no registrado');

    const usuario = results[0];
    if (!usuario.activo) return res.status(403).send('⛔ Usuario desactivado');

    const coincide = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!coincide) return res.status(401).send('Contraseña incorrecta');

    const [permisosRows] = await db.query(
      `
      SELECT pc.permiso
      FROM permisos_usuarios pu
      JOIN permisos_catalogo pc ON pu.idpermiso = pc.id
      WHERE pu.idusuario = ?
    `,
      [usuario.id]
    );

    const permisos = permisosRows.map((p) => p.permiso);

    const token = jwt.sign(
      {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        activo: usuario.activo,
        correo: usuario.correo,
        permisos
      }
    });
  } catch (err) {
    console.error('❌ Error en login:', err.message);
    res.status(500).send('Error del servidor');
  }
});

// ✅ Listar todos los usuarios
router.get('/listar', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id AS idusuario, nombre, correo, rol, activo
      FROM usuarios
      ORDER BY nombre
    `);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error al listar usuarios:', err.message);
    res.status(500).send('Error al obtener usuarios');
  }
});

// ✅ Actualizar usuario con validación de correo duplicado
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, correo, contrasena, rol, activo } = req.body;

  try {
    // Verificar si el correo ya está en uso por otro usuario
    const [existe] = await db.query('SELECT id FROM usuarios WHERE correo = ? AND id != ?', [
      correo,
      id
    ]);
    if (existe.length > 0) {
      return res.status(409).send('⚠️ Este correo ya está registrado por otro usuario');
    }

    // Si hay contraseña, actualizar con hash
    if (contrasena && contrasena.trim() !== '') {
      const hash = await bcrypt.hash(contrasena, 10);
      await db.query(
        'UPDATE usuarios SET nombre = ?, correo = ?, contrasena = ?, rol = ?, activo = ? WHERE id = ?',
        [nombre, correo, hash, rol, activo, id]
      );
    } else {
      // Si no hay contraseña nueva, actualiza todo excepto la contraseña
      await db.query(
        'UPDATE usuarios SET nombre = ?, correo = ?, rol = ?, activo = ? WHERE id = ?',
        [nombre, correo, rol, activo, id]
      );
    }

    res.send('✅ Usuario actualizado correctamente');
  } catch (err) {
    console.error('❌ Error al actualizar usuario:', err.message);
    res.status(500).send('Error al actualizar usuario');
  }
});

// ✅ Listar todos los usuarios (con filtro opcional de activos)
router.get('/listar', async (req, res) => {
  try {
    const { activos } = req.query; // "1" | "0" | undefined
    let sql = `
      SELECT id AS idusuario, nombre, correo, rol, activo
      FROM usuarios
    `;
    const params = [];
    if (activos !== undefined) {
      sql += ` WHERE activo = ?`;
      params.push(Number(activos) ? 1 : 0);
    }
    sql += ` ORDER BY nombre`;

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error al listar usuarios:', err.message);
    res.status(500).send('Error al obtener usuarios');
  }
});

module.exports = router;
