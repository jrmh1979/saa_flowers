// routes/daeRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper: extrae ID de usuario para trazabilidad
function getUserId(req) {
  return (
    req.user?.idusuario ||
    req.user?.id ||
    req.session?.user?.idusuario ||
    req.session?.user?.id ||
    null
  );
}

// ======================= LISTA (con filtros) =======================
router.get('/', async (req, res) => {
  try {
    const { vigentes, pais_destino, p_embarque, p_destino } = req.query;
    const filtros = [];
    const params = [];

    if (vigentes === '1' || vigentes === 'true') {
      filtros.push('CURRENT_DATE() BETWEEN d.fecha_apertura AND d.fecha_caducidad');
    }
    if (pais_destino) {
      filtros.push('d.pais_destino_codigo = ?');
      params.push(pais_destino);
    }
    if (p_embarque) {
      filtros.push('d.puerto_embarque_codigo = ?');
      params.push(p_embarque);
    }
    if (p_destino) {
      filtros.push('d.puerto_destino_codigo = ?');
      params.push(p_destino);
    }

    const where = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';
    const [rows] = await db.query(
      `
      SELECT d.*,
             pe.valor  AS puerto_embarque_txt,
             pd.valor  AS puerto_destino_txt,
             pais.valor AS pais_destino_txt
      FROM sri_dae d
      LEFT JOIN catalogo_simple pe
        ON pe.categoria   COLLATE utf8mb4_0900_ai_ci = 'puerto'    COLLATE utf8mb4_0900_ai_ci
       AND pe.equivalencia COLLATE utf8mb4_0900_ai_ci = d.puerto_embarque_codigo COLLATE utf8mb4_0900_ai_ci
      LEFT JOIN catalogo_simple pd
        ON pd.categoria   COLLATE utf8mb4_0900_ai_ci = 'puerto'    COLLATE utf8mb4_0900_ai_ci
       AND pd.equivalencia COLLATE utf8mb4_0900_ai_ci = d.puerto_destino_codigo  COLLATE utf8mb4_0900_ai_ci
      LEFT JOIN catalogo_simple pais
        ON pais.categoria  COLLATE utf8mb4_0900_ai_ci = 'pais_sri'  COLLATE utf8mb4_0900_ai_ci
       AND pais.equivalencia COLLATE utf8mb4_0900_ai_ci = d.pais_destino_codigo  COLLATE utf8mb4_0900_ai_ci
      ${where}
      ORDER BY d.fecha_caducidad ASC, d.numero ASC
      `,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error listando DAE:', err.message);
    res.status(500).json({ error: 'Error al listar DAE' });
  }
});

// ============== VIGENTES (para combos de factura) ==================
router.get('/vigentes', async (req, res) => {
  try {
    const { pais_destino, p_embarque, p_destino, fecha, fecha_vuelo } = req.query;

    if (!pais_destino || !p_embarque || !p_destino) {
      return res.status(400).json({
        error: 'Faltan parámetros (pais_destino, p_embarque, p_destino)'
      });
    }

    // Usar fecha_vuelo si viene; si no, 'fecha'; si ninguna, usar CURRENT_DATE()
    const fechaBase = (fecha_vuelo || fecha || '').trim();
    const whereFecha = fechaBase
      ? 'DATE(?) BETWEEN fecha_apertura AND fecha_caducidad'
      : 'CURRENT_DATE() BETWEEN fecha_apertura AND fecha_caducidad';

    const sql = `
      SELECT iddae, numero, fecha_apertura, fecha_caducidad
        FROM sri_dae
       WHERE ${whereFecha}
         AND pais_destino_codigo    = ?
         AND puerto_embarque_codigo = ?
         AND puerto_destino_codigo  = ?
       ORDER BY fecha_caducidad ASC
    `;
    const params = fechaBase
      ? [fechaBase, pais_destino, p_embarque, p_destino]
      : [pais_destino, p_embarque, p_destino];

    console.log('[DAE/vigentes] SQL params:', params);
    const [rows] = await db.query(sql, params);
    console.log('[DAE/vigentes] filas:', rows.length);

    res.json(rows);
  } catch (err) {
    console.error('❌ Error listando DAE vigentes:', err.message);
    res.status(500).json({ error: 'Error al listar DAE vigentes' });
  }
});

// ========================== GET POR ID =============================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `
      SELECT d.*,
             pe.valor  AS puerto_embarque_txt,
             pd.valor  AS puerto_destino_txt,
             pais.valor AS pais_destino_txt
      FROM sri_dae d
      LEFT JOIN catalogo_simple pe
        ON pe.categoria   COLLATE utf8mb4_0900_ai_ci = 'puerto'    COLLATE utf8mb4_0900_ai_ci
       AND pe.equivalencia COLLATE utf8mb4_0900_ai_ci = d.puerto_embarque_codigo COLLATE utf8mb4_0900_ai_ci
      LEFT JOIN catalogo_simple pd
        ON pd.categoria   COLLATE utf8mb4_0900_ai_ci = 'puerto'    COLLATE utf8mb4_0900_ai_ci
       AND pd.equivalencia COLLATE utf8mb4_0900_ai_ci = d.puerto_destino_codigo  COLLATE utf8mb4_0900_ai_ci
      LEFT JOIN catalogo_simple pais
        ON pais.categoria  COLLATE utf8mb4_0900_ai_ci = 'pais_sri'  COLLATE utf8mb4_0900_ai_ci
       AND pais.equivalencia COLLATE utf8mb4_0900_ai_ci = d.pais_destino_codigo  COLLATE utf8mb4_0900_ai_ci
      WHERE d.iddae = ?
      `,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'DAE no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error obteniendo DAE:', err.message);
    res.status(500).json({ error: 'Error al obtener DAE' });
  }
});

// ============================ CREATE ===============================
router.post('/', async (req, res) => {
  try {
    let {
      numero,
      pais_destino_codigo,
      puerto_embarque_codigo,
      puerto_destino_codigo,
      fecha_apertura,
      fecha_caducidad,
      observaciones
    } = req.body;

    // Normalización
    numero = (numero || '').toString().trim().toUpperCase();
    observaciones = observaciones ? String(observaciones).trim() : null;

    if (
      !numero ||
      !pais_destino_codigo ||
      !puerto_embarque_codigo ||
      !puerto_destino_codigo ||
      !fecha_apertura ||
      !fecha_caducidad
    ) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    if (new Date(fecha_apertura) > new Date(fecha_caducidad)) {
      return res
        .status(400)
        .json({ error: 'La fecha de apertura no puede ser mayor que la de caducidad' });
    }

    const creado_por = getUserId(req);

    await db.query(
      `INSERT INTO sri_dae
        (numero, pais_destino_codigo, puerto_embarque_codigo, puerto_destino_codigo,
         fecha_apertura, fecha_caducidad, observaciones, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numero,
        pais_destino_codigo,
        puerto_embarque_codigo,
        puerto_destino_codigo,
        fecha_apertura,
        fecha_caducidad,
        observaciones,
        creado_por
      ]
    );

    res.status(201).send('✅ DAE creada');
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El número de DAE ya existe' });
    }
    console.error('❌ Error creando DAE:', err.message);
    res.status(500).json({ error: 'Error al crear DAE' });
  }
});

