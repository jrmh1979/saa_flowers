const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const verificarToken = require('../middlewares/verificarToken');
const { enviarCorreoEstadoCuenta, enviarCorreoNC } = require('../utils/correo');
const {
  generarEstadoCuentaPDFBuffer,
  generarEstadoCuentaPDFStream,
  generarEstadoCuentaPendientePDFStream,
  generarEstadoCuentaPendientePDFBuffer
} = require('../utils/generarPdfEstadoCuenta');

const {
  generarNotaCreditoPDFStream,
  generarNotaCreditoPDFBuffer
} = require('../utils/generarPdfNotaCredito');

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const fmt = (n) =>
  Number(n || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = (s) => (s ?? '').toString().trim();
const ymd = (d) => (d ? String(d).slice(0, 10) : '');

// Carpeta para evidencias de NC
const uploadDir = path.join(process.cwd(), 'uploads', 'nc');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { files: 40, fileSize: 10 * 1024 * 1024 } // 10MB
});

// Conversión muy simple; reemplázalo si ya tienes una mejor
function numeroALetrasBasico(n) {
  const entero = Math.floor(Number(n || 0));
  const centavos = Math.round((Number(n || 0) - entero) * 100);
  return `${fmt(entero)} DÓLARES ${centavos.toString().padStart(2, '0')}/100`;
}

/**
 * POST /api/cartera/si-import/:idtercero?tipoMovimiento=C|P&dry_run=1&on_duplicate=skip|error
 * Body: form-data con field "file" (xlsx/xls/csv)
 * Columnas mínimas por fila: numero_factura, fecha(YYYY-MM-DD), valor_total, (observaciones opcional)
 */
router.post('/si-import/:idtercero', verificarToken, upload.single('file'), async (req, res) => {
  const idtercero = Number(req.params.idtercero || 0);
  const tipoMovimiento = String(req.query.tipoMovimiento || 'C').toUpperCase();
  const dryRun = String(req.query.dry_run || '1') === '1';
  const onDuplicate = String(req.query.on_duplicate || 'error'); // error | skip

  if (!idtercero) return res.status(400).json({ error: 'idtercero inválido' });
  if (!['C', 'P'].includes(tipoMovimiento)) {
    return res.status(400).json({ error: 'tipoMovimiento inválido (C/P)' });
  }
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido (field: file)' });

  // ==== Helpers ====
  const excelDateToISO = (n) => {
    // Base 1899-12-30 (corrige el bug del 1900 en Excel)
    const ms = (n - 25569) * 86400 * 1000 + Date.UTC(1970, 0, 1);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  };

  const toISO = (v) => {
    if (v == null || v === '') return '';
    if (typeof v === 'number') {
      // Serial Excel
      return excelDateToISO(v);
    }
    const s = String(v).trim();
    // Si viene como 'YYYY-MM-DD...' me quedo con 10 chars
    const c10 = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(c10)) return c10;
    // Soporte gentil para DD/MM/YYYY (si alguien pega eso por error)
    const m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return ''; // inválida
  };

  const toNumberStrict = (v) => {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    // normalizar: "1.234,56" → "1234.56"; "1,234.56" → "1234.56"
    let s = String(v).trim();
    // si hay coma y punto, intenta detectar miles vs decimal
    if (s.includes(',') && s.includes('.')) {
      // si hay más puntos que comas, asumo punto miles y coma decimal
      // ejemplo "1.234,56"
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      // asumo coma decimal
      s = s.replace(',', '.');
    } else {
      // solo puntos → ya ok
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };

  const loadWorkbook = () => {
    try {
      if (req.file.buffer && req.file.buffer.length) {
        return XLSX.read(req.file.buffer, { type: 'buffer', raw: true });
      }
      if (req.file.path && fs.existsSync(req.file.path)) {
        const fileData = fs.readFileSync(req.file.path);
        return XLSX.read(fileData, { type: 'buffer', raw: true });
      }
      throw new Error('No hay buffer ni path legible para el archivo subido');
    } catch (e) {
      throw new Error('No se pudo leer el archivo. Asegúrate de subir .xlsx/.xls/.csv válidos');
    }
  };

  const conn = await db.getConnection();
  try {
    // 1) Leer workbook de forma robusta (buffer o path)
    const wb = loadWorkbook();
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      return res.status(400).json({ error: 'El archivo no contiene hojas' });
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ error: 'No se pudo leer la primera hoja' });

    // 2) Pasar a JSON con valores por defecto
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    // 3) Validar encabezados mínimos exactos del formato
    const requiredHeaders = ['numero_factura', 'fecha', 'valor_total'];
    const headers = new Set(Object.keys(rawRows[0] || {}));
    const missing = requiredHeaders.filter((h) => !headers.has(h));
    if (missing.length) {
      return res.status(400).json({
        error: 'Encabezados faltantes',
        detalle: {
          faltan: missing,
          requeridos: requiredHeaders,
          observacion:
            'Usa exactamente: numero_factura, fecha, valor_total, (observaciones opcional)'
        }
      });
    }

    // 4) Resolver padre una sola vez
    const [[padre]] = await conn.query(
      `SELECT COALESCE(idcliente_padre, idtercero) AS padre FROM terceros WHERE idtercero = ?`,
      [idtercero]
    );
    const idcliente_padre = Number(padre?.padre || idtercero);

    const resultados = [];
    const errores = [];

    if (!dryRun) await conn.beginTransaction();

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const fila = i + 2; // encabezado en fila 1

      const numero_factura = String(r.numero_factura || '').trim();
      const fecha = toISO(r.fecha);
      const valor_total = toNumberStrict(r.valor_total);
      const observaciones = String(r.observaciones || '').trim() || null;

      if (!numero_factura) {
        errores.push({ fila, error: 'numero_factura requerido' });
        continue;
      }
      if (!fecha) {
        errores.push({ fila, error: 'fecha requerida (YYYY-MM-DD)' });
        continue;
      }
      if (!(Number.isFinite(valor_total) && valor_total > 0)) {
        errores.push({ fila, error: 'valor_total debe ser numérico y > 0' });
        continue;
      }

      // Duplicado por (numero_factura + idcliente)
      const [[dup]] = await conn.query(
        `SELECT id FROM factura_consolidada WHERE numero_factura = ? AND idcliente = ?`,
        [numero_factura, idtercero]
      );
      if (dup) {
        if (onDuplicate === 'skip') {
          resultados.push({ fila, status: 'saltado (duplicado)' });
          continue;
        } else {
          errores.push({ fila, error: `Factura duplicada (#${numero_factura})` });
          continue;
        }
      }

      if (!dryRun) {
        await conn.query(
          `
          INSERT INTO factura_consolidada
            (tipoMovimiento, tipoDocumento, numero_factura,
             idcliente, idcliente_padre, fecha, valorTotal, estado, observaciones)
          VALUES (?, 'SI', ?, ?, ?, ?, ?, 'procesado', ?)
          `,
          [
            tipoMovimiento,
            numero_factura,
            idtercero,
            idcliente_padre,
            fecha,
            valor_total,
            observaciones
          ]
        );
      }

      resultados.push({ fila, status: dryRun ? 'OK (simulado)' : 'insertado' });
    }

    if (!dryRun) await conn.commit();

    res.json({
      dry_run: dryRun,
      insertados: resultados.filter((r) => r.status === 'insertado').length,
      ok_simulados: resultados.filter((r) => r.status === 'OK (simulado)').length,
      saltados: resultados.filter((r) => r.status?.startsWith('saltado')).length,
      errores: errores.length,
      detalle: { resultados, errores }
    });
  } catch (err) {
    if (!dryRun) await conn.rollback();
    console.error('❌ si-import tercero:', err);
    res.status(500).json({ error: 'Error al importar SI', detalle: err.message });
  } finally {
    conn.release();
  }
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function isClient(tipo) {
  return String(tipo || '').toUpperCase() === 'C';
}

// Devuelve el conjunto de IDs a considerar: si es cliente => principal + marks; si es proveedor => el mismo
async function idsDelTercero(tipoMovimiento, idtercero) {
  if (!isClient(tipoMovimiento)) {
    return [idtercero]; // proveedor sin jerarquía
  }
  // principal + marks
  const [rows] = await db.query(
    `SELECT idtercero
       FROM terceros
      WHERE idtercero = ?
         OR idcliente_padre = ?`,
    [idtercero, idtercero]
  );
  return rows.map((r) => r.idtercero);
}

