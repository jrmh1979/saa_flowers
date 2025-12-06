const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'secreto_predeterminado';

function verificarToken(req, res, next) {
  // Tomamos el token del header Authorization
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    // Verificamos y decodificamos el token
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded; // Ahora req.user.idusuario está disponible
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = verificarToken;
