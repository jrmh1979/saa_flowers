const mysql = require('mysql2/promise');
require('dotenv').config(); // Solo necesario si corres en local con `.env`

// Detectar si estamos en producción
const isProduction = process.env.NODE_ENV === 'production';

// Configuración según entorno
const config = isProduction
  ? {
      host: process.env.MYSQLHOST || 'mysql.railway.internal',
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
      port: parseInt(process.env.MYSQLPORT) || 3306,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'mesa_compras',
      port: parseInt(process.env.DB_PORT) || 3306,
    };

const pool = mysql.createPool(config);

module.exports = pool;