// GET /api/cartera  — saldos por factura SIN mezclar Cliente vs Proveedor
router.get('/', async (req, res) => {
  const { tipoMovimiento, idtercero, desde, hasta } = req.query;

  const lado = String(tipoMovimiento || '').toUpperCase();
  if (!['C', 'P'].includes(lado)) {
    return res.status(400).json({ error: 'tipoMovimiento requerido (C o P)' });
  }

  try {
    // --- WHERE de facturas ---
    const where = ['fc.tipoMovimiento = ?'];
    const whereParams = [lado];

    if (idtercero) {
      if (lado === 'C') {
        // cliente principal + marks
        where.push(`
          fc.idcliente IN (
            SELECT t.idtercero
              FROM terceros t
             WHERE t.idcliente_padre = ? OR t.idtercero = ?
          )`);
        whereParams.push(idtercero, idtercero);
      } else {
        // proveedor exacto
        where.push('fc.idcliente = ?');
        whereParams.push(idtercero);
      }
    }

    if (desde && hasta) {
      where.push('fc.fecha BETWEEN ? AND ?');
      whereParams.push(desde, hasta);
    }

    // --- JOIN a pagos con filtros por lado y tercero + FIX de collation ---
    // Importante: NO poner estos filtros en WHERE para no romper el LEFT JOIN.
    let joinPagos = `
      LEFT JOIN pagos p
        ON p.idpago = pf.idpago
       /* FIX: forzamos misma collation para comparar C/P */
       AND (p.tipoMovimiento COLLATE utf8mb4_general_ci) = fc.tipoMovimiento
       AND (p.tipoDocumento COLLATE utf8mb4_general_ci) IN ('PG','NC','RT','PP')
    `;
    const joinParams = [];

    if (idtercero) {
      if (lado === 'C') {
        joinPagos += `
          AND p.idtercero IN (
            SELECT t.idtercero FROM terceros t
             WHERE t.idcliente_padre = ? OR t.idtercero = ?
          )`;
        joinParams.push(idtercero, idtercero);
      } else {
        joinPagos += ` AND p.idtercero = ?`;
        joinParams.push(idtercero);
      }
    } else {
      // Sin filtro explícito: al menos amarrar por el dueño de la factura
      joinPagos += ` AND p.idtercero = fc.idcliente`;
    }

    const sql = `
      SELECT 
        fc.id,
        fc.idcliente,
        fc.numero_factura,
        fc.fecha,
        fc.valorTotal,
        UPPER(fc.tipoDocumento) AS tipoDocumento,
        fc.estado,
        fc.observaciones,
        /* Solo contar cruces válidos (cuando hay match en p) */
        COALESCE(SUM(CASE WHEN p.idpago IS NOT NULL THEN pf.valorpago ELSE 0 END), 0) AS valorpago,
        ANY_VALUE(t.nombre) AS terceroNombre
      FROM factura_consolidada fc
      LEFT JOIN pagos_factura pf ON pf.idfactura = fc.id
      ${joinPagos}
      LEFT JOIN terceros t ON t.idtercero = fc.idcliente
      WHERE ${where.join(' AND ')} AND fc.estado <> 'proceso'
      GROUP BY fc.id
      ORDER BY fc.fecha, fc.id
    `;

    // ⚠️ Orden correcto: PRIMERO params del JOIN, luego los del WHERE
    const [rows] = await db.query(sql, [...joinParams, ...whereParams]);

    // saldo por factura = total - abonos válidos
    let acumulado = 0;
    const out = rows.map((r) => {
      const abono = Number(r.valorpago || 0);
      const total = Number(r.valorTotal || 0);
      const saldo = total - abono;
      acumulado += saldo;
      return { ...r, abono, saldo, acumulado };
    });

    res.json(out);
  } catch (err) {
    console.error('❌ Error al obtener cartera:', err);
    res.status(500).json({ error: 'Error al obtener cartera' });
  }
});

/* ------------------------------------------------------------------ */
/* TIMELINE de movimientos (estilo PDF): F / NC / ND / RT / SI + PG   */
/* ------------------------------------------------------------------ */
router.get('/timeline', async (req, res) => {
  const { tipoMovimiento, idtercero, desde, hasta } = req.query;

  if (!tipoMovimiento || !['C', 'P'].includes(tipoMovimiento) || !idtercero) {
    return res
      .status(400)
      .json({ error: 'Parámetros requeridos: tipoMovimiento (C/P), idtercero' });
  }
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Parámetros requeridos: desde, hasta' });
  }

  try {
    const ids = await idsDelTercero(tipoMovimiento, idtercero);

    // 1) Movimientos en factura_consolidada: F / NC / ND / RT / SI
    //    F, ND, SI => amount (+)
    //    NC, RT    => credits (+)
    const [rowsMov] = await db.query(
      `
      SELECT
        fc.id                      AS id,
        fc.tipoDocumento           AS tipo,
        fc.fecha                   AS fecha,
        fc.numero_factura          AS numero,
        fc.observaciones           AS obs,
        t.nombre                   AS mark,
        CASE WHEN fc.tipoDocumento IN ('F','ND','SI') THEN fc.valorTotal ELSE 0 END AS amount,
        CASE WHEN fc.tipoDocumento IN ('NC','RT')     THEN fc.valorTotal ELSE 0 END AS credits,
        0 AS payment,
        -- Prepagos aquí no aplican
        0 AS prepaid,
        -- Campos de banco (no aplican en facturas => NULL)
        NULL AS idbanco,
        NULL AS costo_bancario,
        NULL AS numero_comprobante,
        -- 👇 SI es editable (lo creas manualmente)
        CASE WHEN fc.tipoDocumento = 'SI' THEN 1 ELSE 0 END AS editable
      FROM factura_consolidada fc
      JOIN terceros t ON t.idtercero = fc.idcliente
      WHERE fc.tipoMovimiento = ?
        AND fc.idcliente IN ( ${ids.map(() => '?').join(',')} )
        AND fc.fecha BETWEEN ? AND ?
        AND fc.estado <> 'proceso'
      `,
      [tipoMovimiento, ...ids, desde, hasta]
    );

    // 2) Pagos — PG / PP / NC / RT / ND clasificados por columna
    const [rowsPagos] = await db.query(
      `
      SELECT
        p.idpago         AS id,
        p.tipoDocumento  AS tipo,          -- PG, PP, NC, RT, ND
        p.fecha          AS fecha,
        ''               AS numero,
        p.observaciones  AS obs,
        t.nombre         AS mark,

        CASE WHEN p.tipoDocumento = 'ND'            THEN p.valor ELSE 0 END AS amount,
        CASE WHEN p.tipoDocumento IN ('NC','RT')    THEN p.valor ELSE 0 END AS credits,
        CASE WHEN p.tipoDocumento = 'PG'            THEN p.valor ELSE 0 END AS payment,

        -- Prepagos: mostrar el remanente (valor - aplicado)
        CASE WHEN p.tipoDocumento = 'PP'
             THEN p.valor - COALESCE(SUM(pf.valorpago), 0)
             ELSE 0
        END AS prepaid,

        -- Campos de banco (para PG/PP tendrán datos; ND/NC/RT quedarán como vengan)
        p.idbanco              AS idbanco,
        p.costo_bancario       AS costo_bancario,
        p.numero_comprobante   AS numero_comprobante,

        1 AS editable
      FROM pagos p
      JOIN terceros t ON t.idtercero = p.idtercero
      LEFT JOIN pagos_factura pf ON pf.idpago = p.idpago
      WHERE p.tipoMovimiento = ?
        AND p.idtercero IN ( ${ids.map(() => '?').join(',')} )
        AND p.fecha BETWEEN ? AND ?
      GROUP BY
        p.idpago,
        p.tipoDocumento,
        p.fecha,
        p.observaciones,
        t.nombre,
        p.valor,
        p.idbanco,
        p.costo_bancario,
        p.numero_comprobante
      `,
      [tipoMovimiento, ...ids, desde, hasta]
    );

    // Orden y balance acumulado
    const timeline = [...rowsMov, ...rowsPagos].sort((a, b) => {
      const da = new Date(a.fecha) - new Date(b.fecha);
      if (da !== 0) return da;
      const rank = (t) =>
        t === 'F'
          ? 0
          : t === 'ND'
            ? 1
            : t === 'SI'
              ? 2
              : t === 'NC'
                ? 3
                : t === 'RT'
                  ? 4
                  : t === 'PG'
                    ? 5
                    : 9;
      return rank(a.tipo) - rank(b.tipo);
    });

    let balance = 0;
    const out = timeline.map((r) => {
      balance +=
        Number(r.amount || 0) -
        Number(r.credits || 0) -
        Number(r.payment || 0) -
        Number(r.prepaid || 0);
      return { ...r, balance };
    });

    res.json(out);
  } catch (err) {
    console.error('❌ Error timeline:', err);
    res.status(500).json({ error: 'Error al construir timeline' });
  }
});

