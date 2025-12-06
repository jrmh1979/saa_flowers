const express = require('express');
const router = express.Router();

// Importar cada grupo de rutas
const pedidosRoutes = require('./pedidosRoutes');
const facturaRoutes = require('./facturaRoutes');
const cajasMixtasController = require('./cajasMixtasController');
const tercerosRoutes = require('./tercerosRoutes');
const catalogoRoutes = require('./catalogoRoutes');
const importacionesRoutes = require('./importacionesRoutes');
const awbController = require('./awbController');
const calcularPesosRoutes = require('./calcularPesosRoutes');

// Montar las rutas bajo /api/*
router.use('/pedidos', pedidosRoutes);                 // /api/pedidos
router.use('/facturas', facturaRoutes);                // /api/facturas
router.use('/caja-mixta', cajasMixtasController);      // /api/caja-mixta
router.use('/terceros', tercerosRoutes);               // /api/terceros
router.use('/catalogo', catalogoRoutes);               // /api/catalogo
router.use('/importar', importacionesRoutes);          // /api/importar
router.use('/awb', awbController);                     // /api/awb
router.use('/calcular-pesos', calcularPesosRoutes);    // /api/calcular-pesos

module.exports = router;
