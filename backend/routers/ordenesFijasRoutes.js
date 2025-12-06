// routers/ordenesFijasRoutes.js
const router = require('express').Router();
const db = require('../db');
const generarPdfOrdenFijaPlantilla = require('../utils/generarPdfOrdenFijaPlantilla');

/* --------------------------------- HELPERS --------------------------------- */

// Encabezado en factura_consolidada (usa columna 'fecha'); devuelve su Id (PK 'Id')
async function crearFacturaEncabezado(conn, plantilla, fecha) {
  const [ins] = await conn.query(
    `INSERT INTO factura_consolidada
      (Idcliente, idcarguera, fecha, estado, tipoMovimiento, tipoDocumento)
     VALUES (?,?,?,?,?,?)`,
    [
      plantilla.Idcliente,
      plantilla.idcarguera,
      fecha, // encabezado.fecha
      'proceso',
      plantilla.tipoMovimiento || 'C',
      plantilla.tipoDocumento || 'F'
    ]
  );
  return ins.insertId; // <- este 'Id' va al detalle como idfactura
}

// Clona líneas de una plantilla a detalle, para 'fecha' y 'idfactura'
async function clonarDetalle(conn, orden_fija_id, fecha, idfactura) {
  const [ins] = await conn.query(
    `INSERT INTO factura_consolidada_detalle
     (codigo,idproveedor,idproducto,idvariedad,idlongitud,idempaque,idtipocaja,idgrupo,
      cantidad,piezas,cantidadRamos,tallos,cantidadTallos,precio_unitario,precio_venta,subtotal,subtotalVenta,
      idusuario,fechacompra,idfactura,idmix,totalRamos,esramo)
     SELECT
      d.codigo,d.idproveedor,d.idproducto,d.idvariedad,d.idlongitud,d.idempaque,d.idtipocaja,d.idgrupo,
      d.cantidad,d.piezas,d.cantidadRamos,d.tallos,d.cantidadTallos,d.precio_unitario,d.precio_venta,d.subtotal,d.subtotalVenta,
      d.idusuario, CONCAT(?, ' 00:00:00'), ?, d.idmix, d.totalRamos, d.esramo
     FROM orden_fija_detalle d
     WHERE d.orden_fija_id = ?`,
    [fecha, idfactura, orden_fija_id]
  );
  return ins.affectedRows;
}

// Idempotencia
async function yaGenerado(conn, orden_fija_id, fecha) {
  const [rows] = await conn.query(
    'SELECT 1 FROM orden_fija_job WHERE orden_fija_id=? AND fecha_envio=? FOR UPDATE',
    [orden_fija_id, fecha]
  );
  return rows.length > 0;
}
async function registrarJob(conn, orden_fija_id, fecha) {
  await conn.query(
    'INSERT INTO orden_fija_job (orden_fija_id, fecha_envio, estado) VALUES (?,?, "GENERADO")',
    [orden_fija_id, fecha]
  );
}

/* --------------------------- PROGRAMAR DESDE FACTURA ------------------------ */
/**
 * POST /api/ordenes-fijas/from-factura
 */
