const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/reportes/dinamico?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * - Filtra por fecha, estado=listo, tipoMovimiento=C, tipoDocumento=F
 * - Join factura_consolidada (f) y factura_consolidada_detalle (d)
 * - Incluye cliente, proveedor, producto, variedad, VENDEDOR
 * - Devuelve campos base + anio, mes, semana (agrícola ISO)
 */
router.get('/dinamico', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ error: 'Parámetros requeridos: desde y hasta (YYYY-MM-DD)' });
    }

    const params = [desde, hasta];
    const [rows] = await db.query(
      `
      SELECT
        d.iddetalle,
        f.id                       AS idfactura,
        f.fecha,
        YEAR(f.fecha)              AS anio,
        MONTH(f.fecha)             AS mes,
        WEEK(f.fecha, 3)           AS semana,   -- 🆕 semana agrícola ISO (lunes-domingo)

        f.idcliente,
        cli.nombre                 AS cliente,

        d.idproveedor,
        prov.nombre                AS proveedor,

        prd.valor                  AS producto,
        var.valor                  AS variedad,

        /* Vendedor del cliente */
        cli.idvendedor             AS idvendedor,
        vend.nombre                AS vendedor,

        d.cantidad                 AS piezas,
        d.cantidadTallos,

        d.subtotal,                                -- costo/compra
        d.subtotalVenta                            -- venta
      FROM factura_consolidada_detalle d
      JOIN factura_consolidada f    ON f.id = d.idfactura
      LEFT JOIN terceros cli        ON cli.idtercero  = f.idcliente
      LEFT JOIN usuarios vend       ON vend.id        = cli.idvendedor
      LEFT JOIN terceros prov       ON prov.idtercero = d.idproveedor
      LEFT JOIN catalogo_simple prd ON prd.id = d.idproducto
      LEFT JOIN catalogo_simple var ON var.id = d.idvariedad
      WHERE
        f.fecha BETWEEN ? AND ?
        AND LOWER(COALESCE(f.estado,'')) = 'listo'
        AND UPPER(COALESCE(f.tipoMovimiento,'')) = 'C'
        AND UPPER(COALESCE(f.tipoDocumento,''))  = 'F'
      ORDER BY f.fecha DESC, d.iddetalle ASC
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ /api/reportes/dinamico:', err);
    res.status(500).json({ error: 'Error generando el reporte dinámico' });
  }
});

module.exports = router;
