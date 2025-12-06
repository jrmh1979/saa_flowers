const nodemailer = require('nodemailer');

// ✅ Configuración del transporter con Gmail (usa App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'jrmartinezh5@gmail.com',
    pass: 'vlbv vxhs nivm tuqo' // App password, no tu contraseña normal
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

module.exports = {
  enviarCorreoOrden,
  enviarCorreoEstadoCuenta,
  enviarCorreoNC
};
