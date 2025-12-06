import { useEffect, useState, useRef, useCallback } from 'react';
import api from '../services/api';
import PedidosGrid from './PedidosGrid';
import ModalCompraMultiple from './ModalCompraMultiple';
import ModalCajaMixtaPedidos from './ModalCajaMixtaPedidos';
import socket from '../socket/socket';
import { useSession } from '../context/SessionContext';
import ModalAgregarPedidos from './ModalAgregarPedidos';

function PedidosLista() {
  const { user } = useSession();
  const [clientes, setClientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [mostrarModalCompra, setMostrarModalCompra] = useState(false);
  const [modalRegistros, setModalRegistros] = useState([]);
  const [mostrarModalMixta, setMostrarModalMixta] = useState(false);
  const [pedidoParaMixta, setPedidoParaMixta] = useState(null);
  const [idsEnCompra, setIdsEnCompra] = useState([]);
  const [mostrarModalAgregarPedidos, setMostrarModalAgregarPedidos] = useState(false);
  const [facturas, setFacturas] = useState([]);

  const apiRef = useRef(null);

  // ✅ 1️⃣ Carga inicial
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [resClientes, resProveedores, resCatalogo, resFacturas] = await Promise.all([
        api.get('/api/terceros?tipo=cliente'),
        api.get('/api/terceros?tipo=proveedor'),
        api.get('/api/catalogo/todo'),
        api.get('/api/facturas/facturas-con-clientes')
      ]);
      setClientes(resClientes.data);
      setProveedores(resProveedores.data);
      setCatalogo(resCatalogo.data);
      setFacturas(resFacturas.data || []);

      const resPedidos = await api.get('/api/pedidos');
      setRows(
        resPedidos.data
          .map((r) => ({ ...r, id: Number(r.idpedido) }))
          .filter((r) => Number(r.cantidad) > 0) // 🔥 Filtrado inicial
          .sort((a, b) => b.id - a.id)
      );
    } catch (err) {
      console.error('❌ Error al obtener datos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ✅ 2️⃣ Socket listeners
  useEffect(() => {
    const handleBloqueoUpdate = (bloqueos) => {
      setRows((prev) =>
        prev.map((p) =>
          bloqueos[p.id] ? { ...p, editando_por: bloqueos[p.id] } : { ...p, editando_por: null }
        )
      );
    };

    const handlePedidosActualizados = ({ actualizados = [], idsEliminados = [] }) => {
      setRows((prev) => {
        // 1️⃣ Eliminar registros marcados para eliminación
        let nueva = prev.filter((r) => !idsEliminados.includes(Number(r.id)));

        // 2️⃣ Mergear actualizados
        const idsExistentes = new Set(nueva.map((r) => Number(r.id)));

        actualizados.forEach((nuevo) => {
          const idNum = Number(nuevo.id);
          if (idsExistentes.has(idNum)) {
            nueva = nueva.map((r) =>
              Number(r.id) === idNum
                ? { ...r, ...nuevo, editando_por: r.editando_por } // ✅ Mantiene bloqueo intacto
                : r
            );
          } else {
            nueva.push({ ...nuevo, id: idNum });
          }
        });

        // 3️⃣ FILTRO FINAL silencioso: eliminar registros con cantidad <= 0
        return nueva.filter((r) => Number(r.cantidad) > 0).sort((a, b) => b.id - a.id);
      });
    };

    socket.on('bloqueo:pedido:update', handleBloqueoUpdate);
    socket.on('pedidos:actualizados', handlePedidosActualizados);

    return () => {
      socket.off('bloqueo:pedido:update', handleBloqueoUpdate);
      socket.off('pedidos:actualizados', handlePedidosActualizados);
    };
  }, []);

  // ✅ 3️⃣ Forzar selección
  const forzarSeleccionados = async (ids, bloquear) => {
    if (!user?.id || !Array.isArray(ids)) {
      console.warn('⚠️ Parámetros inválidos en forzarSeleccionados', { ids, bloquear, user });
      return;
    }

    try {
      if (bloquear) {
        await api.post('/api/pedidos/marcar-seleccionado', { ids, idusuario: user.id });
      } else {
        await api.post('/api/pedidos/desmarcar-seleccionado', { ids, idusuario: user.id });
      }
    } catch (err) {
      console.error('❌ Error al actualizar bloqueo en base:', err);
    }

    socket.emit('bloqueo:pedido:multiple', { idpedidos: ids, bloquear, idusuario: user.id });
  };

  const cargandoTodo = loading || !catalogo.length || !clientes.length || !proveedores.length;

  // ✅ 4️⃣ Modal de compra
  const handleAbrirModalCompra = () => {
    if (!apiRef.current) return alert('⚠️ Tabla no disponible.');

    const seleccionadosIds = Array.from(apiRef.current.getSelectedRows().keys());
    const seleccionados = rows.filter((row) => seleccionadosIds.includes(Number(row.id)));

    if (!seleccionados.length) return alert('⚠️ No hay pedidos seleccionados.');

    const faltantes = seleccionados.flatMap((item) =>
      [
        'idproveedor',
        'idproducto',
        'idvariedad',
        'idlongitud',
        'idempaque',
        'idtipocaja',
        'precio_unitario',
        'cantidad',
        'tallos'
      ]
        .filter((campo) => item[campo] === undefined || item[campo] === null || item[campo] === '')
        .map((campo) => `• ID ${item.idpedido}: falta campo "${campo}"`)
    );

    if (faltantes.length > 0)
      return alert(`⚠️ Los siguientes campos faltan:\n\n${faltantes.join('\n')}`);

    forzarSeleccionados(seleccionadosIds, true);
    setIdsEnCompra(seleccionados.map((r) => r.id));
    setModalRegistros(seleccionados);
    setMostrarModalCompra(true);
  };

  const handleAgregarPedidos = async (datos) => {
    try {
      let nuevos = [];

      // ✅ Ya vienen completos desde el modal
      if (Array.isArray(datos)) {
        nuevos = datos;
      }

      if (!nuevos.length) {
        alert('⚠️ No hay datos válidos para agregar.');
        return;
      }

      for (const pedido of nuevos) {
        await api.post('/api/pedidos', pedido);
      }

      alert('✅ Pedidos guardados en base de datos correctamente.');
      setMostrarModalAgregarPedidos(false);
      await fetchData();
    } catch (err) {
      console.error('❌ Error al guardar pedidos:', err);
      alert('❌ Error al guardar pedidos en base de datos');
    }
  };

  const eliminarSeleccionados = async () => {
    if (!apiRef.current) return alert('⚠️ Tabla no disponible.');

    const idsSeleccionados = Array.from(apiRef.current.getSelectedRows().keys());
    if (!idsSeleccionados.length) return alert('⚠️ No hay pedidos seleccionados.');

    if (!window.confirm('¿Seguro que deseas eliminar los pedidos seleccionados?')) return;

    try {
      await api.delete('/api/pedidos/multiples', { data: { ids: idsSeleccionados } });
      alert('✅ Pedidos eliminados correctamente');
      forzarSeleccionados(idsSeleccionados, false);
      fetchData();
    } catch (err) {
      console.error('❌ Error al eliminar pedidos:', err);
      alert('❌ Error al eliminar pedidos');
    }
  };

  // ✅ 6️⃣ Modales
  const onCompraExitosa = (actualizados = [], idsEliminados = []) => {
    forzarSeleccionados(idsEnCompra, false);
    setMostrarModalCompra(false);

    const eliminadosSet = new Set((idsEliminados || []).map(Number));
    const actualizadosVivos = actualizados.filter((a) => a.cantidad > 0);

    setRows((prev) => {
      let nueva = prev.filter((r) => !eliminadosSet.has(Number(r.id)));

      const idsExistentes = new Set(nueva.map((r) => Number(r.id)));
      actualizadosVivos.forEach((nuevo) => {
        const idNum = Number(nuevo.id);
        if (idsExistentes.has(idNum)) {
          nueva = nueva.map((r) => (Number(r.id) === idNum ? { ...r, ...nuevo } : r));
        } else {
          nueva.push({ ...nuevo, id: idNum });
        }
      });

      // 🔥 Limpieza final silenciosa
      return nueva.filter((r) => Number(r.cantidad) > 0).sort((a, b) => b.id - a.id);
    });
  };

  const manejarCompraMixta = () => {
    if (!apiRef.current) return alert('⚠️ Tabla no disponible.');

    const idsSeleccionados = Array.from(apiRef.current.getSelectedRows().keys());
    if (idsSeleccionados.length !== 1)
      return alert('⚠️ Debes seleccionar exactamente un pedido para compra mixta.');

    const pedido = rows.find((p) => p.id === Number(idsSeleccionados[0]));
    if (!pedido) return alert('⚠️ No se encontró el pedido.');

    const faltantes = [
      'idproducto',
      'idvariedad',
      'idlongitud',
      'idempaque',
      'idtipocaja',
      'precio_unitario',
      'cantidad',
      'tallos'
    ].filter((campo) => !pedido[campo] && pedido[campo] !== 0);

    if (faltantes.length > 0) {
      alert(`⚠️ El pedido seleccionado tiene campos incompletos:\n\n• ${faltantes.join('\n• ')}`);
      return;
    }

    forzarSeleccionados([pedido.id], true);
    setPedidoParaMixta(pedido);
    setMostrarModalMixta(true);
  };

  useEffect(() => {
    const limpiarBloqueos = async () => {
      if (!user?.id) return;
      try {
        await api.post('/api/pedidos/desmarcar-todos-usuario', { idusuario: user.id });
        socket.emit('bloqueo:pedido:clear', { idusuario: user.id });
      } catch (err) {
        console.error('❌ Error limpiando bloqueos al salir:', err);
      }
    };

    window.addEventListener('beforeunload', limpiarBloqueos);
    return () => window.removeEventListener('beforeunload', limpiarBloqueos);
  }, [user]);

  const handleCalcularPesos = async () => {
    try {
      const response = await fetch('/api/pedidos/calcular-pesos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok) {
        alert(data.message || '✅ Pesos actualizados correctamente');
        await fetchData();
      } else {
        alert(data.error || '❌ Error al calcular pesos');
      }
    } catch (error) {
      console.error('❌ Error al calcular pesos:', error);
      alert('❌ Error de red o del servidor');
    }
  };

  // ✅ 7️⃣ Render
  return (
    <div>
      <h3>📋 Pedidos migrados</h3>
      {cargandoTodo ? (
        <div className="loader-wrapper">
          <div className="spinner"></div>
          <div className="loader-text">⏳ Cargando datos completos...</div>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '10px' }}>
            <button onClick={handleAbrirModalCompra}>🛒 Comprar seleccionados</button>
            <button
              onClick={() => setMostrarModalAgregarPedidos(true)}
              style={{ marginLeft: '10px' }}
            >
              ➕ Agregar pedidos
            </button>

            <button
              className="btn-eliminar"
              onClick={eliminarSeleccionados}
              style={{ marginLeft: '10px' }}
            >
              🗑️ Eliminar seleccionados
            </button>
            <button onClick={manejarCompraMixta} style={{ marginLeft: '10px' }}>
              🧃 Comprar como mixta
            </button>
            <button onClick={handleCalcularPesos} style={{ marginLeft: '10px' }}>
              🧮 Calcular pesos
            </button>
          </div>

          <PedidosGrid
            apiRefExtern={apiRef}
            catalogo={catalogo}
            clientes={clientes}
            proveedores={proveedores}
            rows={rows}
            setRows={setRows}
            forzarSeleccionados={forzarSeleccionados}
          />
        </>
      )}

      {mostrarModalCompra && modalRegistros.length > 0 && (
        <ModalCompraMultiple
          registros={modalRegistros}
          onClose={() => {
            const ids = modalRegistros.map((r) => r.id);
            forzarSeleccionados(ids, false);
            setMostrarModalCompra(false);
          }}
          onCompraExitosa={onCompraExitosa}
        />
      )}

      {mostrarModalMixta && pedidoParaMixta && (
        <ModalCajaMixtaPedidos
          visible={true}
          pedidoOriginal={pedidoParaMixta}
          catalogo={catalogo}
          onClose={() => {
            forzarSeleccionados([pedidoParaMixta.id], false);
            setMostrarModalMixta(false);
          }}
          onGuardado={() => {
            forzarSeleccionados([pedidoParaMixta.id], false);
            setMostrarModalMixta(false);
            fetchData();
          }}
        />
      )}
      {mostrarModalAgregarPedidos && (
        <ModalAgregarPedidos
          facturas={facturas}
          catalogo={catalogo}
          onAgregar={handleAgregarPedidos}
          onClose={() => setMostrarModalAgregarPedidos(false)}
        />
      )}
    </div>
  );
}

export default PedidosLista;
