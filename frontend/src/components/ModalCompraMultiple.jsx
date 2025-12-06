import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useSession } from '../context/SessionContext';
import '../assets/style.css';
import socket from '../socket/socket';

function ModalCompraMultiple({ registros = [], onClose, onCompraExitosa }) {
  const { user } = useSession();
  const [compras, setCompras] = useState([]);
  const [catalogo, setCatalogo] = useState([]);

  // ✅ Cargar catálogo y precargar compras
  useEffect(() => {
    api
      .get('/api/catalogo/todo')
      .then((res) => {
        const catalogoCompleto = res.data || [];
        setCatalogo(catalogoCompleto);

        const inicial = (registros || []).map((r) => {
          const cantidad = Number(r.cantidad) || 1;
          const tallosPorCaja = Number(r.tallos) || 0;
          const empaqueValor = parseFloat(
            catalogoCompleto.find((c) => c.id === r.idempaque)?.valor || '1'
          );
          const precio = parseFloat(r.precio_unitario) || 0.35;

          const cantidadTallos = cantidad * tallosPorCaja;
          const cantidadRamos = empaqueValor > 0 ? cantidadTallos / empaqueValor / cantidad : 0;
          const subtotal = cantidadTallos * precio;

          return {
            ...r,
            idproducto: r.idproducto || '',
            idvariedad: r.idvariedad || '',
            idlongitud: r.idlongitud || '',
            idempaque: r.idempaque || '',
            idtipocaja: r.idtipocaja || '',
            cantidad,
            precio_unitario: r.precio_unitario || '0.35',
            cantidadRamos: cantidadRamos.toFixed(2),
            cantidadTallos,
            subtotal: subtotal.toFixed(2),
            idmix: null,
            gramaje: r.gramaje || null
          };
        });

        setCompras(inicial);
      })
      .catch((err) => {
        console.error('❌ Error al cargar catálogo:', err);
        setCatalogo([]);
      });
  }, [registros]);

  // ✅ Helpers
  const getOpciones = (categoria) => catalogo.filter((c) => c.categoria === categoria);
  const getValorPorId = (id) => {
    const item = catalogo.find((c) => c.id === parseInt(id));
    return item ? parseFloat(item.valor) : 0;
  };

  // ✅ Handle cambios de campos
  const handleCambio = (index, campo, valor) => {
    setCompras((prev) => {
      const actualizado = [...prev];
      const compra = actualizado[index];

      if (campo === 'cantidad') {
        const nuevaCantidad = parseFloat(valor) || 0;
        if (nuevaCantidad > (registros[index].cantidad || 0)) {
          alert(`⚠️ No puedes comprar más de ${registros[index].cantidad} cajas.`);
          return prev;
        }
        compra[campo] = nuevaCantidad;
      } else {
        compra[campo] = valor;
      }

      const cantidad = parseFloat(compra.cantidad || 0);
      const tallos = parseFloat(compra.tallos || 0);
      const precio = parseFloat(compra.precio_unitario || 0);
      const empaque = getValorPorId(compra.idempaque) || 1;

      const cantidadTallos = cantidad * tallos;
      const cantidadRamos = empaque > 0 && cantidad > 0 ? cantidadTallos / empaque / cantidad : 0;
      const subtotal = cantidadTallos * precio;

      compra.cantidadTallos = cantidadTallos;
      compra.cantidadRamos = cantidadRamos.toFixed(2);
      compra.subtotal = subtotal.toFixed(2);

      return actualizado;
    });
  };

  const validarCampos = (compra) => {
    const obligatorios = [
      'idfactura',
      'idpedido',
      'codigo',
      'idproveedor',
      'idproducto',
      'idvariedad',
      'idlongitud',
      'idempaque',
      'idtipocaja',
      'cantidad',
      'precio_unitario',
      'cantidadTallos',
      'cantidadRamos',
      'subtotal',
      'tallos'
    ];
    return obligatorios.every(
      (c) => compra[c] !== undefined && compra[c] !== null && compra[c] !== ''
    );
  };

  // ✅ Guardar compras (principal)
  const guardarCompras = async (comoMixta = false) => {
    const completas = compras.every(validarCampos);
    if (!completas) {
      alert('❌ Todos los campos deben estar completos para guardar.');
      return;
    }

    try {
      // ✅ Preparar datos
      const comprasAEnviar = compras.map((c) => {
        const pedidoOriginal = registros.find((r) => r.idpedido === c.idpedido) || {};
        return {
          ...c,
          idusuario: user?.id || 1,
          idmix: comoMixta ? c.idpedido : null,
          tallos: pedidoOriginal.tallos || 0,
          idOrder: pedidoOriginal.idOrder || null,
          gramaje: c.gramaje || null
        };
      });

      // ✅ Enviar al backend
      const res = await api.post('/api/facturas/confirmar-compras-multiples', comprasAEnviar, {
        headers: {
          Authorization: `Bearer ${user.token}`
        }
      });

      const { actualizados, idsEliminados } = res.data;

      // ✅ Emitir a TODOS los datos reales
      socket.emit('pedidos:actualizados', {
        actualizados,
        idsEliminados
      });

      alert('✅ Compras guardadas con éxito');
      onCompraExitosa?.(actualizados, idsEliminados);
      onClose();
    } catch (err) {
      console.error('❌ Error al guardar compras:', err);
      alert('Error al guardar compras');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal mix">
        <h3>🛒 Confirmar Compras Múltiples</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Producto</th>
              <th>Variedad</th>
              <th>Longitud</th>
              <th>Empaque</th>
              <th>Tipo Caja</th>
              <th>Cantidad</th>
              <th>Tallos</th>
              <th>Precio Unitario</th>
              <th>Ramos</th>
              <th>Total Tallos</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c, i) => (
              <tr key={i}>
                <td>{c.idpedido}</td>
                <td>
                  <select
                    value={c.idproducto || ''}
                    onChange={(e) => handleCambio(i, 'idproducto', e.target.value)}
                  >
                    <option value="">-- Producto --</option>
                    {getOpciones('producto').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={c.idvariedad || ''}
                    onChange={(e) => handleCambio(i, 'idvariedad', e.target.value)}
                  >
                    <option value="">-- Variedad --</option>
                    {getOpciones('variedad').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={c.idlongitud || ''}
                    onChange={(e) => handleCambio(i, 'idlongitud', e.target.value)}
                  >
                    <option value="">-- Longitud --</option>
                    {getOpciones('longitud').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={c.idempaque || ''}
                    onChange={(e) => handleCambio(i, 'idempaque', e.target.value)}
                  >
                    <option value="">-- Empaque --</option>
                    {getOpciones('empaque').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={c.idtipocaja || ''}
                    onChange={(e) => handleCambio(i, 'idtipocaja', e.target.value)}
                  >
                    <option value="">-- Tipo Caja --</option>
                    {getOpciones('tipocaja').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    value={c.cantidad || ''}
                    onChange={(e) => handleCambio(i, 'cantidad', e.target.value)}
                  />
                </td>
                <td>{c.tallos}</td>
                <td>
                  <input
                    type="number"
                    value={c.precio_unitario || ''}
                    onChange={(e) => handleCambio(i, 'precio_unitario', e.target.value)}
                  />
                </td>
                <td>{c.cantidadRamos}</td>
                <td>{c.cantidadTallos}</td>
                <td>{c.subtotal}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: '20px' }}>
          <button onClick={() => guardarCompras(false)}>✅ Guardar</button>
          <button onClick={() => guardarCompras(true)} style={{ marginLeft: '10px' }}>
            🧃 Guardar como mixta
          </button>
          <button onClick={onClose} style={{ marginLeft: '10px' }}>
            ❌ Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalCompraMultiple;