/* ------------------------------------------------------------------ */
/* CREAR pago general y asignar facturas                               */
/* ------------------------------------------------------------------ */
router.post('/pago', verificarToken, async (req, res) => {
  const {
    tipoMovimiento,
    idtercero,
    fecha,
    observaciones,
    detalles = [],
    idbanco,
    costo_bancario,
    numero_comprobante
  } = req.body;

  if (!tipoMovimiento || !['C', 'P'].includes(tipoMovimiento)) {
    return res.status(400).json({ error: 'tipoMovimiento inválido' });
  }
  if (!idtercero || !fecha || detalles.length === 0) {
    return res.status(400).json({ error: 'Datos incompletos o sin facturas' });
  }

  const total = detalles.reduce((sum, f) => sum + parseFloat(f.valorpago || 0), 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [resPago] = await conn.query(
      `
      INSERT INTO pagos (
        tipoMovimiento,
        idtercero,
        fecha,
        valor,
        observaciones,
        idbanco,
        costo_bancario,
        numero_comprobante
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        tipoMovimiento,
        idtercero,
        fecha,
        total,
        observaciones || '',
        idbanco || null,
        costo_bancario != null && costo_bancario !== '' ? Number(costo_bancario) : null,
        numero_comprobante || null
      ]
    );
    const idpago = resPago.insertId;

    for (const f of detalles) {
      await conn.query(
        `INSERT INTO pagos_factura (idpago, idfactura, valorpago)
         VALUES (?, ?, ?)`,
        [idpago, f.idfactura, f.valorpago]
      );
    }

    await conn.commit();
    res.json({ success: true, idpago });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error al guardar pago:', err);
    res.status(500).json({ error: 'Error al guardar el pago' });
  } finally {
    conn.release();
  }
});

/* ------------------------------------------------------------------ */
/* EDITAR / ELIMINAR pago general (del modal)                         */
/* ------------------------------------------------------------------ */
router.put('/pago/:idpago', verificarToken, async (req, res) => {
  const { idpago } = req.params;
  const {
    fecha,
    observaciones,
    tipoDocumento,
    valorTotal,
    idbanco,
    costo_bancario,
    numero_comprobante
  } = req.body;

  if (!idpago) return res.status(400).json({ error: 'idpago requerido' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Actualizar tabla pagos (solo campos provistos)
    const sets = [];
    const vals = [];

    if (fecha) {
      sets.push('fecha = ?');
      vals.push(fecha);
    }
    if (observaciones !== undefined) {
      sets.push('observaciones = ?');
      vals.push(observaciones);
    }
    if (tipoDocumento) {
      sets.push('tipoDocumento = ?');
      vals.push(String(tipoDocumento).toUpperCase());
    }
    if (valorTotal != null) {
      sets.push('valor = ?');
      vals.push(Number(valorTotal));
    }

    // 👇 nuevos campos banco / costo / comprobante
    if (idbanco !== undefined) {
      sets.push('idbanco = ?');
      vals.push(idbanco || null);
    }
    if (costo_bancario !== undefined) {
      sets.push('costo_bancario = ?');
      vals.push(costo_bancario != null && costo_bancario !== '' ? Number(costo_bancario) : null);
    }
    if (numero_comprobante !== undefined) {
      sets.push('numero_comprobante = ?');
      vals.push(numero_comprobante || null);
    }

    if (sets.length) {
      await conn.query(`UPDATE pagos SET ${sets.join(', ')} WHERE idpago = ?`, [...vals, idpago]);
    }

    // 2) Si hay nuevo total, redistribuir pagos_factura del mismo idpago
    if (valorTotal != null) {
      const nuevoTotal = Number(valorTotal);

      const [links] = await conn.query(
        `SELECT id, idfactura, valorpago
           FROM pagos_factura
          WHERE idpago = ?
          ORDER BY id ASC`,
        [idpago]
      );

      // Sin filas (p.ej. SI) => nada que tocar
      if (links.length === 1) {
        // Un solo renglón: setear directo
        await conn.query(`UPDATE pagos_factura SET valorpago = ? WHERE id = ?`, [
          nuevoTotal,
          links[0].id
        ]);
      } else if (links.length > 1) {
        const oldSum = links.reduce((s, r) => s + Number(r.valorpago || 0), 0);
        // Si oldSum es 0, repartir equitativamente
        if (oldSum === 0) {
          const base = +(nuevoTotal / links.length).toFixed(2);
          let acumulado = base * (links.length - 1);
          for (let i = 0; i < links.length; i++) {
            const val = i === links.length - 1 ? +(nuevoTotal - acumulado).toFixed(2) : base;
            await conn.query(`UPDATE pagos_factura SET valorpago = ? WHERE id = ?`, [
              val,
              links[i].id
            ]);
          }
        } else {
          const factor = nuevoTotal / oldSum;
          let sumaParcial = 0;

          for (let i = 0; i < links.length; i++) {
            let val;
            if (i === links.length - 1) {
              // último = total - (suma de anteriores) para corregir redondeo
              val = +(nuevoTotal - sumaParcial).toFixed(2);
            } else {
              val = +(Number(links[i].valorpago) * factor).toFixed(2);
              sumaParcial += val;
            }
            await conn.query(`UPDATE pagos_factura SET valorpago = ? WHERE id = ?`, [
              val,
              links[i].id
            ]);
          }
        }
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error actualizando pago/distribución:', err);
    res.status(500).json({ error: 'Error al actualizar pago' });
  } finally {
    conn.release();
  }
});

// Eliminar pago (borra pagos_factura y pagos)
router.delete('/pago/:idpago', verificarToken, async (req, res) => {
  const { idpago } = req.params;
  if (!idpago) return res.status(400).json({ error: 'idpago requerido' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM pagos_factura WHERE idpago = ?`, [idpago]);
    await conn.query(`DELETE FROM pagos WHERE idpago = ?`, [idpago]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error eliminando pago:', err);
    res.status(500).json({ error: 'Error al eliminar pago' });
  } finally {
    conn.release();
  }
});

/* ------------------------------------------------------------------ */
/* ELIMINAR movimiento en factura_consolidada (tu lógica previa)      */
/* ------------------------------------------------------------------ */
router.delete('/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'ID requerido' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT tipoDocumento, idpago FROM factura_consolidada WHERE id = ?`,
      [id]
    );
    if (!rows.length) throw new Error('Movimiento no encontrado.');

    const { tipoDocumento, idpago } = rows[0];

    if (tipoDocumento === 'Pago' && idpago != null) {
      await conn.query(`DELETE FROM pagos_factura WHERE idpago = ?`, [idpago]);
      await conn.query(`DELETE FROM pagos WHERE idpago = ?`, [idpago]);
    }

    await conn.query(`DELETE FROM factura_consolidada WHERE id = ?`, [id]);

    await conn.commit();
    res.json({ success: true, message: '✅ Movimiento eliminado.' });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error al eliminar movimiento:', err);
    res.status(500).json({ error: err.message || 'Error al eliminar movimiento' });
  } finally {
    conn.release();
  }
});

