// ===== e-Factura SRI =====
const soap = require('soap');
const moment = require('moment');

const { getEmisor, getSecuencia, incSecuencia, leftPad } = require('../utils/sriEmisor');

const {
  buildClaveAcceso,
  buildFacturaObject,
  jsToXml,
  validateFacturaXml,
  signXml
} = require('../utils/sriFactura');

// Certificado activo (p12 en base64)
async function getCertActivo(emisorId) {
  const [rows] = await db.query(
    `SELECT * FROM sri_certificado WHERE emisor_id = ? AND activo = 1 ORDER BY id DESC LIMIT 1`,
    [emisorId]
  );
  if (!rows.length) throw new Error('No hay certificado activo para el emisor');
  return rows[0];
}

// Cabecera + cliente + totales desde tu DB
async function getFacturaFuente(idfactura) {
  const [[cab]] = await db.query(
    `SELECT f.*, cli.nombre AS cliente_nombre, cli.ruc AS cliente_ruc, cli.correo AS cliente_correo,
            cli.direccion AS cliente_direccion, cli.ciudad AS cliente_ciudad, cli.pais AS cliente_pais
       FROM factura_consolidada f
       JOIN terceros cli ON cli.idtercero = f.idcliente
      WHERE f.id = ? LIMIT 1`,
    [idfactura]
  );
  if (!cab) throw new Error('Factura no encontrada');

  const [det] = await db.query(
    `SELECT d.*, 
            p.valor AS producto, v.valor AS variedad, l.valor AS longitud
       FROM factura_consolidada_detalle d
       LEFT JOIN catalogo_simple p ON p.id = d.idproducto
       LEFT JOIN catalogo_simple v ON v.id = d.idvariedad
       LEFT JOIN catalogo_simple l ON l.id = d.idlongitud
      WHERE d.idfactura = ?
      ORDER BY d.iddetalle`,
    [idfactura]
  );

  return { cab, det };
}

// Deducción simple del tipo de identificación del comprador
function tipoIdComprador(ident) {
  const s = String(ident || '').trim();
  if (/^\d{13}$/.test(s)) return '04'; // RUC
  if (/^\d{10}$/.test(s)) return '05'; // Cédula
  return '06'; // Pasaporte/otros
}

// Normalizador de número money a 2 decimales
const to2 = (n) => Number(n || 0).toFixed(2);

// SOAP helpers (parse/defensive)
function pick(obj, path, def = undefined) {
  try {
    return (
      path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj) ?? def
    );
  } catch {
    return def;
  }
}

