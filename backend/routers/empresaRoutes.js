// routes/empresaRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const verificarToken = require('../middlewares/verificarToken');

function requireAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo admin' });
  }
  next();
}

async function addColumnIfMissing(table, col, ddl) {
  const [cols] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [col]);
  if (!cols.length) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

async function ensureEmisorColumns() {
  try {
    await addColumnIfMissing(
      'sri_emisor',
      'mostrar_ruc',
      'mostrar_ruc TINYINT(1) NOT NULL DEFAULT 1'
    );
    await addColumnIfMissing('sri_emisor', 'mensaje_invoice', 'mensaje_invoice TEXT NULL');
    await addColumnIfMissing('sri_emisor', 'datos_bancarios', 'datos_bancarios TEXT NULL');
  } catch (e) {
    // Ignorar si no hay permisos
  }
}

/* ========= EMISOR ========= */
router.get('/emisor', verificarToken, async (_req, res) => {
  await ensureEmisorColumns();
  const [rows] = await db.query(`SELECT * FROM sri_emisor LIMIT 1`);
  if (!rows.length) {
    return res.json({
      id: null,
      razon_social: '',
      nombre_comercial: '',
      ruc: '',
      dir_matriz: '',
      obligado_contabilidad: 'SI',
      contribuyente_especial_numero: '',
      ambiente: '1',
      telefono: '',
      email: '',
      logo_base64: '',
      mostrar_ruc: 1,
      mensaje_invoice: '',
      datos_bancarios: ''
      // tipo_emision/xsd_version existen pero no se usan en UI
    });
  }
  const r = rows[0];
  res.json({
    ...r,
    mostrar_ruc: r.mostrar_ruc === null || r.mostrar_ruc === undefined ? 1 : r.mostrar_ruc,
    mensaje_invoice: r.mensaje_invoice || '',
    datos_bancarios: r.datos_bancarios || ''
  });
});

router.put('/emisor', verificarToken, requireAdmin, async (req, res) => {
  await ensureEmisorColumns();
  const p = req.body || {};
  const mostrarRuc =
    typeof p.mostrar_ruc === 'boolean'
      ? p.mostrar_ruc
        ? 1
        : 0
      : Number(p.mostrar_ruc ?? 1)
        ? 1
        : 0;

  const [rows] = await db.query(`SELECT id FROM sri_emisor LIMIT 1`);
  if (rows.length) {
    await db.query(
      `UPDATE sri_emisor SET
         razon_social=?, nombre_comercial=?, ruc=?, dir_matriz=?,
         obligado_contabilidad=?, contribuyente_especial_numero=?,
         ambiente=?, telefono=?, email=?,
         logo_base64=?, mostrar_ruc=?, mensaje_invoice=?, datos_bancarios=?
       WHERE id=?`,
      [
        p.razon_social,
        p.nombre_comercial,
        p.ruc,
        p.dir_matriz,
        p.obligado_contabilidad || 'SI',
        p.contribuyente_especial_numero || null,
        p.ambiente || '1',
        p.telefono || null,
        p.email || null,
        p.logo_base64 || null,
        mostrarRuc,
        p.mensaje_invoice || null,
        p.datos_bancarios || null,
        rows[0].id
      ]
    );
    return res.json({ ok: true, id: rows[0].id });
  }

  // En inserción, dejamos que el schema ponga defaults de tipo_emision/xsd_version
  const [ins] = await db.query(
    `INSERT INTO sri_emisor
      (razon_social, nombre_comercial, ruc, dir_matriz, obligado_contabilidad,
       contribuyente_especial_numero, ambiente, telefono, email,
       logo_base64, mostrar_ruc, mensaje_invoice, datos_bancarios)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p.razon_social,
      p.nombre_comercial,
      p.ruc,
      p.dir_matriz,
      p.obligado_contabilidad || 'SI',
      p.contribuyente_especial_numero || null,
      p.ambiente || '1',
      p.telefono || null,
      p.email || null,
      p.logo_base64 || null,
      mostrarRuc,
      p.mensaje_invoice || null,
      p.datos_bancarios || null
    ]
  );
  res.json({ ok: true, id: ins.insertId });
});

module.exports = router;
