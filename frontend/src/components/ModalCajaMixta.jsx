import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useSession } from '../context/SessionContext';

const ModalCajaMixta = ({
  visible,
  onClose,
  detalleOriginal,
  refrescar,
  modoEdicion = false,
  idmix = null
}) => {
  const [filas, setFilas] = useState([]);
  const { user } = useSession();

  const [facturaProveedor, setFacturaProveedor] = useState('');
  const [cantidadCajas, setCantidadCajas] = useState(1);

  // 🆕 Guía master (HAWB) oculta
  const [guiaMaster, setGuiaMaster] = useState('');

  const [catalogos, setCatalogos] = useState({
    productos: [],
    variedades: [],
    longitudes: [],
    empaques: [],
    tipocajas: [],
    proveedores: []
  });

  const [defaults, setDefaults] = useState({ productoId: '', empaqueId: '' });

  const [idpedidoOriginal, setIdpedidoOriginal] = useState(null);
  const [idProveedorSeleccionado, setIdProveedorSeleccionado] = useState('');
  const [idTipoCajaSeleccionado, setIdTipoCajaSeleccionado] = useState('');

  const valorEmpaque = useCallback(
    (idempaque) => {
      const e = catalogos.empaques.find((emp) => emp.id === parseInt(idempaque));
      return e ? parseFloat(e.valor) : 1;
    },
    [catalogos.empaques]
  );

  const cargarMixExistente = useCallback(async () => {
    if (!idmix || !detalleOriginal?.idfactura) return;

    try {
      const res = await api.get(`/api/caja-mixta/factura-detalle/mix/${idmix}`, {
        params: { idfactura: detalleOriginal.idfactura } // 👈 AQUÍ
      });

      setFilas(
        res.data.map((item) => ({
          ...item,
          codigo: item.codigo || '',
          precio_unitario: parseFloat(item.precio_unitario || 0),
          precio_venta: parseFloat(item.precio_venta || 0),
          subtotalVenta: parseFloat(item.subtotalVenta || 0),
          cantidad: item.cantidad,
          cantidadRamos: item.cantidadRamos
        }))
      );

      // 🧾 Doc.Pro + guía master desde la mix existente
      setFacturaProveedor(res.data[0]?.documento_proveedor || '');
      setGuiaMaster(res.data[0]?.guia_master || '');
      setCantidadCajas(res.data[0]?.cantidad || 1);
      setIdpedidoOriginal(idmix);
      setIdProveedorSeleccionado(res.data[0]?.idproveedor || '');
      setIdTipoCajaSeleccionado(res.data[0]?.idtipocaja || '');
    } catch (err) {
      console.error('❌ Error cargando mix existente:', err);
    }
  }, [idmix, detalleOriginal?.idfactura]);

  const precargarFilaInicial = useCallback(() => {
    if (!detalleOriginal) return;
    setFilas([
      {
        codigo: detalleOriginal.codigo || '',
        idproducto: detalleOriginal.idproducto || '',
        idvariedad: detalleOriginal.idvariedad || '',
        idlongitud: detalleOriginal.idlongitud || '',
        idempaque: detalleOriginal.idempaque || '',
        cantidad: detalleOriginal.cantidad || 1,
        cantidadRamos: detalleOriginal.cantidadRamos || 1,
        precio_unitario: parseFloat(detalleOriginal.precio_unitario || 0),
        precio_venta: parseFloat(detalleOriginal.precio_venta || 0)
      }
    ]);

    // 🧾 Doc.Pro + guía master desde el detalle original (sólida → mixta)
    setFacturaProveedor(detalleOriginal.documento_proveedor || '');
    setGuiaMaster(detalleOriginal.guia_master || '');

    setCantidadCajas(detalleOriginal.cantidad || 1);
    setIdpedidoOriginal(detalleOriginal.iddetalle || null);
    setIdProveedorSeleccionado(detalleOriginal.idproveedor || '');
    setIdTipoCajaSeleccionado(detalleOriginal.idtipocaja || '');
  }, [detalleOriginal]);

  useEffect(() => {
    if (!visible) return;
    fetchCatalogos();
    if (modoEdicion) cargarMixExistente();
    else precargarFilaInicial();
  }, [visible, modoEdicion, precargarFilaInicial, cargarMixExistente]);

  const fetchCatalogos = async () => {
    const [productos, variedades, longitudes, empaques, tipocajas, proveedores] = await Promise.all(
      [
        api.get('/api/catalogo?categoria=producto'),
        api.get('/api/catalogo?categoria=variedad'),
        api.get('/api/catalogo?categoria=longitud'),
        api.get('/api/catalogo?categoria=empaque'),
        api.get('/api/catalogo?categoria=tipocaja'),
        api.get('/api/terceros?tipo=proveedor')
      ]
    );

    const prods = productos.data || [];
    const emps = empaques.data || [];

    const roses = prods.find(
      (p) =>
        String(p.valor || '')
          .trim()
          .toUpperCase() === 'ROSES'
    );
    const emp25 = emps.find((e) => parseInt(e.valor, 10) === 25);

    setCatalogos({
      productos: prods,
      variedades: variedades.data || [],
      longitudes: longitudes.data || [],
      empaques: emps,
      tipocajas: tipocajas.data || [],
      proveedores: proveedores.data || []
    });

    const productoId = roses?.id || '';
    const empaqueId = emp25?.id || '';
    setDefaults({ productoId, empaqueId });
  };

  const nuevaFilaDesdePrimera = () => {
    const base = filas[0] || {
      codigo: detalleOriginal?.codigo || '',
      idproducto: defaults.productoId || '',
      idvariedad: '',
      idlongitud: '',
      idempaque: defaults.empaqueId || '',
      cantidadRamos: 1,
      precio_unitario: 0,
      precio_venta: 0
    };

    return {
      codigo: base.codigo || detalleOriginal?.codigo || '',
      idproducto: base.idproducto || defaults.productoId || '',
      idvariedad: base.idvariedad || '',
      idlongitud: base.idlongitud || '',
      idempaque: base.idempaque || defaults.empaqueId || '',
      cantidadRamos: base.cantidadRamos ?? 1,
      precio_unitario: parseFloat(base.precio_unitario || 0),
      precio_venta: parseFloat(base.precio_venta || 0)
    };
  };

  useEffect(() => {
    if (!visible) return;
    if (!defaults.productoId && !defaults.empaqueId) return;

    setFilas((prev) => {
      if (!prev || prev.length === 0) {
        return [
          {
            codigo: detalleOriginal?.codigo || '',
            idproducto: defaults.productoId || '',
            idvariedad: '',
            idlongitud: '',
            idempaque: defaults.empaqueId || '',
            cantidad: 1,
            cantidadRamos: 1,
            precio_unitario: 0,
            precio_venta: 0
          }
        ];
      }
      return prev.map((f) => ({
        ...f,
        idproducto: f.idproducto || defaults.productoId || '',
        idempaque: f.idempaque || defaults.empaqueId || ''
      }));
    });
  }, [defaults, visible, detalleOriginal]);

  const agregarFila = () => setFilas((prev) => [...prev, nuevaFilaDesdePrimera()]);

  const eliminarFila = (index) => setFilas(filas.filter((_, i) => i !== index));
  const actualizarCampo = (index, campo, valor) =>
    setFilas(filas.map((f, i) => (i === index ? { ...f, [campo]: valor } : f)));

  const calcularTotales = (fila) => {
    const cantidad = parseFloat(fila.cantidad || 0);
    const cantidadRamos = parseFloat(fila.cantidadRamos || 0);
    const precio_unitario = parseFloat(fila.precio_unitario || 0);
    const precio_venta = parseFloat(fila.precio_venta || 0);
    const empaqueValor = valorEmpaque(fila.idempaque);
    const cantidadTallos = cantidad * cantidadRamos * empaqueValor;
    const subtotal = cantidadTallos * precio_unitario;
    const subtotalVenta = cantidadTallos * precio_venta;
    return { cantidadTallos, subtotal, subtotalVenta };
  };

  const guardarMix = async () => {
    if (!idProveedorSeleccionado) {
      alert('⚠️ Debes seleccionar un proveedor.');
      return;
    }
    if (!idTipoCajaSeleccionado) {
      alert('⚠️ Debes seleccionar un tipo de caja.');
      return;
    }

    const cajasNum = Number(cantidadCajas) || 0;
    const esMixta = filas.length > 1;
    const esSolitario = !modoEdicion && !esMixta;

    const mixItems = filas.map((fila, index) => {
      const { cantidadTallos, subtotal, subtotalVenta } = calcularTotales({
        ...fila,
        cantidad: cajasNum
      });

      const piezas = esMixta ? (index === 0 ? cajasNum : 0) : cajasNum;

      return {
        ...fila,
        cantidad: cajasNum,
        piezas,
        idfactura: detalleOriginal?.idfactura,
        codigo: fila.codigo || detalleOriginal?.codigo || '',
        idpedido: detalleOriginal?.iddetalle || idpedidoOriginal,
        idgrupo: detalleOriginal?.idgrupo || 5,
        idproveedor: idProveedorSeleccionado,
        tipo_caja_variedad: idTipoCajaSeleccionado,
        documento_proveedor: facturaProveedor?.trim() || null,
        idusuario: user?.id || null,
        fechacompra: detalleOriginal?.fechacompra,
        cantidadTallos,
        subtotal,
        precio_venta: parseFloat(fila.precio_venta || 0),
        subtotalVenta,
        // 🆕 siempre mandamos guía master para NO perderla
        guia_master: guiaMaster || null
      };
    });

    let devolver = false;
    const cajasAntes = Number(detalleOriginal?.cantidad ?? cajasNum);
    const cajasFinales = cajasNum;
    const diferenciaCajas = cajasAntes - cajasFinales;

    if (modoEdicion && diferenciaCajas > 0) {
      devolver = window.confirm(
        `¿Deseas devolver ${diferenciaCajas} caja(s) a la mesa de compras?`
      );
    }

    try {
      const url = modoEdicion
        ? '/api/caja-mixta/factura-detalle/actualizar-mixta'
        : '/api/caja-mixta/factura-detalle/crear-mixta';

      const payload = {
        mixItems,
        iddetalle_original: idpedidoOriginal,
        devolverCajas: devolver,
        cajasDevueltas: diferenciaCajas,
        crearMix: !esSolitario
      };

      await api.post(url, payload);

      alert(esSolitario ? '✅ Caja sólida guardada.' : '✅ Mix guardado correctamente.');
      localStorage.setItem('resaltarMix', detalleOriginal?.iddetalle || idpedidoOriginal);
      await refrescar();
      onClose();
    } catch (error) {
      console.error('❌ Error al guardar el mix:', error);
      alert('❌ Error al guardar el mix.');
    }
  };

  const totalTallos = filas.reduce((sum, f) => {
    const { cantidadTallos } = calcularTotales({ ...f, cantidad: cantidadCajas });
    return sum + cantidadTallos;
  }, 0);

  if (!visible) return null;

  return (
    <div className="modal mix">
      <h3>{modoEdicion ? 'Editar Caja Mixta' : 'Crear Caja Mixta'}</h3>

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
          Factura Proveedor (opcional):{' '}
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
            {catalogos.tipocajas
              ?.slice()
              .sort((a, b) =>
                String(a.valor || '').localeCompare(String(b.valor || ''), 'es', {
                  sensitivity: 'base'
                })
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.valor}
                </option>
              ))}
          </select>
        </label>

        <strong>Total tallos usados: {totalTallos}</strong>

        {/* Campo oculto para mantener guia_master viva en el estado */}
        <input type="hidden" value={guiaMaster || ''} onChange={() => {}} />
      </div>

      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Producto</th>
            <th>Variedad</th>
            <th>Longitud</th>
            <th>Ramos</th>
            <th>Empaque</th>
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
            const { cantidadTallos, subtotal, subtotalVenta } = calcularTotales({
              ...fila,
              cantidad: cantidadCajas
            });
            return (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    value={fila.codigo || ''}
                    onChange={(e) => actualizarCampo(index, 'codigo', e.target.value)}
                  />
                </td>
                <td>
                  <select
                    value={fila.idproducto || ''}
                    onChange={(e) => actualizarCampo(index, 'idproducto', e.target.value)}
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
                    value={fila.idvariedad || ''}
                    onChange={(e) => actualizarCampo(index, 'idvariedad', e.target.value)}
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
                    value={fila.idlongitud || ''}
                    onChange={(e) => actualizarCampo(index, 'idlongitud', e.target.value)}
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
                  <input
                    type="number"
                    value={fila.cantidadRamos || ''}
                    onChange={(e) => actualizarCampo(index, 'cantidadRamos', e.target.value)}
                  />
                </td>
                <td>
                  <select
                    value={fila.idempaque || ''}
                    onChange={(e) => actualizarCampo(index, 'idempaque', e.target.value)}
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
                    value={fila.precio_unitario || ''}
                    onChange={(e) => actualizarCampo(index, 'precio_unitario', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={fila.precio_venta || ''}
                    onChange={(e) => actualizarCampo(index, 'precio_venta', e.target.value)}
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

      <div style={{ marginTop: '10px', fontWeight: 'bold', textAlign: 'right' }}>
        <div>
          Total tallos:{' '}
          {filas.reduce((sum, f) => {
            const { cantidadTallos } = calcularTotales({ ...f, cantidad: cantidadCajas });
            return sum + cantidadTallos;
          }, 0)}
        </div>

        <div>
          Subtotal total: $
          {filas
            .reduce((sum, f) => {
              const { subtotal } = calcularTotales({ ...f, cantidad: cantidadCajas });
              return sum + subtotal;
            }, 0)
            .toFixed(2)}
        </div>
        <div>
          Subtotal venta total: $
          {filas
            .reduce((sum, f) => {
              const { subtotalVenta } = calcularTotales({ ...f, cantidad: cantidadCajas });
              return sum + subtotalVenta;
            }, 0)
            .toFixed(2)}
        </div>
      </div>

      <button type="button" onClick={agregarFila}>
        + Agregar Variedad
      </button>
      <button type="button" onClick={guardarMix}>
        {modoEdicion ? 'Actualizar Mix' : 'Guardar Mix'}
      </button>
      <button type="button" onClick={onClose}>
        Cerrar
      </button>
    </div>
  );
};

export default ModalCajaMixta;
