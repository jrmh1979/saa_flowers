const nodemailer = require('nodemailer');

// ✅ Configuración del transporter con Gmail (usa App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/**
 * ✅ Enviar orden de compra
 */
const enviarCorreoOrden = async (correoDestino, pdfBuffer, nombreProveedor, idfactura) => {
  const asunto = `Orden de Compra - Factura ${idfactura}`;
  const mensaje = `
    Estimado/a ${nombreProveedor},<br><br>
    Adjunto encontrará la orden de compra correspondiente a la factura consolidada <strong>#${idfactura}</strong>.<br><br>
    Por favor confirme la recepción de este documento.<br><br>
    Saludos cordiales,<br>
    Equipo de Compras
  `;

  await transporter.sendMail({
    from: 'Mesa de Compras <tucuenta@gmail.com>',
    to: correoDestino,
    subject: asunto,
    html: mensaje,
    attachments: [
      {
        filename: `Orden_Compra_${nombreProveedor}_${idfactura}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
};

/**
 * ✅ Enviar estado de cuenta
 */
const enviarCorreoEstadoCuenta = async (correoDestino, pdfBuffer, nombreTercero, rangoFechas) => {
  const asunto = `Estado de Cuenta - ${nombreTercero}`;
  const mensaje = `
    Estimado/a ${nombreTercero},<br><br>
    Adjunto encontrará el estado de cuenta correspondiente al período <strong>${rangoFechas}</strong>.<br><br>
    Si tiene alguna duda, estamos a su disposición.<br><br>
    Saludos cordiales,<br>
    Equipo de Compras
  `;

  await transporter.sendMail({
    from: 'Mesa de Compras <tucuenta@gmail.com>',
    to: correoDestino,
    subject: asunto,
    html: mensaje,
    attachments: [
      {
        filename: `Estado_Cuenta_${nombreTercero}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
};

// (Tu transporter actual se queda igual)
const enviarCorreoNC = async (correoDestino, pdfBuffer, nombre, idpago, contexto = 'Cliente') => {
  const asunto = `Nota de Crédito #${idpago} - ${contexto}`;
  const mensaje = `
    Estimado/a ${nombre || ''},<br><br>
    Adjunto encontrará la <strong>Nota de Crédito #${idpago}</strong> (${contexto}).<br><br>
    Saludos cordiales,<br>
    Equipo de Cartera
  `;
  await transporter.sendMail({
    from: 'Cartera <tucuenta@gmail.com>',
    to: correoDestino,
    subject: asunto,
    html: mensaje,
    attachments: [
      {
        filename: `NC_${contexto}_${idpago}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
};

/**
 * ✅ Enviar Commercial Invoice al Cliente
 */
const enviarCorreoInvoice = async (correoDestino, pdfBuffer, numeroFactura, nombreCliente) => {
  // Validación básica
  if (!correoDestino || !correoDestino.includes('@')) {
    console.warn(`⚠️ No se envió el Invoice ${numeroFactura}: Correo inválido (${correoDestino})`);
    return;
  }

  const asunto = `Commercial Invoice - Factura #${numeroFactura}`;
  const mensaje = `
    Estimado/a ${nombreCliente || 'Cliente'},<br><br>
    Adjunto encontrará la <strong>Commercial Invoice #${numeroFactura}</strong> correspondiente a su pedido.<br><br>
    Agradecemos su preferencia.<br><br>
    Saludos cordiales,<br>
    <strong>Sales Flower EC</strong>
  `;

  try {
    await transporter.sendMail({
      from: '"Sales Flower Dept" <Salesflowerec@gmail.com>', // Nombre remitente más profesional
      to: correoDestino,
      subject: asunto,
      html: mensaje,
      attachments: [
        {
          filename: `Invoice_${numeroFactura}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });
    console.log(`✅ Invoice ${numeroFactura} enviado a ${correoDestino}`);
  } catch (error) {
    console.error(`❌ Error enviando Invoice ${numeroFactura}:`, error);
    throw error; // Relanzar para que el controlador sepa que falló
  }
};

// No olvides exportarla al final del archivo:
module.exports = {
  enviarCorreoOrden,
  enviarCorreoEstadoCuenta,
  enviarCorreoNC,
  enviarCorreoInvoice // <--- Agregado
};
