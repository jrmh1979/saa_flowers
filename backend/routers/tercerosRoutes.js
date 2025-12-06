const express = require('express');
const router = express.Router();
const db = require('../db');

/* ----------------------- Helpers SRI ----------------------- */
const TIPOS_VALIDOS = new Set(['04', '05', '06', '07', '08']);

function normTipoIdent(v) {
  const s = String(v || '').trim();
  if (TIPOS_VALIDOS.has(s)) return s;
  const p = s.padStart(2, '0');
  if (TIPOS_VALIDOS.has(p)) return p;
  return '04'; // default RUC
}

function normIdent(tipoIdent, ident) {
  const ti = normTipoIdent(tipoIdent);
  let id = ident == null ? '' : String(ident).trim();
  if (ti === '07') {
    if (!id) return '9999999999999'; // consumidor final genérico
    return id;
  }
  return id || null;
}

/* ----------------------- Helpers varios ----------------------- */
function toBool01(v) {
  const s = String(v).toLowerCase();
  if (v === true || v === 1) return 1;
  if (['1', 'true', 'on', 'si', 'sí', 'y', 'yes'].includes(s)) return 1;
  return 0;
}
// Entero o null
function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// === CÓDIGOS AUTOMÁTICOS ===================================
// Cliente principal: C001, C002, C003...
async function generarCodigoClientePrincipal() {
  const [rows] = await db.query(
    `
    SELECT codigotercero
      FROM terceros
     WHERE tipo = 'cliente'
       AND clasifcliente = 'CLIENTE'
       AND codigotercero LIKE 'C%'
     ORDER BY CAST(SUBSTRING(codigotercero, 2) AS UNSIGNED) DESC
     LIMIT 1
    `
  );

  let siguiente = 1;
  if (rows.length && rows[0].codigotercero) {
    const actual = parseInt(rows[0].codigotercero.slice(1), 10);
    if (!Number.isNaN(actual)) siguiente = actual + 1;
  }

  return 'C' + String(siguiente).padStart(3, '0');
}

// Marcación: usa el código del padre + sufijo incremental
// Padre C001 -> C001-1, C001-2, ...
async function generarCodigoMarcacion(idClientePadre) {
  // 1) Código base del padre
  const [padreRows] = await db.query('SELECT codigotercero FROM terceros WHERE idtercero = ?', [
    idClientePadre
  ]);

  if (!padreRows.length) return null;

  const base = padreRows[0].codigotercero || String(idClientePadre);

  // 2) Última marcación para ese padre
  const [rows] = await db.query(
    `
    SELECT codigotercero
      FROM terceros
     WHERE tipo = 'cliente'
       AND clasifcliente = 'MARCACION'
       AND idcliente_padre = ?
       AND codigotercero LIKE CONCAT(?, '-%')
     ORDER BY CAST(SUBSTRING_INDEX(codigotercero, '-', -1) AS UNSIGNED) DESC
     LIMIT 1
    `,
    [idClientePadre, base]
  );

  let siguiente = 1;
  if (rows.length && rows[0].codigotercero) {
    const ult = rows[0].codigotercero;
    const suf = parseInt(ult.split('-').pop(), 10);
    if (!Number.isNaN(suf)) siguiente = suf + 1;
  }

  return `${base}-${siguiente}`;
}