/* ------------------------------------------------------------------ */
/* REGISTRAR pago completo                                            */
/* ------------------------------------------------------------------ */
router.post('/pago-completo', verificarToken, async (req, res) => {
  const {
    tipoMovimiento, // 'C' | 'P'
    tipoDocumento, // 'PG' | 'ND' | 'RT' | 'SI'
    idtercero,
    fecha,
    valorTotal,
    observaciones,
    facturas = [], // [{ idfactura, valorpago }]
    numero_factura, // ← obligatorio para SI
    idbanco,
    costo_bancario,
    numero_comprobante
  } = req.body;

  if (!tipoMovimiento || !tipoDocumento || !idtercero || !fecha) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ====== SALDO INICIAL (SI) ======
    if (String(tipoDocumento).toUpperCase() === 'SI') {
      if (!(Number(valorTotal) > 0)) {
        await conn.rollback();
        return res.status(400).json({ error: 'El valor para Saldo Inicial debe ser mayor a 0.' });
      }
      if (!numero_factura || !String(numero_factura).trim()) {
        await conn.rollback();
        return res
          .status(400)
          .json({ error: 'Número de factura es obligatorio para Saldo Inicial.' });
      }

      // idcliente_padre para reportes/jerarquía
      const [[t]] = await conn.query('SELECT idcliente_padre FROM terceros WHERE idtercero = ?', [
        idtercero
      ]);
      const idcliente_padre = t?.idcliente_padre ?? idtercero;

      // Registramos el SI como movimiento en factura_consolidada
      const [ins] = await conn.query(
        `
        INSERT INTO factura_consolidada
          (tipoMovimiento, tipoDocumento, idcliente, idcliente_padre, fecha, numero_factura, valorTotal, estado, observaciones)
        VALUES (?, 'SI', ?, ?, ?, ?, ?, 'completo', ?)
        `,
        [
          String(tipoMovimiento).toUpperCase(),
          idtercero,
          idcliente_padre,
          fecha,
          String(numero_factura).trim(),
          Number(valorTotal),
          observaciones || null
        ]
      );

      await conn.commit();
      return res.json({ success: true, id: ins.insertId });
    }

    // ====== PG / ND / RT (requieren facturas) ======
    if (!Array.isArray(facturas) || facturas.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Datos incompletos para guardar el pago' });
    }

    const total = facturas.reduce((s, f) => s + Number(f.valorpago || 0), 0);
    const valor = valorTotal != null ? Number(valorTotal) : total;

    const [result] = await conn.query(
      `
      INSERT INTO pagos (
        tipoMovimiento,
        tipoDocumento,
        idtercero,
        fecha,
        valor,
        observaciones,
        idbanco,
        costo_bancario,
        numero_comprobante
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        String(tipoMovimiento).toUpperCase(),
        String(tipoDocumento).toUpperCase(),
        idtercero,
        fecha,
        valor,
        observaciones || '',
        // Solo vendrán con datos reales cuando sea PG; para ND/RT quedan en NULL
        idbanco || null,
        costo_bancario != null && costo_bancario !== '' ? Number(costo_bancario) : null,
        numero_comprobante || null
      ]
    );
    const idpago = result.insertId;

    for (const { idfactura, valorpago } of facturas) {
      if (!idfactura || !(Number(valorpago) > 0)) continue;
      await conn.query(
        `INSERT INTO pagos_factura (idpago, idfactura, valorpago)
         VALUES (?, ?, ?)`,
        [idpago, Number(idfactura), Number(valorpago)]
      );
    }

    await conn.commit();
    res.json({ success: true, idpago });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error al registrar pago completo:', err);
    res.status(500).json({ error: 'Error al registrar pago' });
  } finally {
    conn.release();
  }
});

/* ------------------------------------------------------------------ */
/* ESTADO DE CUENTA (JSON para PDF / correo)                          */
/* ------------------------------------------------------------------ */
// ⚠️ IMPORTANTE: Evitar duplicar la misma ruta. Dejamos una sola variante JSON
router.get('/estado-cuenta/:tipo/:idtercero', async (req, res) => {
  const { tipo, idtercero } = req.params;
  const { desde, hasta } = req.query;

  if (!['C', 'P'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido (C o P)' });
  }

  try {
    let where = `tipoMovimiento = ? AND idtercero = ?`;
    const valores = [tipo, idtercero];

    if (desde && hasta) {
      where += ` AND fecha BETWEEN ? AND ?`;
      valores.push(desde, hasta);
    }

    const [rows] = await db.query(
      `SELECT idfactura AS id,
              fecha, tipoDocumento AS tipo, numeroDocumento AS numero,
              valor, movimiento, saldo, acumulado, observaciones
         FROM vista_estado_cuenta
        WHERE ${where}
        ORDER BY fecha ASC, idfactura ASC`,
      valores
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Error al consultar estado de cuenta:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/estado-cuenta/pdf', async (req, res) => {
  const { idtercero, tipoMovimiento, desde, hasta } = req.query;

  if (!idtercero || !tipoMovimiento || !desde || !hasta) {
    return res
      .status(400)
      .json({ error: 'Parámetros requeridos: idtercero, tipoMovimiento, desde, hasta' });
  }

  try {
    await generarEstadoCuentaPDFStream({
      idtercero: Number(idtercero),
      tipoMovimiento: String(tipoMovimiento).toUpperCase(), // 'C' | 'P'
      fechaInicio: desde,
      fechaFin: hasta,
      res
    });
  } catch (error) {
    console.error('❌ Error al generar PDF de estado de cuenta:', error);
    res.status(500).send('Error generando PDF');
  }
});

router.post('/estado-cuenta/enviar', async (req, res) => {
  const { idtercero, tipoMovimiento, desde, hasta } = req.body;

  if (!idtercero || !tipoMovimiento || !desde || !hasta) {
    return res
      .status(400)
      .json({ error: 'Parámetros requeridos: idtercero, tipoMovimiento, desde, hasta' });
  }

  try {
    const [rows] = await db.query(
      `SELECT * FROM vista_estado_cuenta
        WHERE idtercero = ? AND tipoMovimiento = ? AND fecha BETWEEN ? AND ?
        ORDER BY fecha, idfactura`,
      [idtercero, tipoMovimiento, desde, hasta]
    );

    if (!rows.length) return res.status(404).send('No hay movimientos en ese rango');

    const nombreTercero = rows[0].terceroNombre || 'Tercero';
    const rango = `${desde} a ${hasta}`;

    const [[ter]] = await db.query(`SELECT correo FROM terceros WHERE idtercero = ? LIMIT 1`, [
      idtercero
    ]);
    if (!ter || !ter.correo) {
      return res.status(400).send('Tercero sin correo configurado');
    }

    const pdfBuffer = await generarEstadoCuentaPDFBuffer(
      rows,
      nombreTercero,
      tipoMovimiento,
      rango
    );

    await enviarCorreoEstadoCuenta(ter.correo, pdfBuffer, nombreTercero, rango);

    res.send('Correo enviado correctamente');
  } catch (err) {
    console.error('❌ Error enviando estado de cuenta:', err);
    res.status(500).send('Error interno al enviar estado de cuenta');
  }
});

// GET /api/cartera/estado-cuenta-pendiente/pdf?idtercero=XXX&tipoMovimiento=C&corte=YYYY-MM-DD
router.get('/estado-cuenta-pendiente/pdf', async (req, res) => {
  const { idtercero, tipoMovimiento, corte } = req.query;

  if (!idtercero || !tipoMovimiento) {
    return res.status(400).json({ error: 'Parámetros requeridos: idtercero y tipoMovimiento' });
  }

  const fechaCorte = corte || new Date().toISOString().slice(0, 10);

  try {
    await generarEstadoCuentaPendientePDFStream({
      idtercero: Number(idtercero),
      tipoMovimiento: String(tipoMovimiento).toUpperCase(), // 'C' | 'P'
      fechaFin: fechaCorte,
      res
    });
  } catch (error) {
    console.error('❌ Error al generar PDF de pendientes:', error);
    res.status(500).send('Error generando PDF de pendientes');
  }
});

// POST /api/cartera/estado-cuenta-pendiente/enviar
// body: { idtercero, tipoMovimiento, corte? }
router.post('/estado-cuenta-pendiente/enviar', async (req, res) => {
  const { idtercero, tipoMovimiento, corte } = req.body;

  if (!idtercero || !tipoMovimiento) {
    return res.status(400).json({ error: 'Parámetros requeridos: idtercero y tipoMovimiento' });
  }

  const fechaCorte = corte || new Date().toISOString().slice(0, 10);

  try {
    // Solo usamos la vista para obtener nombre/id; el cálculo de pendientes lo hace el util en base a tablas
    const [rows] = await db.query(
      `SELECT * FROM vista_estado_cuenta
        WHERE idtercero = ? AND tipoMovimiento = ? AND fecha <= ?
        ORDER BY fecha, idfactura`,
      [idtercero, tipoMovimiento, fechaCorte]
    );

    if (!rows.length) return res.status(404).send('No hay movimientos para este tercero');

    const nombreTercero = rows[0].terceroNombre || 'Tercero';

    const [[ter]] = await db.query(`SELECT correo FROM terceros WHERE idtercero = ? LIMIT 1`, [
      idtercero
    ]);
    if (!ter || !ter.correo) {
      return res.status(400).send('Tercero sin correo configurado');
    }

    const pdfBuffer = await generarEstadoCuentaPendientePDFBuffer(
      rows,
      nombreTercero,
      tipoMovimiento,
      fechaCorte
    );

    await enviarCorreoEstadoCuenta(
      ter.correo,
      pdfBuffer,
      nombreTercero,
      `Pendientes al ${fechaCorte}`
    );

    res.send('Correo enviado correctamente');
  } catch (err) {
    console.error('❌ Error enviando estado de cuenta pendientes:', err);
    res.status(500).send('Error interno al enviar estado de cuenta pendientes');
  }
});

// GET /api/cartera/prepagos?tipoMovimiento=C&idtercero=XXX
router.get('/prepagos', async (req, res) => {
  const { tipoMovimiento, idtercero } = req.query;
  if (!tipoMovimiento || !['C', 'P'].includes(tipoMovimiento) || !idtercero) {
    return res.status(400).json({ error: 'tipoMovimiento (C/P) e idtercero son requeridos' });
  }
  try {
    const [rows] = await db.query(
      `
      SELECT p.idpago,
             p.fecha,
             p.valor,
             p.observaciones,
             COALESCE(p.valor - SUM(pf.valorpago), p.valor) AS restante
      FROM pagos p
      LEFT JOIN pagos_factura pf ON pf.idpago = p.idpago
      WHERE p.tipoMovimiento = ?
        AND p.idtercero = ?
        AND p.tipoDocumento = 'PP'
      GROUP BY p.idpago
      HAVING restante > 0
      ORDER BY p.fecha, p.idpago
      `,
      [tipoMovimiento, idtercero]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Error al listar prepagos' });
  }
});

// PUT /api/cartera/pago/:idpago/aplicar
// body: { facturas:[{idfactura, valorpago}], fechaAplicacion?, observaciones? }
router.put('/pago/:idpago/aplicar', verificarToken, async (req, res) => {
  const { idpago } = req.params;
  const { facturas = [], fechaAplicacion, observaciones } = req.body;
  if (!idpago || !Array.isArray(facturas) || facturas.length === 0) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Traer tipoMovimiento e idtercero del PP
    const [[pp]] = await conn.query(
      `SELECT tipoMovimiento, idtercero, (valor - COALESCE(SUM(pf.valorpago),0)) AS restante
       FROM pagos p LEFT JOIN pagos_factura pf ON pf.idpago = p.idpago
       WHERE p.idpago = ? GROUP BY p.idpago`,
      [idpago]
    );
    if (!pp) throw new Error('Prepago no encontrado');

    const aAplicar = facturas.reduce((s, f) => s + Number(f.valorpago || 0), 0);
    if (aAplicar <= 0) throw new Error('Nada que aplicar');
    if (aAplicar > Number(pp.restante || 0))
      throw new Error('El valor supera el saldo del prepago');

    // 1) Movimiento PG en `pagos`
    const fechaPG = fechaAplicacion || new Date().toISOString().slice(0, 10);
    const obsPG = `${observaciones ? `${observaciones} — ` : ''}Aplicación prepago #${idpago}: ${aAplicar.toFixed(2)}`;
    const [rMov] = await conn.query(
      `INSERT INTO pagos (tipoMovimiento, tipoDocumento, idtercero, fecha, valor, observaciones)
       VALUES (?, 'PG', ?, ?, ?, ?)`,
      [pp.tipoMovimiento, pp.idtercero, fechaPG, aAplicar, obsPG]
    );

    // 2) Cruces contra el PP
    for (const f of facturas) {
      await conn.query(
        `INSERT INTO pagos_factura (idpago, idfactura, valorpago) VALUES (?, ?, ?)`,
        [idpago, f.idfactura, f.valorpago]
      );
    }

    await conn.commit();
    res.json({ success: true, idpagoMovimiento: rMov.insertId });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error aplicando prepago:', err);
    res.status(400).json({ error: err.message || 'Error aplicando prepago' });
  } finally {
    conn.release();
  }
});

