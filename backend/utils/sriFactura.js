const moment = require('moment');
const X2JS = require('x2js');
const { validateXML } = require('xsd-schema-validator');
const { SignedXml } = require('xml-crypto');
const forge = require('node-forge');
const path = require('path');
const fs = require('fs');

const x2js = new X2JS({ attributePrefix: '_', arrayAccessForm: 'property' });

/* ========================== Config XSD =========================== */
const XSD_DIR = process.env.SRI_XSD_DIR
  ? path.resolve(process.cwd(), process.env.SRI_XSD_DIR)
  : path.join(__dirname, '../xsd');

const XSD_VERSION = process.env.SRI_XSD_VERSION || '1_1_0'; // '1_1_0' | '1_0_0'

function getXsdPath(docType = 'factura', version = XSD_VERSION) {
  const verDir = path.join(XSD_DIR, version);

  // Ajusta estos nombres si tus archivos XSD tienen otro nombre
  const map11 = {
    factura: 'Factura_V_1_1_0.xsd',
    notaCredito: 'Nota_Credito_V_1_1_0.xsd',
    guiaRemision: 'Guias_de_Remision_V_1_1_0.xsd',
    liquidacionCompra: 'Liquidacion_Compra_V_1_1_0.xsd'
  };
  const map10 = {
    factura: 'Factura_V_1_0_0.xsd',
    notaCredito: 'Nota_Credito_V_1_0_0.xsd',
    guiaRemision: 'Guias_de_Remision_V_1_0_0.xsd',
    liquidacionCompra: 'Liquidacion_Compra_V_1_0_0.xsd'
  };

  const fileMap = version === '1_0_0' ? map10 : map11;
  const fileName = fileMap[docType] || fileMap.factura;
  const full = path.join(verDir, fileName);

  if (!fs.existsSync(full)) {
    throw new Error(
      `XSD no encontrado: ${full}. Revisa SRI_XSD_DIR/SRI_XSD_VERSION y el nombre del archivo.`
    );
  }

  // Debe existir en la MISMA carpeta (los XSD lo incluyen)
  const sigXsd = path.join(verDir, 'xmldsig-core-schema.xsd');
  if (!fs.existsSync(sigXsd)) {
    throw new Error(`Falta xmldsig-core-schema.xsd en ${verDir}`);
  }

  return full;
}

/* ========================== Helpers ============================= */

function modulo11(base) {
  let factor = 2,
    sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const mod = 11 - (sum % 11);
  return mod === 11 ? 0 : mod === 10 ? 1 : mod;
}

function buildClaveAcceso({
  fecha,
  codDoc,
  ruc,
  ambiente,
  estab,
  ptoEmi,
  sec9,
  codigoNum8 = '12345678',
  tipoEmision = '1'
}) {
  // SRI usa DDMMYYYY
  const ddmmyyyy = moment(fecha).format('DDMMYYYY');
  const base = `${ddmmyyyy}${codDoc}${ruc}${ambiente}${estab}${ptoEmi}${sec9}${codigoNum8}${tipoEmision}`;
  const digito = modulo11(base);
  return base + String(digito);
}

/** Construye el objeto JS con la estructura SRI 1.1.0 */
function buildFacturaObject({
  infoTributaria,
  infoFactura,
  detalles,
  infoAdicional,
  version = '1.1.0'
}) {
  return {
    factura: {
      _id: 'comprobante',
      _version: version,
      infoTributaria,
      infoFactura,
      detalles: { detalle: detalles },
      ...(infoAdicional?.length ? { infoAdicional: { campoAdicional: infoAdicional } } : {})
    }
  };
}

function jsToXml(obj) {
  const xml = x2js.js2xml(obj);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/* ======== Validación contra XSD (por tipo y versión) ========= */

function validateFacturaXml(xml, version = XSD_VERSION) {
  return new Promise((resolve, reject) => {
    const xsdPath = getXsdPath('factura', version);
    validateXML(xml, xsdPath, (err, result) => {
      if (err) return reject(err);
      if (!result.valid) return reject(new Error('XML inválido contra XSD Factura'));
      resolve(true);
    });
  });
}

// Genérico por si lo necesitas para otros docs (NC, GR, etc.)
function validateXml(xml, docType = 'factura', version = XSD_VERSION) {
  return new Promise((resolve, reject) => {
    const xsdPath = getXsdPath(docType, version);
    validateXML(xml, xsdPath, (err, result) => {
      if (err) return reject(err);
      if (!result.valid) return reject(new Error(`XML inválido contra XSD ${docType}`));
      resolve(true);
    });
  });
}

/* ===================== Firma XMLDSig =========================== */
/**
 * Firma la etiqueta raíz <factura id="comprobante"> con EnvelopedSignature.
 * Configura algoritmo vía env:
 *   SRI_XMLDSIG_ALGO=sha1 | sha256   (default: sha1)
 */
function signXml(xml, p12Base64, password) {
  // Extraer llave y certificado del .p12
  const p12Der = forge.util.decode64(p12Base64);
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];

  if (!certBags?.length || !keyBags?.length) {
    throw new Error('No se pudo leer certificado/llave del P12');
  }

  const certPem = forge.pki.certificateToPem(certBags[0].cert);
  const keyPem = forge.pki.privateKeyToPem(keyBags[0].key);
  const certNoHeaders = certPem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\r?\n/g, '');

  const algo = (process.env.SRI_XMLDSIG_ALGO || 'sha1').toLowerCase();
  const signatureAlgorithm =
    algo === 'sha256'
      ? 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
      : 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  const digestAlgorithm =
    algo === 'sha256'
      ? 'http://www.w3.org/2001/04/xmlenc#sha256'
      : 'http://www.w3.org/2000/09/xmldsig#sha1';

  const sig = new SignedXml();
  sig.signingKey = keyPem;
  sig.addReference(
    "//*[local-name(.)='factura' and @id='comprobante']",
    [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
    ],
    digestAlgorithm
  );
  sig.signatureAlgorithm = signatureAlgorithm;
  sig.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certNoHeaders}</X509Certificate></X509Data>`
  };

  // xml-crypto firma a partir del string; no hace falta parsearlo
  sig.computeSignature(xml);
  return sig.getSignedXml();
}

module.exports = {
  // helpers SRI
  buildClaveAcceso,
  buildFacturaObject,
  jsToXml,
  validateFacturaXml,
  validateXml,
  signXml,
  // util exportado por si necesitas resolver manualmente
  getXsdPath
};