router.post('/from-factura', async (req, res) => {
  const {
    Idcliente,
    idcarguera,
    estado = 'proceso',
    tipoMovimiento = 'C',
    tipoDocumento = 'F',
    dia_semana,
    frecuencia = 'SEMANAL',
    fecha_inicio = null,
    fecha_fin = null,
    lead_time_dias = 3,
    observaciones = null,
    iddetalle_list = [],
    esramo_all = 0
  } = req.body || {};

  if (
    !Idcliente ||
    !idcarguera ||
    !dia_semana ||
    !Array.isArray(iddetalle_list) ||
    iddetalle_list.length === 0
  ) {
    return res
      .status(400)
      .json({ ok: false, msg: 'Faltan: Idcliente, idcarguera, dia_semana, iddetalle_list[]' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Crear plantilla (orden_fija)
    const [headRes] = await conn.query(
      `INSERT INTO orden_fija
       (Idcliente,idcarguera,estado,tipoMovimiento,tipoDocumento,
        dia_semana,frecuencia,fecha_inicio,fecha_fin,lead_time_dias,observaciones)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        Idcliente,
        idcarguera,
        estado,
        tipoMovimiento,
        tipoDocumento,
        dia_semana,
        frecuencia,
        fecha_inicio,
        fecha_fin,
        lead_time_dias,
        observaciones
      ]
    );
    const ordenFijaId = headRes.insertId;

    // 2) Copiar detalle desde factura_consolidada_detalle → orden_fija_detalle
    const ids = iddetalle_list.map(Number).filter(Boolean);
    const placeholders = ids.map(() => '?').join(',');
    if (!placeholders) throw new Error('iddetalle_list vacío');

    const [insRes] = await conn.query(
      `INSERT INTO orden_fija_detalle
   (orden_fija_id, origen_iddetalle, codigo, idproveedor, idproducto, idvariedad, idlongitud, idempaque, idtipocaja, idgrupo,
    cantidad, piezas, cantidadRamos, tallos, cantidadTallos, precio_unitario, precio_venta, subtotal, subtotalVenta,
    idusuario, idmix, totalRamos, esramo)
   SELECT
     ?, f.iddetalle, f.codigo, f.idproveedor, f.idproducto, f.idvariedad, f.idlongitud, f.idempaque, f.idtipocaja, f.idgrupo,
     f.cantidad, f.piezas, f.cantidadRamos, f.tallos, f.cantidadTallos, f.precio_unitario, f.precio_venta, f.subtotal, f.subtotalVenta,
     f.idusuario, f.idmix, f.totalRamos, ?
   FROM factura_consolidada_detalle f
   WHERE f.iddetalle IN (${placeholders})`,
      [ordenFijaId, esramo_all ? 1 : 0, ...ids] // 👈 OJO orden de params
    );

    await conn.commit();
    res.json({ ok: true, orden_fija_id: ordenFijaId, filas: insRes.affectedRows });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

/* ----------------------------- SUBIR UNA PLANTILLA -------------------------- */
/**
 * POST /api/ordenes-fijas/:id/subir
 * body: { fecha: 'YYYY-MM-DD' }
 */
router.post('/:id/subir', async (req, res) => {
  const { id } = req.params;
  const { fecha } = req.body || {};
  if (!fecha) return res.status(400).json({ ok: false, msg: 'Falta fecha (YYYY-MM-DD)' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [H] = await conn.query('SELECT * FROM orden_fija WHERE id=? FOR UPDATE', [id]);
    if (!H.length) throw new Error('Orden fija no existe');
    const head = H[0];
    if (head.estado !== 'proceso') throw new Error('Orden fija no está activa para subir');

    const [[{ dow }]] = await conn.query('SELECT WEEKDAY(?) + 1 AS dow', [fecha]);
    if (Number(dow) !== Number(head.dia_semana))
      throw new Error('La fecha no coincide con el día programado');

    if (head.fecha_inicio && fecha < head.fecha_inicio)
      throw new Error('Fecha antes del inicio de vigencia');
    if (head.fecha_fin && fecha > head.fecha_fin)
      throw new Error('Fecha después del fin de vigencia');

    if (await yaGenerado(conn, id, fecha)) {
      await conn.commit();
      return res.json({ ok: true, already: true, msg: 'Ya fue subida para esa fecha' });
    }

    const idfactura = await crearFacturaEncabezado(conn, head, fecha);
    const generados = await clonarDetalle(conn, id, fecha, idfactura);
    await registrarJob(conn, id, fecha);

    await conn.commit();
    res.json({ ok: true, generados, idfactura });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

/* ------------------------- SUBIR TODAS LAS DEL DÍA -------------------------- */
/**
 * POST /api/ordenes-fijas/subir
 * body: { fecha: 'YYYY-MM-DD' }
 */
router.post('/subir', async (req, res) => {
  const { fecha } = req.body || {};
  if (!fecha) return res.status(400).json({ ok: false, msg: 'Falta fecha' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[{ dow }]] = await conn.query('SELECT WEEKDAY(?) + 1 AS dow', [fecha]);

    const [heads] = await conn.query(
      `SELECT * FROM orden_fija
       WHERE estado='proceso'
         AND dia_semana=?
         AND (fecha_inicio IS NULL OR ? >= fecha_inicio)
         AND (fecha_fin IS NULL OR ? <= fecha_fin)`,
      [dow, fecha, fecha]
    );

    let total = 0;
    const headersCreados = [];

    for (const h of heads) {
      if (await yaGenerado(conn, h.id, fecha)) continue;

      const idfactura = await crearFacturaEncabezado(conn, h, fecha);
      const generados = await clonarDetalle(conn, h.id, fecha, idfactura);
      await registrarJob(conn, h.id, fecha);

      total += generados;
      headersCreados.push({ orden_fija_id: h.id, idfactura });
    }

    await conn.commit();
    res.json({ ok: true, generados: total, plantillas: heads.length, headers: headersCreados });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

/* ------------------------------- JOBS EN ESTE MISMO ARCHIVO ------------------ */
// Opción 1: genera lo de HOY (DOW)
async function autoSubirProgramadasParaHoy() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[{ hoy }]] = await conn.query('SELECT CURDATE() AS hoy');
    const [[{ dow }]] = await conn.query('SELECT WEEKDAY(CURDATE()) + 1 AS dow');

    const [heads] = await conn.query(
      `SELECT * FROM orden_fija
       WHERE estado='proceso'
         AND dia_semana=?
         AND (fecha_inicio IS NULL OR ? >= fecha_inicio)
         AND (fecha_fin IS NULL OR ? <= fecha_fin)`,
      [dow, hoy, hoy]
    );

    let total = 0;
    const headers = [];

    for (const h of heads) {
      if (await yaGenerado(conn, h.id, hoy)) continue;

      const idfactura = await crearFacturaEncabezado(conn, h, hoy);
      const gen = await clonarDetalle(conn, h.id, hoy, idfactura);
      await registrarJob(conn, h.id, hoy);

      total += gen;
      headers.push({ orden_fija_id: h.id, idfactura, fecha: hoy });
    }

    await conn.commit();
    return { ok: true, generados: total, plantillas: heads.length, headers };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Opción 2: genera por lead_time_dias (fecha objetivo = hoy + lead_time)
async function autoSubirProgramadasPorLeadTime() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [heads] = await conn.query(`SELECT * FROM orden_fija WHERE estado='proceso'`);

    let total = 0;
    const headers = [];

    for (const h of heads) {
      const [[{ target }]] = await conn.query(
        'SELECT DATE_ADD(CURDATE(), INTERVAL ? DAY) AS target',
        [h.lead_time_dias || 0]
      );

      const [[{ dow }]] = await conn.query('SELECT WEEKDAY(?) + 1 AS dow', [target]);
      if (Number(dow) !== Number(h.dia_semana)) continue;
      if (h.fecha_inicio && target < h.fecha_inicio) continue;
      if (h.fecha_fin && target > h.fecha_fin) continue;

      // Frecuencias básicas
      if (h.frecuencia === 'ODD_WEEKS' || h.frecuencia === 'EVEN_WEEKS') {
        const [[{ wk }]] = await conn.query('SELECT WEEKOFYEAR(?) AS wk', [target]);
        if (h.frecuencia === 'ODD_WEEKS' && wk % 2 === 0) continue;
        if (h.frecuencia === 'EVEN_WEEKS' && wk % 2 === 1) continue;
      }
      if (h.frecuencia === 'BISEMANAL' && h.fecha_inicio) {
        const [[{ wdiff }]] = await conn.query('SELECT FLOOR(DATEDIFF(?, ?)/7) AS wdiff', [
          target,
          h.fecha_inicio
        ]);
        if (wdiff % 2 !== 0) continue;
      }

      if (await yaGenerado(conn, h.id, target)) continue;

      const idfactura = await crearFacturaEncabezado(conn, h, target);
      const gen = await clonarDetalle(conn, h.id, target, idfactura);
      await registrarJob(conn, h.id, target);

      total += gen;
      headers.push({ orden_fija_id: h.id, idfactura, fecha: target });
    }

    await conn.commit();
    return { ok: true, generados: total, plantillas: heads.length, headers };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Los “jobs” se exponen como props del router para usarlos desde el server
router.autoSubirProgramadasParaHoy = autoSubirProgramadasParaHoy;
router.autoSubirProgramadasPorLeadTime = autoSubirProgramadasPorLeadTime;

/* ------------------------- ENDPOINTS para probar jobs ----------------------- */
router.post('/cron/run-hoy', async (_req, res) => {
  try {
    const r = await autoSubirProgramadasParaHoy();
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});
router.post('/cron/run-lead', async (_req, res) => {
  try {
    const r = await autoSubirProgramadasPorLeadTime();
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// LISTAR TODAS LAS PLANTILLAS
router.get('/list', async (_req, res) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT 
         ofi.*,
         t.nombre AS cliente,
         (SELECT COUNT(*) FROM orden_fija_detalle d WHERE d.orden_fija_id = ofi.id) AS lineas
       FROM orden_fija ofi
       LEFT JOIN terceros t ON t.idtercero = ofi.Idcliente
       ORDER BY ofi.id DESC`
    );
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

// LISTAR JOBS (programaciones generadas). Si no pasas desde/hasta, trae todas.
router.get('/jobs', async (req, res) => {
  const { desde = null, hasta = null } = req.query || {};
  const conn = await db.getConnection();
  try {
    let sql = `
      SELECT 
        j.id,
        j.orden_fija_id,
        j.fecha_envio,
        j.estado,
        j.fecha_envio AS created_at,     -- <- no usamos j.created_at porque la columna no existe en tu tabla
        ofi.Idcliente,
        t.nombre AS cliente
      FROM orden_fija_job j
      JOIN orden_fija ofi ON ofi.id = j.orden_fija_id
      LEFT JOIN terceros t ON t.idtercero = ofi.Idcliente
      WHERE 1=1`;
    const params = [];
    if (desde) {
      sql += ' AND j.fecha_envio >= ?';
      params.push(desde);
    }
    if (hasta) {
      sql += ' AND j.fecha_envio <= ?';
      params.push(hasta);
    }
    sql += ' ORDER BY j.fecha_envio DESC, j.id DESC';
    const [rows] = await conn.query(sql, params);
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

// ELIMINAR ORDEN(ES) FIJA(S) COMPLETAS (plantilla + detalles + jobs)
router.delete('/', async (req, res) => {
  const { ids = [] } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ ok: false, msg: 'ids[] requerido' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const idnums = ids.map(Number).filter(Boolean);
    const ph = idnums.map(() => '?').join(',');
    await conn.query(`DELETE FROM orden_fija_job WHERE orden_fija_id IN (${ph})`, idnums);
    await conn.query(`DELETE FROM orden_fija_detalle WHERE orden_fija_id IN (${ph})`, idnums);
    const [r] = await conn.query(`DELETE FROM orden_fija WHERE id IN (${ph})`, idnums);
    await conn.commit();
    res.json({ ok: true, borradas: r.affectedRows });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

// ELIMINAR PROGRAMACIONES (jobs) SELECCIONADAS
router.delete('/jobs', async (req, res) => {
  const { job_ids = [], pairs = [] } = req.body || {};
  if ((!Array.isArray(job_ids) || !job_ids.length) && (!Array.isArray(pairs) || !pairs.length)) {
    return res.status(400).json({ ok: false, msg: 'job_ids[] o pairs[] requerido' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0;

    if (Array.isArray(job_ids) && job_ids.length) {
      const ids = job_ids.map(Number).filter(Boolean);
      const ph = ids.map(() => '?').join(',');
      const [r] = await conn.query(`DELETE FROM orden_fija_job WHERE id IN (${ph})`, ids);
      total += r.affectedRows;
    }

    if (Array.isArray(pairs) && pairs.length) {
      for (const p of pairs) {
        if (!p.orden_fija_id || !p.fecha) continue;
        const [r] = await conn.query(
          `DELETE FROM orden_fija_job WHERE orden_fija_id=? AND fecha_envio=?`,
          [p.orden_fija_id, p.fecha]
        );
        total += r.affectedRows;
      }
    }

    await conn.commit();
    res.json({ ok: true, eliminados: total });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

// GET /api/ordenes-fijas/preview?fecha=YYYY-MM-DD
router.get('/preview', async (req, res) => {
  const { fecha } = req.query || {};
  if (!fecha) return res.status(400).json({ ok: false, msg: 'Falta fecha' });

  const conn = await db.getConnection();
  try {
    // dow: 1=Lun..7=Dom (WEEKDAY: 0=Lun..6=Dom)
    const [[{ dow }]] = await conn.query(`SELECT WEEKDAY(?) + 1 AS dow`, [fecha]);

    // Controles de debug para ver qué está pasando
    const [[c1]] = await conn.query(`SELECT COUNT(*) AS total FROM orden_fija`);
    const [[c2]] = await conn.query(
      `SELECT COUNT(*) AS activos 
       FROM orden_fija 
       WHERE TRIM(LOWER(estado)) = 'proceso'`
    );
    const [[c3]] = await conn.query(
      `SELECT COUNT(*) AS por_dia 
       FROM orden_fija 
       WHERE TRIM(LOWER(estado))='proceso' AND dia_semana=?`,
      [dow]
    );
    const [[c4]] = await conn.query(
      `SELECT COUNT(*) AS en_vigencia 
       FROM orden_fija 
       WHERE TRIM(LOWER(estado))='proceso' 
         AND dia_semana=? 
         AND (fecha_inicio IS NULL OR DATE(?) >= DATE(fecha_inicio))
         AND (fecha_fin    IS NULL OR DATE(?) <= DATE(fecha_fin))`,
      [dow, fecha, fecha]
    );

    // Query final, robusta: normaliza estado y fuerza DATE() en ambos lados
    const [rows] = await conn.query(
      `SELECT 
         ofi.id,
         ofi.Idcliente,
         t.nombre        AS cliente,
         ofi.dia_semana,
         ofi.frecuencia,
         ofi.fecha_inicio,
         ofi.fecha_fin,
         ofi.created_at,
         ofi.observaciones,
         (SELECT COUNT(*) 
            FROM orden_fija_detalle d 
           WHERE d.orden_fija_id = ofi.id) AS lineas
       FROM orden_fija ofi
       LEFT JOIN terceros t ON t.idtercero = ofi.Idcliente
       WHERE TRIM(LOWER(ofi.estado))='proceso'
         AND ofi.dia_semana = ?
         AND (ofi.fecha_inicio IS NULL OR DATE(?) >= DATE(ofi.fecha_inicio))
         AND (ofi.fecha_fin    IS NULL OR DATE(?) <= DATE(ofi.fecha_fin))
       ORDER BY ofi.id DESC`,
      [dow, fecha, fecha]
    );

    res.json({
      ok: true,
      fecha,
      dow, // <- 1=Lun..7=Dom
      debug: {
        total: c1.total,
        activos: c2.activos,
        por_dia: c3.por_dia,
        en_vigencia: c4.en_vigencia
      },
      items: rows
    });
  } catch (e) {
    console.error('preview OF error:', e);
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    conn.release();
  }
});

// GET /api/ordenes-fijas/job/:jobId/pdf
router.get('/job/:jobId/pdf', async (req, res) => {
  const { jobId } = req.params;
  try {
    const [[row]] = await db.query(`SELECT idfactura FROM orden_fija_job WHERE id=?`, [jobId]);
    if (!row || !row.idfactura) {
      return res.status(404).json({ ok: false, msg: 'El job no tiene idfactura asociado.' });
    }
    const buffer = await generarPdfOrdenFija({ idfactura: Number(row.idfactura) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ordenfija_job_${jobId}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// GET /api/ordenes-fijas/plantilla/:id/pdf  -> PDF de la PLANTILLA (orden_fija + detalle)
router.get('/plantilla/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const buffer = await generarPdfOrdenFijaPlantilla({
      orden_fija_id: Number(id)
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="orden_fija_${id}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error('PDF plantilla error:', e);
    res.status(500).json({ ok: false, msg: e.message || 'No se pudo generar el PDF' });
  }
});

// GET /api/ordenes-fijas/factura/:idfactura/pdf  -> PDF desde idfactura
router.get('/factura/:idfactura/pdf', async (req, res) => {
  const { idfactura } = req.params;
  try {
    const buffer = await generarPdfOrdenFijaPlantilla({ idfactura: Number(idfactura) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ordenfija_${idfactura}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error('PDF factura error:', e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

module.exports = router;