// PUT /api/cartera/prepagos/aplicar
// body: { tipoMovimiento, idtercero, fechaAplicacion?, observaciones?, prepagos:[{idpago, usarHasta?}], facturas:[{idfactura, valorpago}] }
router.put('/prepagos/aplicar', verificarToken, async (req, res) => {
  const {
    tipoMovimiento,
    idtercero,
    prepagos = [],
    facturas = [],
    fechaAplicacion,
    observaciones
  } = req.body;

  if (!tipoMovimiento || !['C', 'P'].includes(tipoMovimiento)) {
    return res.status(400).json({ error: 'tipoMovimiento inválido' });
  }
  if (
    !idtercero ||
    !Array.isArray(prepagos) ||
    !prepagos.length ||
    !Array.isArray(facturas) ||
    !facturas.length
  ) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // === (igual que antes) calcular saldos de facturas/prepagos y armar inserts ===
    const idsFact = facturas.map((f) => Number(f.idfactura)).filter(Boolean);
    const [rowsFac] = await conn.query(
      `
      SELECT fc.id, (fc.valorTotal - COALESCE(SUM(pf.valorpago),0)) AS saldo
      FROM factura_consolidada fc
      LEFT JOIN pagos_factura pf ON pf.idfactura = fc.id
      WHERE fc.id IN (${idsFact.map(() => '?').join(',')})
      GROUP BY fc.id
      FOR UPDATE
    `,
      idsFact
    );
    const saldoFactura = Object.fromEntries(
      rowsFac.map((r) => [Number(r.id), Number(r.saldo || 0)])
    );

    const idsPrep = prepagos.map((p) => Number(p.idpago)).filter(Boolean);
    const [rowsPrep] = await conn.query(
      `
      SELECT p.idpago, (p.valor - COALESCE(SUM(pf.valorpago),0)) AS restante
      FROM pagos p
      LEFT JOIN pagos_factura pf ON pf.idpago = p.idpago
      WHERE p.idpago IN (${idsPrep.map(() => '?').join(',')})
      GROUP BY p.idpago
      FOR UPDATE
    `,
      idsPrep
    );
    const saldoPrepago = Object.fromEntries(
      rowsPrep.map((r) => [Number(r.idpago), Math.max(0, Number(r.restante || 0))])
    );

    const totalFacturas = facturas.reduce((s, f) => s + Number(f.valorpago || 0), 0);
    const totalPrepagosCap = prepagos.reduce((s, p) => {
      const cap = p.usarHasta != null ? Number(p.usarHasta) : Infinity;
      return s + Math.min(saldoPrepago[p.idpago] || 0, cap);
    }, 0);
    if (totalPrepagosCap <= 0) throw new Error('Prepagos sin saldo');
    if (totalFacturas <= 0) throw new Error('Montos de facturas inválidos');
    if (totalPrepagosCap + 1e-6 < totalFacturas)
      throw new Error('Fondos de prepagos insuficientes');

    // Greedy asignación
    const facPend = facturas.map((f) => ({
      id: Number(f.idfactura),
      porAplicar: Math.min(Number(f.valorpago || 0), saldoFactura[Number(f.idfactura)] || 0)
    }));
    const prepDisp = prepagos.map((p) => ({
      id: Number(p.idpago),
      saldo: Math.min(
        saldoPrepago[Number(p.idpago)] || 0,
        p.usarHasta != null ? Number(p.usarHasta) : Infinity
      )
    }));
    const inserts = []; // [idpagoPP, idfactura, valor]
    for (const prep of prepDisp) {
      if (prep.saldo <= 0) continue;
      for (const fac of facPend) {
        if (fac.porAplicar <= 0) continue;
        const usar = Math.min(prep.saldo, fac.porAplicar);
        if (usar <= 0) continue;
        inserts.push([prep.id, fac.id, usar]);
        prep.saldo -= usar;
        fac.porAplicar -= usar;
        if (prep.saldo <= 0) break;
      }
    }

    // 1) Registrar el MOVIMIENTO (pago) en `pagos` como PG
    const totalAplicado = inserts.reduce((s, [, , v]) => s + Number(v), 0);
    const porPrepago = {};
    for (const [idpago, , v] of inserts) porPrepago[idpago] = (porPrepago[idpago] || 0) + Number(v);
    const resumen = Object.entries(porPrepago)
      .map(([id, v]) => `#${id}:${v.toFixed(2)}`)
      .join(', ');
    const fechaPG = fechaAplicacion || new Date().toISOString().slice(0, 10);
    const obsPG = `${observaciones ? `${observaciones} — ` : ''}Aplicación de prepagos ${resumen}`;

    const [rMov] = await conn.query(
      `INSERT INTO pagos (tipoMovimiento, tipoDocumento, idtercero, fecha, valor, observaciones)
       VALUES (?, 'PG', ?, ?, ?, ?)`,
      [tipoMovimiento, idtercero, fechaPG, totalAplicado, obsPG]
    );
    const idpagoMovimiento = rMov.insertId;

    // 2) Insertar los cruces en `pagos_factura` contra el PP (esto descuenta el saldo del anticipo)
    for (const [idpago, idfactura, valorpago] of inserts) {
      await conn.query(
        `INSERT INTO pagos_factura (idpago, idfactura, valorpago) VALUES (?, ?, ?)`,
        [idpago, idfactura, valorpago]
      );
    }

    await conn.commit();
    res.json({ success: true, aplicado: totalAplicado, idpagoMovimiento });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message || 'Error aplicando prepagos' });
  } finally {
    conn.release();
  }
});

// POST /api/cartera/pago-prepago
router.post('/pago-prepago', verificarToken, async (req, res) => {
  const {
    tipoMovimiento,
    idtercero,
    fecha,
    valorTotal,
    observaciones,
    facturas = [],
    idbanco,
    costo_bancario,
    numero_comprobante
  } = req.body;

  if (!tipoMovimiento || !['C', 'P'].includes(tipoMovimiento)) {
    return res.status(400).json({ error: 'tipoMovimiento inválido' });
  }
  if (!idtercero || !fecha || !valorTotal) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Crear el prepago (PP)
    const [r] = await conn.query(
      `INSERT INTO pagos (
         tipoMovimiento,
         tipoDocumento,
         idtercero,
         fecha,
         valor,
         observaciones,
         idbanco,
         costo_bancario,
         numero_comprobante
       )
       VALUES (?, 'PP', ?, ?, ?, ?, ?, ?, ?)`,
      [
        tipoMovimiento,
        idtercero,
        fecha,
        Number(valorTotal),
        observaciones || '',
        idbanco || null,
        costo_bancario != null && costo_bancario !== '' ? Number(costo_bancario) : null,
        numero_comprobante || null
      ]
    );

    const idpago = r.insertId;

    // 2) Si vienen facturas, validarlas y aplicar de una vez
    if (Array.isArray(facturas) && facturas.length) {
      const aAplicar = facturas.reduce((s, f) => s + Number(f.valorpago || 0), 0);
      if (aAplicar <= 0) throw new Error('Montos de aplicación inválidos');
      if (aAplicar - Number(valorTotal) > 1e-6) {
        throw new Error('Aplicación mayor al prepago');
      }

      for (const f of facturas) {
        if (!f.idfactura || !(Number(f.valorpago) > 0)) {
          throw new Error('Factura/valor inválidos en la aplicación');
        }
      }

      // (opcional) validar saldo de cada factura aquí con un SELECT … FOR UPDATE

      for (const { idfactura, valorpago } of facturas) {
        await conn.query(
          `INSERT INTO pagos_factura (idpago, idfactura, valorpago)
           VALUES (?, ?, ?)`,
          [idpago, Number(idfactura), Number(valorpago)]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, idpago });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error creando/aplicando prepago:', err);
    res.status(500).json({ error: err.message || 'Error creando prepago' });
  } finally {
    conn.release();
  }
});

