import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useSession } from '../context/SessionContext';
import '../assets/style.css';

function ModalCajaMixtaPedidos({ visible, onClose, pedidoOriginal, catalogo, onGuardado }) {
  const { user } = useSession();
  const [mixItems, setMixItems] = useState([]);
  const [cajas, setCajas] = useState(1);
  const [totalTallos, setTotalTallos] = useState(0);

  const getValorNumerico = useCallback(
    (id) => {
      const item = catalogo.find((c) => c.id === parseInt(id));
      return item ? parseFloat(item.valor) : 0;
    },
    [catalogo]
  );

  const calcularRamosDesdeTallos = useCallback(
    (totalTallos, idempaque) => {
      const valorEmpaque = getValorNumerico(idempaque);
      if (!valorEmpaque || !totalTallos) return 1;
      return Math.round(totalTallos / valorEmpaque);
    },
    [getValorNumerico]
  );

  useEffect(() => {
    if (visible && pedidoOriginal) {
      const filaInicial = {
        idproducto: pedidoOriginal.idproducto || '',
        idvariedad: pedidoOriginal.idvariedad || '',
        idlongitud: pedidoOriginal.idlongitud || '',
        idempaque: pedidoOriginal.idempaque || '',
        idtipocaja: pedidoOriginal.idtipocaja || '',
        cantidadRamos: calcularRamosDesdeTallos(
          pedidoOriginal.totaltallos,
          pedidoOriginal.idempaque
        ),
        precio_unitario: '',
        cantidadTallos: 0,
        subtotal: 0
      };
      setMixItems([filaInicial]);
      setCajas(1);
    }
  }, [visible, pedidoOriginal, calcularRamosDesdeTallos]);

  const calcularTotalTallos = useCallback(() => {
    const total = mixItems.reduce((acc, item) => {
      const ramos = parseInt(item.cantidadRamos) || 0;
      const empaque = getValorNumerico(item.idempaque);
      return acc + cajas * ramos * empaque;
    }, 0);
    setTotalTallos(total);
  }, [mixItems, cajas, getValorNumerico]);

  useEffect(() => {
    calcularTotalTallos();
  }, [calcularTotalTallos]);

  const crearFilaInicial = () => ({
    idproducto: '',
    idvariedad: '',
    idlongitud: '',
    idempaque: '',
    idtipocaja: '',
    cantidadRamos: 1,
    precio_unitario: '',
    cantidadTallos: 0,
    subtotal: 0
  });

  const getOpciones = (categoria) => catalogo.filter((c) => c.categoria === categoria);

  const handleCambio = (index, campo, valor) => {
    setMixItems((prev) => {
      const actual = [...prev];
      actual[index][campo] = valor;

      const { cantidadRamos = 1, idempaque = '' } = actual[index];
      const empaque = getValorNumerico(idempaque);
      const totalTallos = cajas * cantidadRamos * (empaque || 1);
      const precio = parseFloat(actual[index].precio_unitario || 0);
      const subtotal = totalTallos * precio;

      actual[index].cantidadTallos = totalTallos;
      actual[index].subtotal = subtotal.toFixed(2);
      return actual;
    });
  };

  const agregarFila = () => {
    setMixItems((prev) => [...prev, crearFilaInicial()]);
  };

  const eliminarFila = (index) => {
    setMixItems((prev) => prev.filter((_, i) => i !== index));
  };

  const hayCamposVacios = mixItems.some(
    (item) =>
      !item.idproducto ||
      !item.idvariedad ||
      !item.idlongitud ||
      !item.idempaque ||
      !item.idtipocaja ||
      !item.precio_unitario
  );

  const guardarMix = async () => {
    const saldoDisponible = pedidoOriginal.cantidad || 0;
    const tallosDisponibles = pedidoOriginal.totaltallos || 0;

    if (cajas > saldoDisponible) {
      alert(
        `❌ Has ingresado ${cajas} cajas, pero el pedido solo tiene ${saldoDisponible} disponibles.`
      );
      return;
    }

    if (totalTallos > tallosDisponibles) {
      alert(
        `❌ Estás usando ${totalTallos} tallos, pero el pedido solo tiene ${tallosDisponibles} disponibles.`
      );
      return;
    }

    const dataAEnviar = mixItems.map((item) => ({
      idfactura: pedidoOriginal.idfactura,
      codigo: pedidoOriginal.codigo,
      idproveedor: pedidoOriginal.idproveedor,
      idpedido: pedidoOriginal.idpedido,
      idusuario: user?.id || 1,
      idproducto: parseInt(item.idproducto),
      idvariedad: parseInt(item.idvariedad),
      idlongitud: parseInt(item.idlongitud),
      idempaque: parseInt(item.idempaque),
      idtipocaja: parseInt(item.idtipocaja),
      cantidad: cajas,
      cantidadRamos: Number(item.cantidadRamos),
      cantidadTallos: Number(item.cantidadTallos),
      precio_unitario: Number(item.precio_unitario),
      subtotal: Number(item.subtotal),
      idOrder: pedidoOriginal.idOrder
    }));

    try {
      const res = await api.post('/api/caja-mixta-pedidos/crear-mixta', {
        idpedido_original: pedidoOriginal.idpedido,
        totalOriginal: saldoDisponible,
        totaltallosOriginal: tallosDisponibles,
        tallosUsados: totalTallos,
        cajasCompradasTotales: cajas,
        mixItems: dataAEnviar
      });

      alert(res.data.message || '✅ Caja mixta guardada');
      onGuardado?.();
      onClose();
    } catch (err) {
      console.error('❌ Error al guardar caja mixta:', err);
      alert('Error al guardar caja mixta');
    }
  };

  if (!visible) return null;

  return (
    <div className="modal-overlay">
      <div className="modal mix">
        <h3>🧃 Crear Caja Mixta</h3>

        <div className="form-group">
          <label>Cajas a usar (máx {pedidoOriginal.cantidad})</label>
          <input
            type="number"
            min={1}
            max={pedidoOriginal.cantidad}
            value={cajas}
            onChange={(e) =>
              setCajas(Math.min(parseInt(e.target.value) || 1, pedidoOriginal.cantidad))
            }
          />
        </div>

        <div className="form-group">
          <label>Total tallos usados</label>
          <input type="number" value={totalTallos} disabled />
        </div>

        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Variedad</th>
              <th>Longitud</th>
              <th>Empaque</th>
              <th>Tipo Caja</th>
              <th>Ramos</th>
              <th>Precio U.</th>
              <th>Total Tallos</th>
              <th>Subtotal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mixItems.map((item, i) => (
              <tr key={i}>
                <td>
                  <select
                    value={item.idproducto}
                    onChange={(e) => handleCambio(i, 'idproducto', e.target.value)}
                  >
                    <option value="">--</option>
                    {getOpciones('producto').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={item.idvariedad}
                    onChange={(e) => handleCambio(i, 'idvariedad', e.target.value)}
                  >
                    <option value="">--</option>
                    {getOpciones('variedad').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={item.idlongitud}
                    onChange={(e) => handleCambio(i, 'idlongitud', e.target.value)}
                  >
                    <option value="">--</option>
                    {getOpciones('longitud').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={item.idempaque}
                    onChange={(e) => handleCambio(i, 'idempaque', e.target.value)}
                  >
                    <option value="">--</option>
                    {getOpciones('empaque').map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.valor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={item.idtipocaja}
                    onChange={(e) => handleCambio(i, 'idtipocaja', e.target.value)}
                  >
                    <option value="">--</option>
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
                    value={item.cantidadRamos}
                    onChange={(e) => handleCambio(i, 'cantidadRamos', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={item.precio_unitario}
                    onChange={(e) => handleCambio(i, 'precio_unitario', e.target.value)}
                  />
                </td>
                <td>{item.cantidadTallos}</td>
                <td>{item.subtotal}</td>
                <td>
                  <button onClick={() => eliminarFila(i)} className="btn-peligro">
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: '15px' }}>
          <button onClick={agregarFila} className="btn-secundario">
            + Agregar Variedad
          </button>
          <button
            onClick={guardarMix}
            className="btn-principal"
            style={{ marginLeft: '10px' }}
            disabled={
              hayCamposVacios ||
              cajas > pedidoOriginal.cantidad ||
              totalTallos > pedidoOriginal.totaltallos
            }
          >
            ✅ Guardar Mix
          </button>
          <button onClick={onClose} className="btn-peligro" style={{ marginLeft: '10px' }}>
            ❌ Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalCajaMixtaPedidos;