// ============================ UPDATE ===============================
router.put('/:id', async (req, res) => {
  try {
    let {
      numero,
      pais_destino_codigo,
      puerto_embarque_codigo,
      puerto_destino_codigo,
      fecha_apertura,
      fecha_caducidad,
      observaciones
    } = req.body;
    const { id } = req.params;

    numero = (numero || '').toString().trim().toUpperCase();
    observaciones = observaciones ? String(observaciones).trim() : null;

    if (
      !numero ||
      !pais_destino_codigo ||
      !puerto_embarque_codigo ||
      !puerto_destino_codigo ||
      !fecha_apertura ||
      !fecha_caducidad
    ) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    if (new Date(fecha_apertura) > new Date(fecha_caducidad)) {
      return res
        .status(400)
        .json({ error: 'La fecha de apertura no puede ser mayor que la de caducidad' });
    }

    await db.query(
      `UPDATE sri_dae
         SET numero = ?,
             pais_destino_codigo = ?,
             puerto_embarque_codigo = ?,
             puerto_destino_codigo = ?,
             fecha_apertura = ?,
             fecha_caducidad = ?,
             observaciones = ?
       WHERE iddae = ?`,
      [
        numero,
        pais_destino_codigo,
        puerto_embarque_codigo,
        puerto_destino_codigo,
        fecha_apertura,
        fecha_caducidad,
        observaciones,
        id
      ]
    );
    res.send('✅ DAE actualizada');
  } catch (err) {
    console.error('❌ Error actualizando DAE:', err.message);
    res.status(500).json({ error: 'Error al actualizar DAE' });
  }
});

// ============================ DELETE ===============================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [[uso]] = await db.query(
      `SELECT COUNT(*) AS n FROM factura_consolidada WHERE iddae = ?`,
      [id]
    );
    if (uso?.n > 0) {
      return res
        .status(400)
        .json({ error: `No se puede eliminar: DAE referenciada por ${uso.n} factura(s)` });
    }

    await db.query(`DELETE FROM sri_dae WHERE iddae = ?`, [id]);
    res.send('🗑️ DAE eliminada');
  } catch (err) {
    console.error('❌ Error eliminando DAE:', err.message);
    res.status(500).json({ error: 'Error al eliminar DAE' });
  }
});

module.exports = router;