// POST /api/cartera/pago-completo-nc  (NC con detalle + fotos por línea o por proveedor)
// ===================================================================
router.post('/pago-completo-nc', upload.any(), async (req, res) => {
  const path = require('path');
  let payload = null;

  // 0) Parseo de payload (soporta JSON y multipart/form-data con 'payload')
  try {
    if (req.is('application/json')) {
      payload = req.body || {};
    } else {
      payload = JSON.parse(req.body?.payload || '{}');
    }
  } catch {
    return res.status(400).json({ error: 'payload inválido' });
  }

  const {
    tipoMovimiento, // 'C' (cliente) | 'P' (proveedor) — actor principal
    tipoDocumento, // debe ser 'NC'
    idtercero, // id del actor principal
    fecha,
    valorTotal, // = credito_items + flete + otros (en Cliente)
    observaciones,
    facturas = [], // [{ idfactura, valorpago }]
    // detalle por línea de consolidada (puede venir proveedor_id y documento_proveedor)
    detalle_nc = [], // [{ iddetalle, proveedor_id, monto, producto, variedad, longitud, motivo, documento_proveedor, tallos_reclamo }]

    // ===== NUEVOS CAMPOS (solo para Cliente) =====
    flete = 0,
    otros = 0,
    credito_items = 0
  } = payload || {};

  if (tipoDocumento !== 'NC') return res.status(400).json({ error: 'tipoDocumento debe ser NC' });
  if (!idtercero || !fecha)
    return res.status(400).json({ error: 'idtercero y fecha son obligatorios' });

  // 1) Preparar mapeo de fotos
  //    a) fotos por línea:      fotos_<iddetalle>[]
  //    b) fotos por proveedor:  fotos_proveedor_<proveedorId>[]
  const filesByDetalle = {}; // { iddetalle: [ { pathRel, original, mimetype, size } ] }
  const filesByProveedor = {}; // { proveedorId: [ { ... } ] }

  for (const f of req.files || []) {
    const name = String(f.fieldname || '');
    // por línea
    let m = /^fotos_(\d+)(?:\[\])?$/.exec(name);
    if (m) {
      const idd = Number(m[1]);
      (filesByDetalle[idd] ||= []).push({
        pathRel: `/uploads/nc/${path.basename(f.path)}`,
        original: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      });
      continue;
    }
    // por proveedor
    m = /^fotos_proveedor_(\d+)(?:\[\])?$/.exec(name);
    if (m) {
      const provId = Number(m[1]);
      (filesByProveedor[provId] ||= []).push({
        pathRel: `/uploads/nc/${path.basename(f.path)}`,
        original: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      });
      continue;
    }
  }

  // 2) Conexión y tx
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ========== 2.1) Resolver proveedor e idfactura del PROVEEDOR por cada iddetalle ==========
    const idsDetalle = [
      ...new Set((detalle_nc || []).map((d) => Number(d.iddetalle)).filter(Boolean))
    ];

    const mapDet = {}; // iddetalle -> { proveedor_id, doc_prov, idfactura_prov }
    if (idsDetalle.length) {
      const [rowsDet] = await conn.query(
        `
        SELECT
          d.iddetalle,
          d.idproveedor AS proveedor_id,
          TRIM(COALESCE(d.documento_proveedor, '')) AS doc_prov,
          fp.id AS idfactura_prov
        FROM factura_consolidada_detalle d
        LEFT JOIN factura_consolidada fp
          ON (fp.tipoMovimiento COLLATE utf8mb4_general_ci) = ('P' COLLATE utf8mb4_general_ci)
         AND fp.Idcliente = d.idproveedor
         AND (fp.numero_factura   COLLATE utf8mb4_general_ci)
             = (d.documento_proveedor COLLATE utf8mb4_general_ci)
         AND (fp.estado COLLATE utf8mb4_general_ci) <> ('proceso' COLLATE utf8mb4_general_ci)
        WHERE d.iddetalle IN (?)
        `,
        [idsDetalle]
      );
      for (const r of rowsDet) {
        mapDet[Number(r.iddetalle)] = {
          proveedor_id: Number(r.proveedor_id || 0),
          doc_prov: r.doc_prov || '',
          idfactura_prov: r.idfactura_prov ? Number(r.idfactura_prov) : null
        };
      }
    }

    // ========== 2.2) Insertar la NC del actor principal ==========
    const lado = String(tipoMovimiento).toUpperCase() === 'P' ? 'P' : 'C';
    const valorNum = Number(valorTotal || 0);

    let movSql, movParams;
    if (lado === 'C') {
      // Inserta con columnas extra para Cliente (asegúrate de tener estas columnas en pagos)
      // ALTER TABLE pagos ADD COLUMN nc_flete DECIMAL(12,2) NOT NULL DEFAULT 0.00;
      // ALTER TABLE pagos ADD COLUMN nc_otros DECIMAL(12,2) NOT NULL DEFAULT 0.00;
      // ALTER TABLE pagos ADD COLUMN nc_credito_items DECIMAL(12,2) NOT NULL DEFAULT 0.00;
      movSql = `
        INSERT INTO pagos
          (idtercero, tipoMovimiento, fecha, valor, observaciones, tipoDocumento,
           nc_flete, nc_otros, nc_credito_items)
        VALUES (?, 'C', ?, ?, ?, 'NC', ?, ?, ?)
      `;
      movParams = [
        idtercero,
        fecha,
        Number.isFinite(valorNum) ? valorNum : 0,
        observaciones ?? null,
        Number(flete || 0),
        Number(otros || 0),
        Number(credito_items || 0)
      ];
    } else {
      // Proveedor: igual que antes, sin columnas extra
      movSql = `
        INSERT INTO pagos (idtercero, tipoMovimiento, fecha, valor, observaciones, tipoDocumento)
        VALUES (?, 'P', ?, ?, ?, 'NC')
      `;
      movParams = [
        idtercero,
        fecha,
        Number.isFinite(valorNum) ? valorNum : 0,
        observaciones ?? null
      ];
    }

    const [movRes] = await conn.query(movSql, movParams);
    const idpago = movRes.insertId;

    // ========== 2.3) Cruzar con facturas del actor principal (si llegaron) ==========
    for (const f of facturas) {
      if (!f?.idfactura) continue;
      await conn.query(`INSERT INTO pagos_factura (idpago, idfactura, valorpago) VALUES (?,?,?)`, [
        idpago,
        f.idfactura,
        Number(f.valorpago || 0)
      ]);
    }

    // ========== 2.4) Guardar detalle NC y fotos ==========
    // Armar un índice auxiliar: líneas por proveedor (para distribuir fotos_proveedor_*[])
    const lineasPorProveedor = new Map(); // provId -> Set(iddetalle)

    for (const d of detalle_nc) {
      const info = mapDet[d.iddetalle] || {};
      const provId = Number(d.proveedor_id || info.proveedor_id || 0) || null;

      // guardar línea
      const [detRes] = await conn.query(
        `INSERT INTO cartera_nc_detalle
           (idpago, iddetalle_consolidada, proveedor_id, motivo, monto, producto, variedad, longitud, tallos_reclamo)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          idpago,
          d.iddetalle,
          provId,
          d.motivo || null,
          Number(d.monto || 0),
          d.producto || null,
          d.variedad || null,
          d.longitud || null,
          Number(d.tallos_reclamo || 0)
        ]
      );

      const id_nc_det = detRes.insertId;

      // índice por proveedor
      if (provId) {
        if (!lineasPorProveedor.has(provId)) lineasPorProveedor.set(provId, new Set());
        lineasPorProveedor.get(provId).add(Number(d.iddetalle));
      }

      // fotos por línea (fotos_<iddetalle>[])
      for (const f of filesByDetalle[d.iddetalle] || []) {
        await conn.query(
          `INSERT INTO cartera_nc_foto (id_nc_detalle, ruta, nombre_archivo, mimetype, size_bytes)
           VALUES (?,?,?,?,?)`,
          [id_nc_det, f.pathRel, f.original, f.mimetype, f.size]
        );
      }
    }

    // Distribuir fotos por proveedor a cada línea de ese proveedor (si llegaron)
    for (const [provId, files] of Object.entries(filesByProveedor)) {
      const idProv = Number(provId);
      const iddetalles = Array.from(lineasPorProveedor.get(idProv) || []);
      if (!iddetalles.length) continue;

      // buscar los id_nc_detalle recién insertados para esas líneas
      // (1) traemos id_nc_detalle por (idpago, iddetalle_consolidada, proveedor_id)
      const [rowsNc] = await conn.query(
        `
        SELECT cnd.id AS id_nc_detalle, cnd.iddetalle_consolidada
          FROM cartera_nc_detalle cnd
         WHERE cnd.idpago = ?
           AND cnd.proveedor_id <=> ?    -- operador NULL-safe
           AND cnd.iddetalle_consolidada IN (?)
        `,
        [idpago, idProv, iddetalles]
      );

      const idNcByDetalle = new Map();
      for (const r of rowsNc)
        idNcByDetalle.set(Number(r.iddetalle_consolidada), Number(r.id_nc_detalle));

      // insertar cada archivo para cada línea del proveedor
      for (const iddetalle of iddetalles) {
        const id_nc_detalle = idNcByDetalle.get(iddetalle);
        if (!id_nc_detalle) continue;
        for (const f of files) {
          await conn.query(
            `INSERT INTO cartera_nc_foto (id_nc_detalle, ruta, nombre_archivo, mimetype, size_bytes)
             VALUES (?,?,?,?,?)`,
            [id_nc_detalle, f.pathRel, f.original, f.mimetype, f.size]
          );
        }
      }
    }

    // ========== 2.5) Reflejar en PROVEEDORES (solo si la NC nace en Cliente) ==========
    if (lado === 'C' && Array.isArray(detalle_nc) && detalle_nc.length) {
      // Agrupar montos por proveedor + idfactura del proveedor (preferido) / doc_prov (fallback)
      const totPorProv = new Map(); // prov -> total
      const totPorProvFac = new Map(); // `${prov}::${idfac}` -> total
      const totPorProvDoc = new Map(); // `${prov}::DOC::${doc}` -> total

      for (const d of detalle_nc) {
        const info = mapDet[d.iddetalle] || {};
        const prov = Number(d.proveedor_id || info.proveedor_id || 0);
        const idfac = Number(info.idfactura_prov || 0);
        const doc = String(d.documento_proveedor || info.doc_prov || '').trim();
        const mon = Number(d.monto || 0);
        if (!prov || !mon) continue;

        totPorProv.set(prov, (totPorProv.get(prov) || 0) + mon);
        if (idfac) {
          const k = `${prov}::${idfac}`;
          totPorProvFac.set(k, (totPorProvFac.get(k) || 0) + mon);
        } else if (doc) {
          const k = `${prov}::DOC::${doc}`;
          totPorProvDoc.set(k, (totPorProvDoc.get(k) || 0) + mon);
        }
      }

      // Crear pago (NC) por proveedor (lado 'P')
      const idPagoProvMap = new Map(); // prov -> idpago_prov
      for (const [prov, totalProv] of totPorProv.entries()) {
        const [rProv] = await conn.query(
          `INSERT INTO pagos (idtercero, tipoMovimiento, fecha, valor, observaciones, tipoDocumento)
           VALUES (?, 'P', ?, ?, ?, 'NC')`,
          [
            prov,
            fecha,
            Number(totalProv || 0),
            `NC cliente ${idtercero} ref ${idpago}${observaciones ? ' - ' + observaciones : ''}`
          ]
        );
        idPagoProvMap.set(prov, rProv.insertId);
      }

      // Cruzar por idfactura del PROVEEDOR (preferido)
      for (const [key, monto] of totPorProvFac.entries()) {
        const [provStr, idfacStr] = key.split('::');
        const prov = Number(provStr);
        const idfac = Number(idfacStr);
        const idpagoProv = idPagoProvMap.get(prov);
        if (!idpagoProv || !idfac) continue;

        const [[fac]] = await conn.query(
          `
          SELECT fc.id,
                 (fc.valorTotal - COALESCE(SUM(CASE WHEN p.idpago IS NOT NULL THEN pf.valorpago ELSE 0 END),0)) AS saldo
            FROM factura_consolidada fc
            LEFT JOIN pagos_factura pf ON pf.idfactura = fc.id
            LEFT JOIN pagos p
              ON p.idpago = pf.idpago
             AND (p.tipoMovimiento COLLATE utf8mb4_general_ci) = ('P' COLLATE utf8mb4_general_ci)
             AND p.idtercero = fc.Idcliente
           WHERE fc.id = ?
           GROUP BY fc.id
           LIMIT 1
          `,
          [idfac]
        );

        const disponible = Number(fac?.saldo || 0);
        const usar = Math.min(Number(monto || 0), disponible);
        if (usar > 0) {
          await conn.query(
            `INSERT INTO pagos_factura (idpago, idfactura, valorpago) VALUES (?,?,?)`,
            [idpagoProv, idfac, usar]
          );
        }
      }

      // Fallback: buscar por número de documento del PROVEEDOR
      for (const [key, montoDoc] of totPorProvDoc.entries()) {
        const [provStr, , doc] = key.split('::');
        const prov = Number(provStr);
        const idpagoProv = idPagoProvMap.get(prov);
        if (!idpagoProv || !doc) continue;

        const [[fac]] = await conn.query(
          `
          SELECT fc.id,
                 (fc.valorTotal - COALESCE(SUM(CASE WHEN p.idpago IS NOT NULL THEN pf.valorpago ELSE 0 END),0)) AS saldo
            FROM factura_consolidada fc
            LEFT JOIN pagos_factura pf ON pf.idfactura = fc.id
            LEFT JOIN pagos p
              ON p.idpago = pf.idpago
             AND (p.tipoMovimiento COLLATE utf8mb4_general_ci) = ('P' COLLATE utf8mb4_general_ci)
             AND p.idtercero = fc.Idcliente
           WHERE (fc.tipoMovimiento COLLATE utf8mb4_general_ci) = ('P' COLLATE utf8mb4_general_ci)
             AND fc.Idcliente = ?
             AND (fc.numero_factura COLLATE utf8mb4_general_ci) = (? COLLATE utf8mb4_general_ci)
             AND (fc.estado COLLATE utf8mb4_general_ci) <> ('proceso' COLLATE utf8mb4_general_ci)
           GROUP BY fc.id
           LIMIT 1
          `,
          [prov, doc]
        );

        const disponible = Number(fac?.saldo || 0);
        const usar = Math.min(Number(montoDoc || 0), disponible);
        if (fac?.id && usar > 0) {
          await conn.query(
            `INSERT INTO pagos_factura (idpago, idfactura, valorpago) VALUES (?,?,?)`,
            [idpagoProv, fac.id, usar]
          );
        }
      }
    }

    await conn.commit();
    res.json({ ok: true, idpago });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Error guardando NC con detalle' });
  } finally {
    conn.release();
  }
});

// =====================================================
// GET /api/cartera/reporte-nc/:idpago
// =====================================================
router.get('/reporte-nc/:idpago', async (req, res) => {
  const idpagoParam = Number(req.params.idpago || 0);
  const idpagoProv = Number(req.query.idpago_prov || 0) || null;
  const idBase = idpagoProv || idpagoParam;

  const proveedorId = req.query.proveedor_id ? Number(req.query.proveedor_id) : null;

  const lado = (req.query.lado || 'C').toString().toUpperCase(); // 'C' o 'P'

  if (!idBase) {
    return res.status(400).json({ error: 'idpago requerido' });
  }

  try {
    await generarNotaCreditoPDFStream({
      idpago: idBase,
      proveedorId,
      lado,
      res
    });
  } catch (e) {
    console.error('PDF NC error:', e?.message, e?.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo generar el PDF' });
    }
  }
});

// =====================================================
// POST /api/cartera/reporte-nc/:idpago/enviar
// =====================================================
router.post('/reporte-nc/:idpago/enviar', async (req, res) => {
  const idpagoCliente = Number(req.params.idpago || 0);
  const target = String(req.query.target || 'cliente').toLowerCase(); // 'cliente' | 'proveedores'
  const proveedorId = req.query.proveedor_id ? Number(req.query.proveedor_id) : null;

  if (!idpagoCliente) {
    return res.status(400).json({ error: 'idpago requerido' });
  }

  try {
    // ========== ENVÍO AL CLIENTE ==========
    if (target === 'cliente') {
      const pdf = await generarNotaCreditoPDFBuffer({
        idpago: idpagoCliente,
        proveedorId: null,
        lado: 'C'
      });

      const [[rowMail]] = await db.query(
        `SELECT COALESCE(t.correo, t.email) AS correo, t.nombre
           FROM pagos p
           JOIN terceros t ON t.idtercero = p.idtercero
          WHERE p.idpago = ?
          LIMIT 1`,
        [idpagoCliente]
      );

      if (!rowMail?.correo) {
        return res.status(400).json({ error: 'El cliente no tiene correo registrado' });
      }

      await enviarCorreoNC(rowMail.correo, pdf, rowMail.nombre, idpagoCliente, 'Cliente');

      return res.json({ ok: true, enviados: 1, scope: 'cliente' });
    }

    // ========== ENVÍO A PROVEEDORES ==========
    if (target === 'proveedores') {
      const provs = proveedorId
        ? [{ proveedor_id: proveedorId }]
        : (
            await db.query(
              `SELECT DISTINCT proveedor_id
                 FROM cartera_nc_detalle
                WHERE idpago = ? AND proveedor_id IS NOT NULL`,
              [idpagoCliente]
            )
          )[0];

      if (!provs.length) {
        return res.status(404).json({ error: 'No hay proveedores en el detalle de esta NC' });
      }

      let enviados = 0;

      for (const p of provs) {
        const prov = Number(p.proveedor_id);
        if (!prov) continue;

        const pdf = await generarNotaCreditoPDFBuffer({
          idpago: idpagoCliente,
          proveedorId: prov,
          lado: 'P'
        });

        const [[rowMail]] = await db.query(
          `SELECT COALESCE(t.correo, t.email) AS correo, t.nombre
             FROM terceros t
            WHERE t.idtercero = ?
            LIMIT 1`,
          [prov]
        );
        if (!rowMail?.correo) continue;

        await enviarCorreoNC(rowMail.correo, pdf, rowMail.nombre, idpagoCliente, 'Proveedor');
        enviados++;
      }

      return res.json({
        ok: true,
        enviados,
        scope: proveedorId ? 'proveedor' : 'proveedores'
      });
    }

    return res.status(400).json({ error: "target inválido (usa 'cliente' o 'proveedores')" });
  } catch (e) {
    console.error('Enviar NC error:', e?.message, e?.stack);
    res.status(500).json({ error: 'No se pudo enviar el correo' });
  }
});

/* ------------------------------------------------------------------ */
/* LISTAR NOTAS DE CRÉDITO POR CLIENTE / PROVEEDOR                    */
/* GET /api/cartera/notas-credito                                     */
/* Query: tipoMovimiento=C|P, idtercero, [desde], [hasta]             */
/* ------------------------------------------------------------------ */
router.get('/notas-credito', async (req, res) => {
  const tipoMovimiento = String(req.query.tipoMovimiento || '').toUpperCase(); // 'C' | 'P'
  const idtercero = Number(req.query.idtercero || 0);
  const { desde, hasta } = req.query;

  if (!['C', 'P'].includes(tipoMovimiento) || !idtercero) {
    return res.status(400).json({
      error: 'Parámetros requeridos: tipoMovimiento (C|P) e idtercero'
    });
  }

  try {
    let rows = [];

    if (tipoMovimiento === 'C') {
      // ================== NC lado CLIENTE ==================
      // Incluimos cliente + marks (mismo criterio que otros reportes)
      const params = [idtercero, idtercero];
      let extraFecha = '';
      if (desde && hasta) {
        extraFecha = ' AND p.fecha BETWEEN ? AND ?';
        params.push(desde, hasta);
      }

      const [r] = await db.query(
        `
        SELECT
          p.idpago,
          p.fecha,
          t.nombre,
          COALESCE(t.correo, t.email) AS correo,
          p.valor
        FROM pagos p
        JOIN terceros t ON t.idtercero = p.idtercero
        WHERE p.tipoMovimiento = 'C'
          AND p.tipoDocumento = 'NC'
          AND p.idtercero IN (
            SELECT tt.idtercero
              FROM terceros tt
             WHERE tt.idcliente_padre = ? OR tt.idtercero = ?
          )
          ${extraFecha}
        ORDER BY p.fecha DESC, p.idpago DESC
        `,
        params
      );

      rows = r || [];
    } else {
      // ================== NC lado PROVEEDOR ==================
      // Todas las NC (C o P) donde este proveedor aparece en el detalle
      const params = [idtercero];
      let extraFecha = '';
      if (desde && hasta) {
        extraFecha = ' AND p.fecha BETWEEN ? AND ?';
        params.push(desde, hasta);
      }

      const [r] = await db.query(
        `
        SELECT
          p.idpago,
          p.fecha,
          ANY_VALUE(tp.nombre) AS nombre,
          ANY_VALUE(COALESCE(tp.correo, tp.email)) AS correo,
          SUM(cnd.monto) AS valor
        FROM cartera_nc_detalle cnd
        JOIN pagos p ON p.idpago = cnd.idpago
        LEFT JOIN terceros tp ON tp.idtercero = cnd.proveedor_id
        WHERE cnd.proveedor_id = ?
          AND p.tipoDocumento = 'NC'
          ${extraFecha}
        GROUP BY p.idpago, p.fecha
        ORDER BY p.fecha DESC, p.idpago DESC
        `,
        params
      );

      rows = r || [];
    }

    const resultado = (rows || []).map((r) => ({
      idpago: r.idpago,
      fecha: ymd(r.fecha),
      nombre: safe(r.nombre),
      correo: safe(r.correo),
      valor: Number(r.valor || 0)
    }));

    return res.json(resultado);
  } catch (err) {
    console.error('❌ Error al listar notas de crédito:', err);
    return res.status(500).json({ error: 'Error al listar notas de crédito' });
  }
});

// =====================================================
// GET /api/cartera/reporte-comprobante/:idpago
//  - lado = 'C' => comprobante de COBRO (cliente)
//  - lado = 'P' => comprobante de PAGO (proveedor)
// =====================================================
router.get('/reporte-comprobante/:idpago', async (req, res) => {
  const idpago = Number(req.params.idpago || 0);
  const lado = String(req.query.lado || 'C').toUpperCase(); // 'C' | 'P'

  if (!idpago) {
    return res.status(400).json({ error: 'idpago requerido' });
  }

  const numeroALetrasBasico = (valor) => {
    const num = Number(valor || 0);
    const entero = Math.trunc(num);
    const centavos = Math.round((num - entero) * 100);
    const enteroFmt = entero.toLocaleString('es-EC', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
    return `${enteroFmt} DÓLARES ${centavos.toString().padStart(2, '0')}/100`;
  };

  // 🔹 Formatear fecha como 2025-12-01
  const fmtFecha = (val) => {
    if (!val) return '';
    try {
      const d = val instanceof Date ? val : new Date(val);
      if (Number.isNaN(d.getTime())) {
        // si es string tipo 2025-12-01T... recortamos
        return String(val).slice(0, 10).replace(/\//g, '-');
      }
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    } catch {
      return String(val).slice(0, 10).replace(/\//g, '-');
    }
  };

  try {
    // ===== 1) Emisor =====
    const [[emisor]] = await db.query(`SELECT razon_social FROM sri_emisor ORDER BY id LIMIT 1`);

    // ===== 2) Cabecera del pago =====
    const [[pago]] = await db.query(
      `
      SELECT
        p.*,
        t.nombre                    AS terceroNombre,
        COALESCE(t.correo, t.email) AS terceroCorreo,
        cs.valor                    AS bancoNombre,
        cs.equivalencia             AS bancoCuenta
      FROM pagos p
      JOIN terceros t
        ON t.idtercero = p.idtercero
      LEFT JOIN catalogo_simple cs
        ON cs.id = p.idbanco
       AND cs.categoria = 'bancos'
      WHERE p.idpago = ?
      LIMIT 1
      `,
      [idpago]
    );

    if (!pago) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    // ===== 3) Detalle facturas (incluye créditos) =====
    const [detalles] = await db.query(
      `
      SELECT
        fc.numero_factura                        AS numero_factura,
        fc.fecha                                  AS fecha,
        fc.valorTotal                             AS valor_factura,
        COALESCE(cred.total_nc, 0)                AS reclamo,
        pf.valorpago                              AS valor_pago
      FROM pagos_factura pf
      JOIN factura_consolidada fc
        ON fc.id = pf.idfactura
      LEFT JOIN (
        SELECT
          pf2.idfactura,
          SUM(pf2.valorpago) AS total_nc
        FROM pagos_factura pf2
        JOIN pagos p2
          ON p2.idpago = pf2.idpago
         AND UPPER(p2.tipoDocumento) IN ('NC','RT')  -- créditos
        GROUP BY pf2.idfactura
      ) AS cred
        ON cred.idfactura = fc.id
      WHERE pf.idpago = ?
      ORDER BY fc.fecha, fc.id
      `,
      [idpago]
    );

    let totalFacturas = 0;
    let totalCreditoNC = 0;
    let totalPago = 0;

    for (const d of detalles) {
      const vFactura = Number(d.valor_factura || 0);
      const vReclamo = Number(d.reclamo || 0);
      const vPago = Number(d.valor_pago || 0);

      totalFacturas += vFactura;
      totalCreditoNC += vReclamo;
      totalPago += vPago;
    }

    const totalComprobante = Number(pago.valor || totalPago || 0);
    const esCobro = lado === 'C';
    const etiquetaTransaccion = esCobro ? 'Cobro' : 'Pago';
    const tituloComprobante = esCobro ? 'COMPROBANTE DE COBRO' : 'COMPROBANTE DE PAGO';

    const beneficiarioNombre = esCobro
      ? safe(emisor?.razon_social || '')
      : safe(pago.terceroNombre || '');

    const etiquetaTercero = esCobro ? 'CLIENTE' : 'PROVEEDOR';

    // ===== 4) PDF =====
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="comprobante-${etiquetaTransaccion.toLowerCase()}-${idpago}.pdf"`
    );
    doc.pipe(res);

    const topY = 40;

    // --- Zona cheque ---
    doc.fontSize(11).text(safe(pago.terceroNombre || ''), 40, topY, { width: 350, align: 'left' });

    doc.fontSize(12).text(fmt(totalComprobante), 380, topY, { width: 160, align: 'right' });

    doc.fontSize(10).text(numeroALetrasBasico(totalComprobante), 40, topY + 20, { width: 500 });

    doc.fontSize(9).text(`Quito, ${fmtFecha(pago.fecha)}`, 40, topY + 40);

    let y = topY + 130;

    // --- Título central ---
    doc.fontSize(14).text(tituloComprobante, 0, y, { align: 'center' });

    y += 25;

    const xIzq = 40;
    const xDer = 330;
    const lineH = 14;

    // --- Bloque general ---
    doc.fontSize(9).text(`Tipo transacción : ${etiquetaTransaccion}`, xIzq, y);
    doc.text(`Fecha CH : ${fmtFecha(pago.fecha)}`, xDer, y);
    y += lineH;

    doc.text(`Reg No : ${pago.idpago}`, xIzq, y);
    doc.text(`Cheque No : ${safe(pago.numero_comprobante)}`, xDer, y);
    y += lineH;

    doc.text(`BENEFICIARIO : ${beneficiarioNombre}`, xIzq, y);
    doc.text(`Banco : ${safe(pago.bancoNombre)}`, xDer, y);
    y += lineH;

    doc.text(`${etiquetaTercero} : ${safe(pago.terceroNombre)}`, xIzq, y);
    doc.text(`Cuenta : ${safe(pago.bancoCuenta)}`, xDer, y);
    y += lineH + 10;

    // --- Tabla detalle ---
    const tablaX = 40;
    let tablaY = y;
    const colFactura = tablaX;
    const colFecha = colFactura + 80;
    const colValor = colFecha + 90;
    const colReclamo = colValor + 90;
    const colPagar = colReclamo + 80;
    const rowH = 16;

    doc
      .fontSize(9)
      .text('Factura #', colFactura, tablaY)
      .text('FECHA', colFecha, tablaY)
      .text('Valor', colValor, tablaY, { width: 80, align: 'right' })
      .text('Reclamo $', colReclamo, tablaY, { width: 80, align: 'right' })
      .text('A Pagar', colPagar, tablaY, { width: 80, align: 'right' });

    tablaY += rowH - 4;
    doc.moveTo(tablaX, tablaY).lineTo(550, tablaY).stroke();
    tablaY += 4;

    for (const d of detalles) {
      const valorFactura = Number(d.valor_factura || 0);
      const reclamo = Number(d.reclamo || 0);
      const valorPago = Number(d.valor_pago || 0);

      doc
        .fontSize(8.5)
        .text(String(d.numero_factura || ''), colFactura, tablaY, { width: 70 })
        .text(fmtFecha(d.fecha), colFecha, tablaY, { width: 80 })
        .text(fmt(valorFactura), colValor, tablaY, { width: 80, align: 'right' })
        .text(reclamo ? fmt(reclamo) : '0,00', colReclamo, tablaY, {
          width: 80,
          align: 'right'
        })
        .text(fmt(valorPago), colPagar, tablaY, { width: 80, align: 'right' });

      tablaY += rowH;
    }

    doc.moveTo(tablaX, tablaY).lineTo(550, tablaY).stroke();
    tablaY += 4;

    doc
      .fontSize(9)
      .text('Totales :', colFecha, tablaY)
      .text(fmt(totalFacturas), colValor, tablaY, { width: 80, align: 'right' })
      .text(fmt(totalCreditoNC), colReclamo, tablaY, { width: 80, align: 'right' })
      .text(fmt(totalPago), colPagar, tablaY, { width: 80, align: 'right' });

    tablaY += rowH + 4;

    const costoBancario = Number(pago.costo_bancario || 0);

    doc.fontSize(9).text(`Costo Bancario : ${fmt(costoBancario)}`, colReclamo, tablaY, {
      width: 150,
      align: 'right'
    });

    tablaY += rowH;

    doc.fontSize(10).text(`A Pagar : ${fmt(totalComprobante)}`, colReclamo, tablaY, {
      width: 150,
      align: 'right'
    });

    // --- Firmas ---
    let firmasY = tablaY + 40;

    doc.moveTo(60, firmasY).lineTo(250, firmasY).stroke();
    doc.moveTo(300, firmasY).lineTo(490, firmasY).stroke();
    firmasY += 4;

    doc.fontSize(9).text('Elaborado por :', 60, firmasY);
    doc.text('Autorizado por :', 300, firmasY);

    const infoY = firmasY + 40;
    doc
      .fontSize(9)
      .text('Nombre : .................................', 320, infoY)
      .text('C.I. : .................................', 320, infoY + 15)
      .text('Fecha : .................................', 320, infoY + 30);

    doc.end();
  } catch (e) {
    console.error('PDF comprobante error:', e?.message, e?.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo generar el PDF del comprobante' });
    }
  }
});

