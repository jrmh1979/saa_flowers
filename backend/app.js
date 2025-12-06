// ⬇️ 1) Fuerza la TZ del proceso Node ANTES de importar nada más
process.env.TZ = 'America/Guayaquil';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const db = require('./db');
const listEndpoints = require('express-list-endpoints');
const cron = require('node-cron');

const configurarSockets = require('./socket/server-socket');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 5000;

// ⬇️ 2) Asegura TZ en MySQL para TODAS las requests (ligero costo, máxima certeza)
app.use(async (_req, _res, next) => {
  try {
    await db.query("SET time_zone = 'America/Guayaquil'");
  } catch (e) {
    console.warn('No se pudo fijar time_zone en MySQL (seguimos):', e?.message || e);
  }
  next();
});

// (opcional) también al arrancar, por si usas procesos en background
(async () => {
  try {
    await db.query("SET GLOBAL time_zone = 'America/Guayaquil'");
  } catch (e) {
    console.warn('No se pudo fijar GLOBAL time_zone (no bloquea):', e?.message || e);
  }
})();

// ✅ Crear carpeta uploads si no existe
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// CORS para frontend (ajusta origin si usas prod)
app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true
  })
);

// Middlewares
// ⬆️ Aumentamos el límite para permitir el p12 base64 del certificado
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// 🔌 Socket.IO
configurarSockets(server);

// Rutas API
const pedidosRoutes = require('./routers/pedidosRoutes');
const facturaRoutes = require('./routers/facturaRoutes');
const tercerosRoutes = require('./routers/tercerosRoutes');
const catalogoRoutes = require('./routers/catalogoRoutes');
const importacionesRoutes = require('./routers/importacionesRoutes');
const cajasMixtasRoutes = require('./routers/cajasMixtasController');
const cajasMixtasPedidosRoutes = require('./routers/cajasMixtasPedidosController');
const usuariosRoutes = require('./routers/usuariosRoutes');
const reportesRoutes = require('./routers/reportesRoutes');
const asignarEtiquetaRoutes = require('./routers/asignarEtiquetaController');
const permisosRoutes = require('./routers/permisos');
const carteraRoutes = require('./routers/carteraRoutes');
const inventarioFlorRoutes = require('./routers/inventarioflor');
const empresaRoutes = require('./routers/empresaRoutes');
const daeRoutes = require('./routers/daeRoutes');
const ordenesFijasRoutes = require('./routers/ordenesFijasRoutes');

// Montar rutas
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/facturas', facturaRoutes);
app.use('/api/terceros', tercerosRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/importar', importacionesRoutes);
app.use('/api/caja-mixta', cajasMixtasRoutes);
app.use('/api/caja-mixta-pedidos', cajasMixtasPedidosRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/etiquetas', asignarEtiquetaRoutes);
app.use('/api/permisos', permisosRoutes);
app.use('/api/cartera', carteraRoutes);
app.use('/api/inventario', inventarioFlorRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/dae', daeRoutes);
app.use('/api/ordenes-fijas', ordenesFijasRoutes);

// Ruta de prueba
app.get('/ping', async (_req, res) => {
  try {
    const [result] = await db.query('SELECT 1 + 1 AS resultado');
    res.send('✅ Backend activo y base de datos conectada');
  } catch (err) {
    console.error('❌ Error en /ping:', err);
    res.status(500).send('❌ Error en la base de datos');
  }
});

// Frontend estático (prod)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });
}

// ----------------------------- ⏰ CRON JOBS ⏰ ------------------------------
// Notas:
// - Se programan AMBAS opciones (día actual y lead_time), protegidas por idempotencia
// - Puedes desactivar cada una con variables de entorno:
//     RUN_CRON_HOY=false   o   RUN_CRON_LEAD=false
// - Zona horaria: America/Guayaquil

const TZ = 'America/Guayaquil';

// Opción 1: genera lo de HOY (DOW) a las 06:00
if (String(process.env.RUN_CRON_HOY || 'true') === 'true') {
  cron.schedule(
    '0 6 * * *',
    async () => {
      try {
        if (typeof ordenesFijasRoutes.autoSubirProgramadasParaHoy !== 'function') {
          console.warn('⏰ OF/Hoy: función no disponible en el router.');
          return;
        }
        const r = await ordenesFijasRoutes.autoSubirProgramadasParaHoy();
        console.log('⏰ OF/Hoy =>', r);
      } catch (e) {
        console.error('⏰ OF/Hoy ERROR =>', e.message);
      }
    },
    { timezone: TZ }
  );
}

// Opción 2: genera por lead_time_dias a las 18:00
if (String(process.env.RUN_CRON_LEAD || 'true') === 'true') {
  cron.schedule(
    '0 18 * * *',
    async () => {
      try {
        if (typeof ordenesFijasRoutes.autoSubirProgramadasPorLeadTime !== 'function') {
          console.warn('⏰ OF/LeadTime: función no disponible en el router.');
          return;
        }
        const r = await ordenesFijasRoutes.autoSubirProgramadasPorLeadTime();
        console.log('⏰ OF/LeadTime =>', r);
      } catch (e) {
        console.error('⏰ OF/LeadTime ERROR =>', e.message);
      }
    },
    { timezone: TZ }
  );
}

// Mostrar rutas
//console.table(listEndpoints(app));

// 🚀 Iniciar servidor
server.listen(port, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
  console.log(`🕒 TZ Node: ${process.env.TZ}`);
});
