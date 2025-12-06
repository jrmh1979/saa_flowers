const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'secreto_predeterminado';

function generarToken(usuario) {
  return jwt.sign(
    {
      idusuario: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol
    },
    SECRET,
    { expiresIn: '1d' }
  );
}

function verificarToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { generarToken, verificarToken };
