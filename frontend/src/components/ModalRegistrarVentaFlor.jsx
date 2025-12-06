import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../services/api';
import { useSession } from '../context/SessionContext';

// Normaliza un registro de factura/pedido (factura_consolidada) a un shape uniforme
function normalizarPedido(x) {
  return {
    idfactura: x.idfactura ?? x.id,
    nombre_cliente: x.nombre_cliente ?? x.cliente ?? `Cliente #${x.idcliente ?? ''}`,
    fecha: x.fecha ?? x.fecha_compra ?? x.fechacompra ?? null,
    codigo: x.codigo ?? x.numero_factura ?? ''
  };
}

// ✅ Sin timezone: lee partes del string YYYY-MM-DD
function buildCodAgrupa(fechaISO, idproducto, idvariedad, idempaque, idlongitud) {
  const [yyyy, mmStr, ddStr] = String(fechaISO).slice(0, 10).split('-');
  const mm = Number(mmStr); // sin cero a la izquierda
  const dd = Number(ddStr);
  const yy = yyyy.slice(-2);
  return `${mm}${dd}${yy}${idproducto}${idvariedad}${idempaque}${idlongitud}`;
}

export default function ModalRegistrarVentaFlorV2({
  visible,
  onClose,
  filaResumen,
  refrescar,
  modoEdicion = false,
  idmix = null
}) {
  const { user } = useSession();

  const [catalogos, setCatalogos] = useState({
    productos: [],
    variedades: [],
    longitudes: [],
    empaques: [],
    tipocajas: [],
    proveedores: []
  });
  const [pedidos, setPedidos] = useState([]); // pedidos (facturas) en proceso
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);

  const [filas, setFilas] = useState([]);
  const [facturaProveedor, setFacturaProveedor] = useState('');
  const [cantidadCajas, setCantidadCajas] = useState(1);
  const [idProveedorSeleccionado, setIdProveedorSeleccionado] = useState('');
  const [idTipoCajaSeleccionado, setIdTipoCajaSeleccionado] = useState('');
  const [cajasIniciales, setCajasIniciales] = useState(1);

  const cargadoRef = useRef(false); // evita dobles cargas al abrir

  const valorEmpaque = (idempaque) => {
    const id = parseInt(idempaque);
    const e = catalogos.empaques.find((emp) => emp.id === id);
    const v = e ? Number(e.valor) : 1;
    return Number.isFinite(v) && v > 0 ? v : 1;
  };

  // Precarga desde la fila del resumen
  const precargarFilaInicial = () => {
    if (!filaResumen) return;

    // Asegurarnos de tener catálogos cargados
    if (
      !catalogos.productos.length ||
      !catalogos.variedades.length ||
      !catalogos.longitudes.length ||
      !catalogos.empaques.length
    ) {
      return;
    }

    // PRODUCTO/VARIEDAD pueden venir como texto; mapeamos a ID usando SOLO 'valor'
    const idProd =
      filaResumen.idproducto ??
      catalogos.productos.find(
        (p) =>
          String(p.valor || '').toLowerCase() === String(filaResumen.producto || '').toLowerCase()
      )?.id ??
      '';

    const idVar =
      filaResumen.idvariedad ??
      catalogos.variedades.find(
        (v) =>
          String(v.valor || '').toLowerCase() === String(filaResumen.variedad || '').toLowerCase()
      )?.id ??
      '';

    // Longitud/Empaque ya vienen como ID en el resumen
    const idLon = filaResumen.idlongitud ?? '';
    const idEmp = filaResumen.idempaque ?? '';

    // Ramos = Inv.Post (entero mín 1)
    const ramosInicial = Math.max(1, Math.round(Number(filaResumen.inv_post || 1)));

    setFilas([
      {
        idproducto: idProd,
        idvariedad: idVar,
        idlongitud: idLon,
        idempaque: idEmp,
        cantidad: 1,
        cantidadRamos: ramosInicial,
        precio_unitario: 0,
        precio_venta: 0
      }
    ]);

    setFacturaProveedor('');
    setCantidadCajas(1);
    setCajasIniciales(1);
    setIdProveedorSeleccionado('');
    setIdTipoCajaSeleccionado('');
    setPedidoSeleccionado(null);
  };

  // Carga catálogos y pedidos en proceso
  const loadAllData = async () => {
    const [productos, variedades, longitudes, empaques, tipocajas, proveedores, pedidosResp] =
      await Promise.all([
        api.get('/api/catalogo?categoria=producto'),
        api.get('/api/catalogo?categoria=variedad'),
        api.get('/api/catalogo?categoria=longitud'),
        api.get('/api/catalogo?categoria=empaque'),
        api.get('/api/catalogo?categoria=tipocaja'),
        api.get('/api/terceros?tipo=proveedor'),
        api.get('/api/facturas/facturas-con-clientes')
      ]);

    const lista = Array.isArray(pedidosResp?.data)
      ? pedidosResp.data
      : Array.isArray(pedidosResp?.data?.rows)
        ? pedidosResp.data.rows
        : [];

    const pedidosProceso = lista
      .filter((f) => String(f.estado || '').toLowerCase() === 'proceso')
      .map(normalizarPedido);

    setCatalogos({
      productos: productos.data || [],
      variedades: variedades.data || [],
      longitudes: longitudes.data || [],
      empaques: empaques.data || [],
      tipocajas: tipocajas.data || [],
      proveedores: proveedores.data || []
    });
    setPedidos(pedidosProceso);

    if (pedidosProceso.length === 1) {
      setPedidoSeleccionado(pedidosProceso[0]);
    }
  };

  // Cargar mix existente (edición)
  const cargarMixExistente = async () => {
    if (!idmix) return;
    const res = await api.get(`/api/caja-mixta/factura-detalle/mix/${idmix}`);
    const data = Array.isArray(res.data) ? res.data : [];
    if (data.length === 0) return;

    setFilas(
      data.map((item) => ({
        idproducto: item.idproducto,
        idvariedad: item.idvariedad,
        idlongitud: item.idlongitud,
        idempaque: item.idempaque,
        cantidad: item.cantidad,
        cantidadRamos: item.cantidadRamos,
        precio_unitario: parseFloat(item.precio_unitario || 0),
        precio_venta: parseFloat(item.precio_venta || 0)
      }))
    );

    const cab = data[0];
    setFacturaProveedor(cab.documento_proveedor || '');
    setCantidadCajas(cab.cantidad || 1);
    setCajasIniciales(cab.cantidad || 1);
    setIdProveedorSeleccionado(cab.idproveedor || '');
    setIdTipoCajaSeleccionado(cab.idtipocaja || '');

    const p = (pedidos || []).find((x) => x.idfactura === (cab.idfactura ?? cab.id));
    setPedidoSeleccionado(p || null);
  };

  // Efecto de apertura del modal
  useEffect(() => {
    if (!visible) {
      cargadoRef.current = false;
      return;
    }
    if (cargadoRef.current) return;
    cargadoRef.current = true;

    (async () => {
      try {
        await loadAllData();
        if (modoEdicion) {
          await cargarMixExistente();
        } else {
          // ✅ precargar DESPUÉS de cargar catálogos
          precargarFilaInicial();
        }
      } catch (e) {
        console.error('❌ Error inicializando modal:', e);
        alert('Error cargando datos iniciales.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, modoEdicion]);

  // Si los catálogos llegan un poco después, reintenta la precarga una vez
  useEffect(() => {
    if (!modoEdicion && visible && filas.length === 0) {
      precargarFilaInicial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogos.productos, catalogos.variedades, catalogos.longitudes, catalogos.empaques]);

  const agregarFila = () =>
    setFilas((prev) => [
      ...prev,
      {
        idproducto: '',
        idvariedad: '',
        idlongitud: '',
        idempaque: '',
        cantidad: 1,
        cantidadRamos: 1,
        precio_unitario: 0,
        precio_venta: 0
      }
    ]);

  const eliminarFila = (index) => setFilas(filas.filter((_, i) => i !== index));

  const actualizarCampo = (index, campo, valor) =>
    setFilas((prev) => prev.map((f, i) => (i === index ? { ...f, [campo]: valor } : f)));

  const calcularTotales = (fila) => {
    const cantidad = Number(fila.cantidad || 0);
    const cantidadRamos = Number(fila.cantidadRamos || 0);
    const precio_unitario = Number(fila.precio_unitario || 0);
    const precio_venta = Number(fila.precio_venta || 0);
    const empaqueValor = valorEmpaque(fila.idempaque);
    const cantidadTallos = cantidad * cantidadRamos * empaqueValor;
    const subtotal = cantidadTallos * precio_unitario;
    const subtotalVenta = cantidadTallos * precio_venta;
    return { cantidadTallos, subtotal, subtotalVenta };
  };

  const guardarVenta = async () => {
    if (!pedidoSeleccionado) return alert('⚠️ Debes seleccionar un pedido');
    if (!facturaProveedor.trim() || !idProveedorSeleccionado || !idTipoCajaSeleccionado)
      return alert('⚠️ Completa todos los campos');

    // Validar filas con IDs completos
    const filasInvalidas = filas.some(
      (f) =>
        !parseInt(f.idproducto) ||
        !parseInt(f.idvariedad) ||
        !parseInt(f.idempaque) ||
        !parseInt(f.idlongitud)
    );
    if (filasInvalidas)
      return alert('⚠️ Completa producto, variedad, empaque y longitud en todas las filas');

    const esSolitario = !modoEdicion && filas.length === 1;

    // ID de movimiento del resumen (se guarda en factura_consolidada_detalle.idpedido)
    const idMovimiento = filaResumen?.idmovimiento ?? null;

    // Fecha para codagrupa en ventas
    const fechaCompra = (pedidoSeleccionado?.fecha || new Date().toISOString()).slice(0, 10);

    const mixItems = filas.map((fila) => {
      const { cantidadTallos, subtotal, subtotalVenta } = calcularTotales({
        ...fila,
        cantidad: cantidadCajas
      });

      const idproducto = parseInt(fila.idproducto);
      const idvariedad = parseInt(fila.idvariedad);
      const idempaque = parseInt(fila.idempaque);
      const idlongitud = parseInt(fila.idlongitud);

      return {
        ...fila,
        cantidad: cantidadCajas,
        idfactura: pedidoSeleccionado.idfactura,
        codigo: pedidoSeleccionado.codigo || '0',
        idpedido: idMovimiento,
        idgrupo: 5,
        idproveedor: parseInt(idProveedorSeleccionado) || null,
        tipo_caja_variedad: parseInt(idTipoCajaSeleccionado) || null,
        documento_proveedor: facturaProveedor.trim(),
        idusuario: user?.id || null,
        fechacompra: fechaCompra,
        cantidadTallos,
        subtotal,
        precio_venta: Number(fila.precio_venta || 0),
        subtotalVenta,
        // ✅ codagrupa con IDs + fecha
        codagrupa: buildCodAgrupa(fechaCompra, idproducto, idvariedad, idempaque, idlongitud)
      };
    });

    // Devolución al editar si reduce cajas
    let devolver = false;
    let cajasDevueltas = 0;
    if (modoEdicion) {
      const dif = (cajasIniciales || 0) - (cantidadCajas || 0);
      if (dif > 0) {
        devolver = window.confirm(`¿Deseas devolver ${dif} caja(s) a la mesa de compras?`);
        cajasDevueltas = dif;
      }
    }

    try {
      const url = modoEdicion
        ? '/api/caja-mixta/factura-detalle/actualizar-mixta'
        : '/api/caja-mixta/factura-detalle/crear-mixta';

      const payload = {
        mixItems,
        iddetalle_original: idmix,
        devolverCajas: devolver,
        cajasDevueltas,
        crearMix: !esSolitario
      };

      await api.post(url, payload);

      alert(
        esSolitario
          ? '✅ Caja sólida guardada.'
          : modoEdicion
            ? '✅ Mix/venta actualizada.'
            : '✅ Mix/venta guardada.'
      );
      refrescar?.();
      onClose();
    } catch (err) {
      console.error('❌ Error al guardar venta:', err);
      alert('❌ Error al guardar la venta');
    }
  };

  if (!visible) return null;

  return createPortal(
    <>
      <div
        className="modal-backdrop"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1399 }}
      />
      <div
        className="modal mix"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1400,
          width: 'min(1100px, 95vw)',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
      >
        <h3>{modoEdicion ? 'Editar Caja Mixta' : 'Crear Caja Mixta'}</h3>

        {/* Header */}
        <div
          style={{
            marginBottom: '10px',
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap'
          }}
        >
          <label>
            Factura Proveedor:{' '}
            <input
              type="text"
              value={facturaProveedor}
              onChange={(e) => setFacturaProveedor(e.target.value)}
              placeholder="Ej: FAC-00123"
            />
          </label>

          <label>
            Cajas a usar:{' '}
            <input
              type="number"
              value={cantidadCajas}
              onChange={(e) => setCantidadCajas(parseFloat(e.target.value) || 1)}
              min={1}
            />
          </label>

          <label>
            Proveedor:{' '}
            <select
              value={idProveedorSeleccionado}
              onChange={(e) => setIdProveedorSeleccionado(e.target.value)}
            >
              <option value="">-- Proveedor --</option>
              {catalogos.proveedores.map((p) => (
                <option key={p.idtercero} value={p.idtercero}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>

          <label>
            Tipo Caja:{' '}
            <select
              value={idTipoCajaSeleccionado}
              onChange={(e) => setIdTipoCajaSeleccionado(e.target.value)}
            >
              <option value="">-- Tipo Caja --</option>
              {catalogos.tipocajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.valor}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Pedido en proceso */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Pedido:</label>
          <select
            value={pedidoSeleccionado?.idfactura || ''}
            onChange={(e) => {
              const id = parseInt(e.target.value);
              const p = (pedidos || []).find((x) => x.idfactura === id);
              setPedidoSeleccionado(p || null);
            }}
            disabled={modoEdicion}
            style={{
              padding: '6px 12px',
              fontSize: '14px',
              minWidth: '500px',
              borderRadius: '6px',
              border: '1px solid #ccc',
              backgroundColor: '#fff',
              color: '#333',
              marginBottom: '8px'
            }}
          >
            <option value="">-- Seleccionar pedido --</option>
            {(pedidos || []).map((p) => (
              <option key={p.idfactura} value={p.idfactura}>
                {p.idfactura} | {p.nombre_cliente} | {(p.fecha || '').slice(0, 10)}
              </option>
            ))}
          </select>
        </div>

        {/* Tabla */}
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Variedad</th>
              <th>Longitud</th>
              <th>Empaque</th>
              <th>Ramos</th>
              <th>P.Compra</th>
              <th>P.Venta</th>
              <th>T.Tallos</th>
              <th>SubCompra</th>
              <th>SubVenta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, index) => {
              const { cantidadTallos, subtotal, subtotalVenta } = calcularTotales(fila);
              return (
                <tr key={index}>
                  <td>
                    <select
                      value={Number(fila.idproducto) || ''}
                      onChange={(e) =>
                        actualizarCampo(index, 'idproducto', parseInt(e.target.value) || '')
                      }
                    >
                      <option value="">--</option>
                      {catalogos.productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.valor}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={Number(fila.idvariedad) || ''}
                      onChange={(e) =>
                        actualizarCampo(index, 'idvariedad', parseInt(e.target.value) || '')
                      }
                    >
                      <option value="">--</option>
                      {catalogos.variedades.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.valor}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={Number(fila.idlongitud) || ''}
                      onChange={(e) =>
                        actualizarCampo(index, 'idlongitud', parseInt(e.target.value) || '')
                      }
                    >
                      <option value="">--</option>
                      {catalogos.longitudes.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.valor}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={Number(fila.idempaque) || ''}
                      onChange={(e) =>
                        actualizarCampo(index, 'idempaque', parseInt(e.target.value) || '')
                      }
                    >
                      <option value="">--</option>
                      {catalogos.empaques.map((em) => (
                        <option key={em.id} value={em.id}>
                          {em.valor}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={fila.cantidadRamos ?? ''}
                      onChange={(e) =>
                        actualizarCampo(index, 'cantidadRamos', parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={fila.precio_unitario ?? ''}
                      onChange={(e) =>
                        actualizarCampo(index, 'precio_unitario', parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={fila.precio_venta ?? ''}
                      onChange={(e) =>
                        actualizarCampo(index, 'precio_venta', parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td>{cantidadTallos}</td>
                  <td>{subtotal.toFixed(2)}</td>
                  <td>{subtotalVenta.toFixed(2)}</td>
                  <td>
                    <button type="button" onClick={() => eliminarFila(index)}>
                      🗑️
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totales */}
        <div style={{ marginTop: '10px', fontWeight: 'bold', textAlign: 'right' }}>
          <div>
            Total tallos:{' '}
            {filas
              .reduce(
                (sum, f) => sum + calcularTotales({ ...f, cantidad: cantidadCajas }).cantidadTallos,
                0
              )
              .toFixed(0)}
          </div>
          <div>
            Subtotal total: $
            {filas
              .reduce(
                (sum, f) => sum + calcularTotales({ ...f, cantidad: cantidadCajas }).subtotal,
                0
              )
              .toFixed(2)}
          </div>
          <div>
            Subtotal venta total: $
            {filas
              .reduce(
                (sum, f) => sum + calcularTotales({ ...f, cantidad: cantidadCajas }).subtotalVenta,
                0
              )
              .toFixed(2)}
          </div>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <button type="button" onClick={agregarFila}>
            + Agregar Variedad
          </button>
          <button type="button" onClick={guardarVenta}>
            {modoEdicion ? 'Actualizar Mix' : 'Guardar Mix'}
          </button>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