/* ------------------------------------------------------------------ */
/* LISTAR COMPROBANTES DE PAGO / COBRO                               */
/* GET /api/cartera/comprobantes-pago                                */
/* Query: tipoMovimiento=C|P, idtercero, [desde], [hasta]            */
/* ------------------------------------------------------------------ */
router.get('/comprobantes-pago', async (req, res) => {
  const tipoMovimiento = String(req.query.tipoMovimiento || '').toUpperCase(); // 'C' | 'P'
  const idtercero = Number(req.query.idtercero || 0);
  const { desde, hasta } = req.query;

  if (!['C', 'P'].includes(tipoMovimiento) || !idtercero) {
    return res.status(400).json({
      error: 'Parámetros requeridos: tipoMovimiento (C|P) e idtercero'
    });
  }

  try {
    // lado cliente => principal + marks, lado proveedor => solo ese id
    const ids = await idsDelTercero(tipoMovimiento, idtercero);

    const params = [tipoMovimiento, ...ids];
    let extraFecha = '';
    if (desde && hasta) {
      extraFecha = ' AND p.fecha BETWEEN ? AND ?';
      params.push(desde, hasta);
    }

    const [rows] = await db.query(
      `
      SELECT
        p.idpago,
        p.fecha,
        p.numero_comprobante,
        t.nombre,
        COALESCE(t.correo, t.email) AS correo,
        p.valor
      FROM pagos p
      JOIN terceros t ON t.idtercero = p.idtercero
      WHERE p.tipoMovimiento = ?
        AND p.idtercero IN (${ids.map(() => '?').join(',')})
        AND p.tipoDocumento IN ('PG','PP')   -- solo pagos / prepago
        ${extraFecha}
      ORDER BY p.fecha DESC, p.idpago DESC
      `,
      params
    );

    const resultado = rows.map((r) => ({
      idpago: r.idpago,
      fecha: ymd(r.fecha),
      numero_comprobante: safe(r.numero_comprobante),
      nombre: safe(r.nombre),
      correo: safe(r.correo),
      valor: Number(r.valor || 0)
    }));

    return res.json(resultado);
  } catch (err) {
    console.error('❌ Error al listar comprobantes pago/cobro:', err);
    return res.status(500).json({ error: 'Error al listar comprobantes pago/cobro' });
  }
});

module.exports = router;