// -----------------------------------------------
//  POST /api/facturas/:id/electronica
// -----------------------------------------------
router.post('/:id/electronica', verificarToken, async (req, res) => {
  const idfactura = Number(req.params.id);
  const relacionado_tabla = 'factura_consolidada';
  let docRowId = null;

  try {
    // 0) Config emisor + secuencia
    const emisor = await getEmisor();
    const sec = await getSecuencia('01'); // Factura
    const sec9 = leftPad(sec.secuencial_actual + 1, 9);

    // 1) Fuente (cabecera, cliente, items)
    const { cab, det } = await getFacturaFuente(idfactura);

    // 2) Totales e items (exportación: IVA 0%)
    const items = det.map((d) => {
      // cantidad = tallos; unit = precio_venta; total = tallos * unit
      const cantidad = Number(d.cantidadTallos || 0);
      const unit = Number(d.precio_venta || 0);
      const base = cantidad * unit;

      return {
        codigoPrincipal: d.codigo || String(d.iddetalle),
        descripcion: `${d.producto || ''} ${d.variedad || ''} ${d.longitud || ''}`.trim(),
        cantidad,
        precioUnitario: unit.toFixed(4),
        descuento: 0,
        precioTotalSinImpuesto: to2(base),
        impuestos: {
          impuesto: [
            {
              codigo: '2', // IVA
              codigoPorcentaje: '0', // 0%
              tarifa: 0,
              baseImponible: Number(base),
              valor: 0
            }
          ]
        }
      };
    });

    const totalSinImp = items.reduce((s, it) => s + Number(it.precioTotalSinImpuesto), 0);
    const totalDescuento = 0;
    const totalImpuestos = [
      {
        codigo: '2',
        codigoPorcentaje: '0',
        baseImponible: totalSinImp,
        valor: 0
      }
    ];
    const importeTotal = totalSinImp; // IVA 0

    // 3) infoTributaria
    const infoTributaria = {
      ambiente: emisor.ambiente, // '1' o '2'
      tipoEmision: emisor.tipo_emision, // '1'
      razonSocial: emisor.razon_social,
      nombreComercial: emisor.nombre_comercial || emisor.razon_social,
      ruc: emisor.ruc,
      claveAcceso: '', // se calcula abajo
      codDoc: '01',
      estab: sec.estab,
      ptoEmi: sec.pto_emi,
      secuencial: sec9,
      dirMatriz: emisor.dir_matriz
    };

    // 4) infoFactura
    const infoFactura = {
      fechaEmision: moment(cab.fecha || new Date()).format('DD/MM/YYYY'),
      dirEstablecimiento: sec.dir_establecimiento,
      contribuyenteEspecial: emisor.contribuyente_especial_numero || undefined,
      obligadoContabilidad: emisor.obligado_contabilidad,
      tipoIdentificacionComprador: tipoIdComprador(cab.cliente_ruc),
      razonSocialComprador: cab.cliente_nombre || 'CONSUMIDOR FINAL',
      identificacionComprador: cab.cliente_ruc || '9999999999999',
      totalSinImpuestos: to2(totalSinImp),
      totalDescuento: to2(totalDescuento),
      totalConImpuestos: {
        totalImpuesto: totalImpuestos.map((t) => ({
          ...t,
          baseImponible: to2(t.baseImponible),
          valor: to2(t.valor)
        }))
      },
      propina: '0.00',
      importeTotal: to2(importeTotal),
      moneda: 'USD'
    };

    // 5) infoAdicional
    const infoAdicional = [
      { _nombre: 'Email', __text: cab.cliente_correo || '' },
      { _nombre: 'AWB', __text: cab.awb || '' },
      { _nombre: 'HAWB', __text: cab.hawb || '' },
      { _nombre: 'DAE', __text: cab.iddae ? String(cab.iddae) : '' }
    ].filter((x) => x.__text);

    // 6) Clave de acceso
    const claveAcceso = buildClaveAcceso({
      fecha: moment(cab.fecha || new Date()).format('YYYY-MM-DD'),
      codDoc: '01',
      ruc: emisor.ruc,
      ambiente: emisor.ambiente,
      estab: sec.estab,
      ptoEmi: sec.pto_emi,
      sec9,
      codigoNum8: '12345678', // puedes parametrizarlo
      tipoEmision: emisor.tipo_emision
    });
    infoTributaria.claveAcceso = claveAcceso;

    // 7) Construir XML (JS -> XML) + validar XSD
    const facturaObj = buildFacturaObject({
      infoTributaria,
      infoFactura,
      detalles: items,
      infoAdicional
    });
    const xml = jsToXml(facturaObj);
    await validateFacturaXml(xml); // lanza error si no cumple el XSD

    // 8) Firmar XML con el P12
    const cert = await getCertActivo(emisor.id);
    const xmlFirmado = signXml(xml, cert.p12_base64, cert.password);
    const xmlFirmadoB64 = Buffer.from(xmlFirmado).toString('base64');

    // 9) Registrar documento (GENERADO)
    const [ins] = await db.query(
      `INSERT INTO sri_documento
        (emisor_id, cod_doc, estab, pto_emi, secuencial, clave_acceso, estado, xml_generado, xml_firmado,
         relacionado_tabla, relacionado_id)
       VALUES (?, '01', ?, ?, ?, ?, 'GENERADO', ?, ?, ?, ?)`,
      [
        emisor.id,
        sec.estab,
        sec.pto_emi,
        sec9,
        claveAcceso,
        xml,
        xmlFirmado,
        relacionado_tabla,
        idfactura
      ]
    );
    docRowId = ins.insertId;
    await db.query(
      `INSERT INTO sri_documento_log (documento_id, estado, mensaje) VALUES (?, ?, ?)`,
      [docRowId, 'GENERADO', 'XML generado y firmado']
    );

    // 10) Enviar a Recepción
    const recepWsdl =
      process.env.SRI_RECEPCION_WSDL ||
      (emisor.ambiente === '2'
        ? 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl'
        : 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl');

    const clientRec = await soap.createClientAsync(recepWsdl);
    const [respRec] = await clientRec.validarComprobanteAsync({ xml: xmlFirmadoB64 });

    const estadoRecep =
      pick(respRec, 'RespuestaRecepcionComprobante.estado') ||
      pick(respRec, 'respuestaRecepcionComprobante.estado') ||
      pick(respRec, 'estado') ||
      'DEVUELTA';

    await db.query(
      `INSERT INTO sri_documento_log (documento_id, estado, mensaje) VALUES (?, ?, ?)`,
      [docRowId, 'RECEPCION', JSON.stringify(respRec).slice(0, 5000)]
    );

    if (estadoRecep !== 'RECIBIDA') {
      await db.query(
        `UPDATE sri_documento SET estado = 'RECHAZADO', observacion = ? WHERE id = ?`,
        ['Devuelta en recepción', docRowId]
      );
      return res
        .status(200)
        .json({ ok: false, etapa: 'RECEPCION', estado: estadoRecep, detalle: respRec });
    }

    await db.query(`UPDATE sri_documento SET estado='RECIBIDO' WHERE id=?`, [docRowId]);

    // 11) Consultar Autorización
    const autoWsdl =
      process.env.SRI_AUTORIZACION_WSDL ||
      (emisor.ambiente === '2'
        ? 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl'
        : 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl');

    const clientAut = await soap.createClientAsync(autoWsdl);
    const [respAut] = await clientAut.autorizacionComprobanteAsync({
      claveAccesoComprobante: claveAcceso
    });

    const auths =
      pick(respAut, 'RespuestaAutorizacionComprobante.autorizaciones.autorizacion') ||
      pick(respAut, 'autorizaciones.autorizacion') ||
      [];
    const auth = Array.isArray(auths) ? auths[0] : auths;

    const estadoAut = pick(auth, 'estado') || 'NO AUTORIZADO';
    const numAut = pick(auth, 'numeroAutorizacion') || null;
    const fechaAut = pick(auth, 'fechaAutorizacion') || null;
    const xmlAut = pick(auth, 'comprobante') || null;

    await db.query(
      `INSERT INTO sri_documento_log (documento_id, estado, mensaje) VALUES (?, ?, ?)`,
      [docRowId, 'AUTORIZACION', JSON.stringify(respAut).slice(0, 5000)]
    );

    if (estadoAut !== 'AUTORIZADO') {
      await db.query(
        `UPDATE sri_documento SET estado='NO_AUTORIZADO', xml_autorizado=?, observacion=? WHERE id=?`,
        [xmlAut, estadoAut, docRowId]
      );
      return res.status(200).json({ ok: false, etapa: 'AUTORIZACION', estado: estadoAut });
    }

    // 12) Final feliz: guardar y subir secuencia
    await db.query(
      `UPDATE sri_documento 
          SET estado='AUTORIZADO', numero_autorizacion=?, fecha_autorizacion=?, xml_autorizado=?
        WHERE id=?`,
      [numAut, fechaAut ? moment(fechaAut).toDate() : new Date(), xmlAut, docRowId]
    );

    // incrementa secuencia SOLO cuando autoriza (así evitas huecos)
    await incSecuencia(sec.id);

    res.json({
      ok: true,
      id: docRowId,
      claveAcceso,
      numeroAutorizacion: numAut,
      estado: 'AUTORIZADO'
    });
  } catch (e) {
    console.error(':/ e-factura error', e);
    if (docRowId) {
      await db.query(`UPDATE sri_documento SET estado='RECHAZADO', observacion=? WHERE id=?`, [
        e.message?.slice(0, 1000) || 'ERROR',
        docRowId
      ]);
      await db.query(
        `INSERT INTO sri_documento_log (documento_id, estado, mensaje) VALUES (?, ?, ?)`,
        [docRowId, 'ERROR', e.stack?.slice(0, 8000) || String(e)]
      );
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});
