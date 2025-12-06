const { Server } = require('socket.io');
const db = require('../db');
const facturasBloqueadas = {}; // Se define aquí global para el contexto de conexiones

function configurarSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: ['https://mesa-compras-production.up.railway.app', 'http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    // 🔐 Identificar al usuario que se conecta
    socket.on('identificarse', ({ idusuario }) => {
      if (idusuario) {
        socket.data.idusuario = idusuario;
      }
    });

    // 🔒 Bloqueo individual de pedidos
    socket.on('bloqueo:pedido', async ({ idpedido, bloquear, idusuario }) => {
      if (!idpedido || (bloquear && !idusuario)) {
        console.warn('⚠️ Datos incompletos en bloqueo:pedido:', { idpedido, bloquear, idusuario });
        return;
      }

      try {
        await db.query('UPDATE pedidos SET editando_por = ? WHERE idpedido = ?', [
          bloquear ? idusuario : null,
          idpedido
        ]);

        io.emit('bloqueo:pedido:update', {
          idpedido,
          editando_por: bloquear ? idusuario : null
        });
      } catch (err) {
        console.error('❌ Error en bloqueo individual:', err);
      }
    });

    // 🔒 Bloqueo múltiple de pedidos
    socket.on('bloqueo:pedido:multiple', async ({ idpedidos, bloquear, idusuario }) => {
      if (!Array.isArray(idpedidos) || !idusuario) {
        console.warn('⚠️ Datos inválidos en bloqueo múltiple:', { idpedidos, bloquear, idusuario });
        return;
      }

      try {
        if (idpedidos.length) {
          const placeholders = idpedidos.map(() => '?').join(',');
          const sql = `UPDATE pedidos SET editando_por = ${bloquear ? '?' : 'NULL'} WHERE idpedido IN (${placeholders})`;
          const params = bloquear ? [idusuario, ...idpedidos] : [...idpedidos];
          await db.query(sql, params);
        }

        const bloqueos = {};
        idpedidos.forEach((id) => {
          bloqueos[id] = bloquear ? idusuario : null;
        });

        socket.broadcast.emit('bloqueo:pedido:update', bloqueos);
      } catch (err) {
        console.error('❌ Error en bloqueo múltiple:', err);
      }
    });

    // 🔒 Bloqueo de facturas
    socket.on('bloqueo:factura', ({ idfactura, idusuario, bloqueado }) => {
      if (bloqueado) {
        facturasBloqueadas[idfactura] = idusuario;
      } else {
        delete facturasBloqueadas[idfactura];
      }

      io.emit('bloqueo:factura:update', facturasBloqueadas);
    });

    // 🔴 Liberar bloqueos al desconectar
    socket.on('disconnect', async () => {
      const idusuario = socket.data?.idusuario;

      if (idusuario) {
        // liberar pedidos
        try {
          const [result] = await db.query('SELECT idpedido FROM pedidos WHERE editando_por = ?', [
            idusuario
          ]);
          const pedidosLiberados = result.map((r) => r.idpedido);

          await db.query('UPDATE pedidos SET editando_por = NULL WHERE editando_por = ?', [
            idusuario
          ]);

          pedidosLiberados.forEach((idpedido) => {
            io.emit('bloqueo:pedido:update', {
              idpedido,
              editando_por: null
            });
          });
        } catch (err) {
          console.error('❌ Error al liberar pedidos al desconectarse:', err);
        }

        // liberar facturas
        for (const [idfactura, usuario] of Object.entries(facturasBloqueadas)) {
          if (usuario === idusuario) {
            delete facturasBloqueadas[idfactura];
          }
        }

        io.emit('bloqueo:factura:update', facturasBloqueadas);
      } else {
        console.log('⚠️ Cliente se desconectó sin identificarse.');
      }
    });

    // 🔄 Broadcast manual desde el cliente para actualizar pedidos
    socket.on('pedidos:actualizados', (payload) => {
      const { actualizados = [], idsEliminados = [] } = payload || {};

      if (!Array.isArray(actualizados) || !Array.isArray(idsEliminados)) {
        console.warn('⚠️ Formato inválido en pedidos:actualizados', payload);
        return;
      }

      io.emit('pedidos:actualizados', {
        actualizados,
        idsEliminados
      });
    });
  });

  return io;
}

module.exports = configurarSockets;