/* ----------------------- Catálogos ----------------------- */
router.get('/catalogo', async (req, res) => {
  try {
    const { categoria } = req.query;
    if (!categoria) return res.status(400).json({ error: 'Falta el parámetro "categoria"' });

    const [rows] = await db.query(
      `SELECT idcatalogo_simple AS id, valor, equivalencia
         FROM catalogo_simple
        WHERE categoria = ?
        ORDER BY valor`,
      [categoria]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error catálogo:', err.message);
    res.status(500).json({ error: 'Error al obtener catálogo' });
  }
});

/* -------------------- Endpoints Terceros -------------------- */

// Obtener terceros por tipo (cliente o proveedor) con inyección opcional de padres
router.get('/', async (req, res) => {
  const { tipo, solo_principales, ensure_id, padre_de } = req.query;
  if (!tipo) return res.status(400).json({ error: 'Falta el parámetro "tipo"' });

  try {
    const baseParams = [tipo];
    const orParts = [];
    const orParams = [];

    // Filtrar solo principales si se solicita
    if (String(solo_principales) === '1') {
      orParts.push("UPPER(COALESCE(t.clasifcliente,'')) = 'CLIENTE'");
    }

    // ensure_id: ids (coma-separados) que se deben incluir sí o sí
    if (ensure_id) {
      const ids = String(ensure_id)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      if (ids.length) {
        orParts.push(`t.idtercero IN (${ids.map(() => '?').join(',')})`);
        orParams.push(...ids);
      }
    }

    // padre_de: ids de marcación, incluir su idcliente_padre
    if (padre_de) {
      const marcIds = String(padre_de)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      if (marcIds.length) {
        orParts.push(
          `t.idtercero IN (
            SELECT DISTINCT m.idcliente_padre
              FROM terceros m
             WHERE m.idtercero IN (${marcIds.map(() => '?').join(',')})
               AND m.idcliente_padre IS NOT NULL
          )`
        );
        orParams.push(...marcIds);
      }
    }

    let sql = `
      SELECT DISTINCT
        t.idtercero, t.codigotercero, t.nombre,
        t.razon_social, t.contacto, t.telefono_contacto,
        t.tipo, t.telefono, t.correo, t.email,
        t.tipo_identificacion, t.identificacion, t.direccion,
        t.idcliente_padre, t.clasifcliente, t.codsino,
        t.tipo_venta_default, t.idpais, t.idcarguera,
        t.idvendedor,
        CASE t.tipo_identificacion
          WHEN '04' THEN 'RUC'
          WHEN '05' THEN 'CÉDULA'
          WHEN '06' THEN 'PASAPORTE'
          WHEN '07' THEN 'CONSUMIDOR FINAL'
          WHEN '08' THEN 'IDENTIFICACIÓN DEL EXTERIOR'
          ELSE NULL
        END AS tipo_identificacion_desc
      FROM terceros t
      WHERE t.tipo = ?
    `;

    // Si hay condiciones, aplícalas como OR para no perder los "forzados"
    if (orParts.length) {
      sql += ` AND (${orParts.join(' OR ')})`;
    }

    sql += ' ORDER BY t.nombre';

    const [results] = await db.query(sql, [...baseParams, ...orParams]);
    res.json(results);
  } catch (err) {
    console.error('❌ Error al obtener terceros:', err.message);
    res.status(500).json({ error: 'Error al obtener terceros' });
  }
});

// Crear nuevo tercero
router.post('/', async (req, res) => {
  try {
    const {
      codigotercero,
      nombre,
      telefono,
      correo,
      email,
      tipo,
      tipo_identificacion,
      identificacion,
      direccion,
      idcliente_padre,
      clasifcliente,
      razon_social,
      contacto,
      telefono_contacto,
      tipo_venta_default,
      idpais,
      idcarguera,
      codsino,
      idvendedor // 🆕
    } = req.body;

    if (!nombre || !tipo) {
      return res.status(400).json({ error: 'Faltan campos requeridos: nombre y tipo' });
    }
    if (!['cliente', 'proveedor'].includes(tipo)) {
      return res.status(400).json({ error: 'El campo "tipo" debe ser "cliente" o "proveedor"' });
    }

    const ti = normTipoIdent(tipo_identificacion);
    const idn = normIdent(ti, identificacion);
    const esCliente = tipo === 'cliente';
    const esProveedor = tipo === 'proveedor';

    const idpaisDb = esCliente ? toIntOrNull(idpais) : null;
    const idcargueraDb = esCliente ? toIntOrNull(idcarguera) : null;
    const idvendedorDb = esCliente ? toIntOrNull(idvendedor) : null; // 🆕

    const clasif = esCliente ? String(clasifcliente || 'CLIENTE').toUpperCase() : null;

    if (esCliente && clasif === 'MARCACION' && !idcliente_padre) {
      return res.status(400).json({ error: 'idcliente_padre es obligatorio para MARCACION' });
    }

    const codsinoDb = esCliente ? toBool01(codsino) : 0;

    // ===== CÓDIGO AUTOMÁTICO =====
    let codigoterceroDb = (codigotercero || '').trim() || null;

    if (esCliente && !codigoterceroDb) {
      if (clasif === 'CLIENTE') {
        // Cliente principal: C001, C002, ...
        codigoterceroDb = await generarCodigoClientePrincipal();
      } else if (clasif === 'MARCACION') {
        // Marcación: CÓDIGO_PADRE-1, -2, ...
        const idPadreNum = toIntOrNull(idcliente_padre);
        if (idPadreNum) {
          codigoterceroDb = await generarCodigoMarcacion(idPadreNum);
        }
      }
    }

    const [ins] = await db.query(
      `
      INSERT INTO terceros
      (codigotercero, nombre, razon_social, contacto, telefono_contacto,
       telefono, correo, email, tipo, tipo_identificacion, identificacion, direccion,
       idcliente_padre, clasifcliente, idpais, idcarguera, tipo_venta_default,
       codsino, idvendedor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        codigoterceroDb || null,
        nombre,
        esProveedor ? String(razon_social || '').trim() || null : null,
        esProveedor ? String(contacto || '').trim() || null : null,
        esProveedor ? String(telefono_contacto || '').trim() || null : null,
        telefono || null,
        correo || null,
        email || null,
        tipo,
        ti,
        idn,
        direccion || null,
        esCliente ? (clasif === 'MARCACION' ? idcliente_padre || null : null) : null,
        esCliente ? clasif : null,
        idpaisDb,
        idcargueraDb,
        tipo_venta_default || 'NACIONAL',
        codsinoDb,
        idvendedorDb
      ]
    );

    // Para clientes PRINCIPALES, se apunta a sí mismo como padre (como ya hacías)
    if (esCliente && clasif !== 'MARCACION') {
      await db.query('UPDATE terceros SET idcliente_padre = ? WHERE idtercero = ?', [
        ins.insertId,
        ins.insertId
      ]);
    }

    res.json({ message: '✅ Tercero agregado correctamente', idtercero: ins.insertId });
  } catch (err) {
    console.error('❌ Error al agregar tercero:', err.message);
    res.status(500).json({ error: 'Error al agregar tercero' });
  }
});

// Actualizar tercero
router.put('/:id', async (req, res) => {
  try {
    const {
      codigotercero,
      nombre,
      telefono,
      correo,
      email,
      tipo,
      tipo_identificacion,
      identificacion,
      direccion,
      idcliente_padre,
      clasifcliente,
      razon_social,
      contacto,
      telefono_contacto,
      tipo_venta_default,
      idpais,
      idcarguera,
      codsino,
      idvendedor // 🆕
    } = req.body;
    const { id } = req.params;

    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    // resolver tipo actual si no viene
    let tipoUsar = tipo;
    if (!tipoUsar) {
      const [r] = await db.query('SELECT tipo FROM terceros WHERE idtercero = ?', [id]);
      tipoUsar = r[0]?.tipo || null;
    }

    const ti = normTipoIdent(tipo_identificacion);
    const idn = normIdent(ti, identificacion);

    const esCliente = tipoUsar === 'cliente';
    const idpaisDb = esCliente ? toIntOrNull(idpais) : null;
    const idcargueraDb = esCliente ? toIntOrNull(idcarguera) : null;
    const idvendedorDb = esCliente ? toIntOrNull(idvendedor) : null; // 🆕

    const clas = typeof clasifcliente === 'string' ? clasifcliente.toUpperCase() : undefined;

    let clasifDb = undefined;
    let idPadreDb = undefined;
    if (esCliente) {
      if (clas === 'CLIENTE') {
        clasifDb = 'CLIENTE';
        idPadreDb = Number(id);
      } else if (clas === 'MARCACION') {
        if (!idcliente_padre) {
          return res.status(400).json({ error: 'idcliente_padre es obligatorio para MARCACION' });
        }
        clasifDb = 'MARCACION';
        idPadreDb = Number(idcliente_padre);
      } else if (clas === undefined) {
        if (idcliente_padre !== undefined)
          idPadreDb =
            idcliente_padre === null || idcliente_padre === '' ? null : Number(idcliente_padre);
      }
    } else {
      if (clas !== undefined) clasifDb = null;
      if (idcliente_padre !== undefined) idPadreDb = null;
    }

    const codsinoParam = codsino === undefined ? null : esCliente ? toBool01(codsino) : 0;

    await db.query(
      `
      UPDATE terceros
         SET codigotercero = ?,
             nombre = ?,
             razon_social = ?,
             contacto = ?,
             telefono_contacto = ?,
             telefono = ?,
             correo = ?,
             email = ?, 
             tipo = COALESCE(?, tipo),
             tipo_identificacion = ?,
             identificacion = ?,
             direccion = ?,

             clasifcliente = COALESCE(?, clasifcliente),
             idcliente_padre = COALESCE(?, idcliente_padre),

             idpais = ?,
             idcarguera = ?,
             tipo_venta_default = ?,
             idvendedor = ?,                -- 🆕

             codsino = COALESCE(?, codsino)
       WHERE idtercero = ?
      `,
      [
        codigotercero || null,
        nombre,
        String(razon_social || '').trim() || null,
        String(contacto || '').trim() || null,
        String(telefono_contacto || '').trim() || null,
        telefono || null,
        correo || null,
        email || null,
        typeof tipo === 'string' && tipo ? tipo : null,
        ti,
        idn,
        direccion || null,

        // clasif/padre
        clasifDb === undefined ? null : clasifDb,
        idPadreDb === undefined ? null : idPadreDb,

        idpaisDb,
        idcargueraDb,
        tipo_venta_default || 'NACIONAL',
        idvendedorDb, // null para limpiar

        codsinoParam,
        id
      ]
    );

    res.send('✅ Tercero actualizado correctamente');
  } catch (err) {
    console.error('❌ Error al actualizar tercero:', err.message);
    res.status(500).json({ error: 'Error al actualizar tercero' });
  }
});

// Proveedores (para selects)
router.get('/proveedores', async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT idtercero AS id, nombre, razon_social, contacto, telefono_contacto, codigotercero
         FROM terceros
        WHERE tipo = 'proveedor'
        ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener proveedores:', err.message);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

// Obtener un tercero por ID
router.get('/by-id/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`SELECT * FROM terceros WHERE idtercero = ?`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Tercero no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('❌ Error /by-id:', e.message);
    res.status(500).json({ error: 'Error obteniendo tercero' });
  }
});

// Verificar si un tercero se puede eliminar (no debe tener facturas emitidas)
router.get('/:id/can-delete', async (req, res) => {
  try {
    const { id } = req.params;

    // ¿Hay al menos una factura emitida a este cliente?
    const [fact] = await db.query(
      `SELECT 1 AS x
         FROM factura_consolidada
        WHERE Idcliente = ?
        LIMIT 1`,
      [id]
    );

    const canDelete = fact.length === 0;
    res.json({
      canDelete,
      reason: canDelete ? null : 'FACTURAS_EMITIDAS'
    });
  } catch (err) {
    console.error('❌ Error /:id/can-delete:', err.message);
    res.status(500).json({ error: 'Error verificando posibilidad de eliminación' });
  }
});

// DELETE /api/terceros/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 0) Tipo de tercero (para saber si aplican reglas de cliente)
    const [[trow] = []] = await conn.query('SELECT tipo FROM terceros WHERE idtercero = ?', [id]);
    if (!trow) {
      await conn.rollback();
      return res.status(404).json({ error: 'Tercero no encontrado' });
    }
    const esCliente = String(trow.tipo) === 'cliente';

    // 1) ÚNICA restricción de negocio: ¿tiene facturas?
    if (esCliente) {
      const [fact] = await conn.query(
        'SELECT 1 FROM factura_consolidada WHERE Idcliente = ? LIMIT 1',
        [id]
      );
      if (fact.length > 0) {
        await conn.rollback();
        return res.status(409).json({
          error:
            'No se puede eliminar: existen facturas emitidas a este tercero (factura_consolidada).',
          reason: 'FACTURAS_EMITIDAS'
        });
      }
    }

    // 2a) Quitar referencias internas: promover marcaciones → CLIENTE (padre = su propio id)
    if (esCliente) {
      await conn.query(
        `
        UPDATE terceros t
           SET t.clasifcliente = 'CLIENTE',
               t.idcliente_padre = t.idtercero
         WHERE t.idcliente_padre = ?
           AND t.idtercero <> ?
        `,
        [id, id]
      );
    }

    // 2b) Romper la AUTO-referencia del propio registro (idcliente_padre = idtercero)
    //     Esto evita que la FK fk_cliente_padre bloquee el DELETE.
    await conn.query(
      `
      UPDATE terceros
         SET idcliente_padre = NULL
       WHERE idtercero = ?
         AND idcliente_padre = idtercero
      `,
      [id]
    );

    // 3) Desvincular FKs anulables en cualquier tabla que apunte a terceros.idtercero
    const [refs] = await conn.query(
      `
      SELECT
        kcu.TABLE_NAME   AS tbl,
        kcu.COLUMN_NAME  AS col,
        c.IS_NULLABLE    AS is_nullable
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      JOIN INFORMATION_SCHEMA.COLUMNS c
        ON c.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       AND c.TABLE_NAME   = kcu.TABLE_NAME
       AND c.COLUMN_NAME  = kcu.COLUMN_NAME
      WHERE kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
        AND kcu.REFERENCED_TABLE_NAME   = 'terceros'
        AND kcu.REFERENCED_COLUMN_NAME  = 'idtercero'
      `
    );

    for (const r of refs) {
      // La FK internos terceros.idcliente_padre ya se maneja en 2a/2b
      if (r.tbl === 'terceros' && r.col === 'idcliente_padre') continue;

      if (String(r.is_nullable).toUpperCase() === 'YES') {
        await conn.query(`UPDATE \`${r.tbl}\` SET \`${r.col}\` = NULL WHERE \`${r.col}\` = ?`, [
          id
        ]);
      }
    }

    // 4) Intentar eliminar
    const [del] = await conn.query('DELETE FROM terceros WHERE idtercero = ?', [id]);
    if (del.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Tercero no encontrado' });
    }

    await conn.commit();
    res.json({ message: '✅ Tercero eliminado correctamente', idtercero: Number(id) });
  } catch (err) {
    await conn.rollback();

    // Si aún queda una FK (no anulable), informamos con detalle (tabla/columna)
    if (err?.code === 'ER_ROW_IS_REFERENCED_2' || err?.errno === 1451) {
      const m = String(err.sqlMessage || '');
      const match = m.match(/FOREIGN KEY \\?\(`([^`]+)`\\?\) REFERENCES `([^`]+)`/);
      return res.status(409).json({
        error:
          'No se puede eliminar porque el tercero está referenciado por otros registros (clave foránea).',
        reason: 'FK_CONSTRAINT',
        detail: {
          column: match?.[1] || null,
          table: match?.[2] || null
        }
      });
    }

    console.error('❌ Error DELETE /:id:', err);
    res.status(500).json({ error: 'Error al eliminar tercero' });
  } finally {
    conn.release?.();
  }
});

module.exports = router;
