// utils/registrarAuditoria.js

async function registrarAuditoria(conn, idusuario, accion, modulo, descripcion) {
  // 📅 Obtener fecha y hora actual en UTC-5 (Ecuador)
  const ahora = new Date();
  ahora.setUTCHours(ahora.getUTCHours() - 5); // Ajuste manual a UTC-5

  try {
    await conn.query(
      `INSERT INTO auditoria (idusuario, accion, modulo, descripcion, fecha)
       VALUES (?, ?, ?, ?, ?)`,
      [idusuario, accion, modulo, descripcion, ahora]
    );
  } catch (err) {
    console.error('❌ Error al registrar auditoría:', err.message);
  }
}

module.exports = registrarAuditoria;

