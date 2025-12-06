// src/components/ModalTercero.jsx
import React, { useState, useEffect } from 'react';
import api from '../services/api';

const TIPO_OPTIONS = [
  { value: '04', label: '04 - RUC' },
  { value: '05', label: '05 - CÉDULA' },
  { value: '06', label: '06 - PASAPORTE' },
  { value: '07', label: '07 - CONSUMIDOR FINAL' },
  { value: '08', label: '08 - IDENTIFICACIÓN DEL EXTERIOR' }
];

const TIPO_VENTA_OPTS = [
  { value: 'NACIONAL', label: 'NACIONAL' },
  { value: 'FOB', label: 'FOB (Exportación)' },
  { value: 'CIF', label: 'CIF (Exportación)' }
];

const CLASIF_CLIENTE_OPTS = [
  { value: 'CLIENTE', label: 'Cliente' },
  { value: 'MARCACION', label: 'Marcación' }
];

// normalizador para comparar 'Marcación'/'Marcacion'/'cliente' etc.
const normClas = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const normalizeCatalog = (items = []) =>
  items.map((x) => {
    const rawId = x.idcatalogo_simple ?? x.idcatalogo ?? x.id ?? x.codigo ?? x.valor ?? '';
    const id = String(rawId);
    const label = x.nombre ?? x.valor ?? x.codigo ?? id;
    return { id, label };
  });

const generarCodigoClienteSiguiente = (lista = []) => {
  const numeros = (lista || [])
    .map((c) =>
      String(c.codigotercero || '')
        .toUpperCase()
        .trim()
    )
    .filter((c) => /^C\d+$/.test(c)) // sólo códigos tipo C001, C002...
    .map((c) => parseInt(c.slice(1), 10))
    .filter((n) => Number.isFinite(n));

  const siguiente = numeros.length ? Math.max(...numeros) + 1 : 1;
  return `C${String(siguiente).padStart(3, '0')}`;
};

export default function ModalTercero({
  show,
  onClose,
  onSave,
  tipo,
  clientes,
  datosEditar,
  duplicarDe = null
}) {
  const [codigotercero, setCodigoTercero] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [email, setEmail] = useState('');
  const [tipoIdent, setTipoIdent] = useState('04');
  const [identificacion, setIdentificacion] = useState('');
  const [direccion, setDireccion] = useState('');

  // Vendedor (solo clientes)
  const [idVendedor, setIdVendedor] = useState('');
  const [vendedores, setVendedores] = useState([]);

  // Cliente / jerarquía
  const [clasifCliente, setClasifCliente] = useState('CLIENTE');
  const [idClientePadre, setIdClientePadre] = useState('');
  const [clientesCombo, setClientesCombo] = useState([]);

  // Proveedor
  const [razonSocial, setRazonSocial] = useState('');
  const [contactoProv, setContactoProv] = useState('');
  const [telefonoContactoProv, setTelefonoContactoProv] = useState('');

  // Venta default / Exportación
  const [tipoVentaDefault, setTipoVentaDefault] = useState('NACIONAL');

  // Catálogos
  const [idPais, setIdPais] = useState('');
  const [idCarguera, setIdCarguera] = useState('');
  const [cargueras, setCargueras] = useState([]);
  const [paises, setPaises] = useState([]);

  const [codSino, setCodSino] = useState(false);

  const esCliente = tipo === 'cliente';
  const esExport = esCliente && (tipoVentaDefault === 'FOB' || tipoVentaDefault === 'CIF');

  /* =============== AUTOCÓDIGO C001, C002... =============== */
  useEffect(() => {
    if (!show) return;
    if (!esCliente) return;
    if (datosEditar) return; // en edición respetamos el código
    if (duplicarDe) return; // duplicado (marcación) -> sin sugerir
    if (normClas(clasifCliente) !== 'CLIENTE') return;
    if (codigotercero && codigotercero.trim() !== '') return;

    // sólo clientes principales existentes
    const listaPrincipales = (clientes || []).filter(
      (c) => normClas(c.clasifcliente) === 'CLIENTE'
    );
    const sugerido = generarCodigoClienteSiguiente(listaPrincipales);
    setCodigoTercero(sugerido);
  }, [show, esCliente, datosEditar, duplicarDe, clasifCliente, clientes, codigotercero]);

  const limpiarCampos = () => {
    setCodigoTercero('');
    setNombre('');
    setTelefono('');
    setCorreo('');
    setEmail('');
    setTipoIdent('04');
    setIdentificacion('');
    setDireccion('');
    setIdVendedor('');
    setClasifCliente('CLIENTE');
    setIdClientePadre('');
    setRazonSocial('');
    setContactoProv('');
    setTelefonoContactoProv('');
    setTipoVentaDefault('NACIONAL');
    setIdPais('');
    setIdCarguera('');
    setCodSino(false);
    setClientesCombo(Array.isArray(clientes) ? clientes : []);
  };

  // Catálogos (paises, cargueras)
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/catalogo/todo');
        const catalogo = res.data;
        const carguerasCat = catalogo.filter((c) => c.categoria === 'carguera');
        const paisesCat = catalogo.filter((c) => c.categoria === 'pais_sri');
        setCargueras(normalizeCatalog(carguerasCat));
        setPaises(normalizeCatalog(paisesCat));
      } catch (err) {
        console.error('❌ Error al cargar catalogo completo:', err);
      }
    })();
  }, [esCliente]);

  // Cargar vendedores
  useEffect(() => {
    if (!esCliente) return;
    (async () => {
      try {
        const { data } = await api.get('/api/usuarios/listar?activos=1');
        const vs = (Array.isArray(data) ? data : [])
          .map((u) => {
            const id = String(u.idusuario ?? '');
            const label = String(u.nombre ?? '').trim();
            return id && label ? { id, label: label.toUpperCase() } : null;
          })
          .filter(Boolean);
        setVendedores(vs);
      } catch (e) {
        console.error('❌ Error al cargar vendedores:', e);
        setVendedores([]);
      }
    })();
  }, [esCliente]);

  /* =============== PRECARGA: EDITAR =============== */
  useEffect(() => {
    if (datosEditar) {
      setCodigoTercero(datosEditar.codigotercero || '');
      setNombre((datosEditar.nombre || '').toString());
      setTelefono(datosEditar.telefono || '');
      setCorreo(datosEditar.correo || '');
      setEmail(datosEditar.email || '');
      const ti = (datosEditar.tipo_identificacion || '04').toString().padStart(2, '0');
      setTipoIdent(['04', '05', '06', '07', '08'].includes(ti) ? ti : '04');
      setIdentificacion(datosEditar.identificacion || (ti === '07' ? '9999999999999' : ''));
      setDireccion(datosEditar.direccion || '');

      setIdVendedor(
        datosEditar.idvendedor !== undefined && datosEditar.idvendedor !== null
          ? String(datosEditar.idvendedor)
          : ''
      );

      // clasif + padre
      const clas = normClas(datosEditar.clasifcliente) || 'CLIENTE';
      setClasifCliente(clas);
      setIdClientePadre(
        datosEditar.idcliente_padre != null
          ? String(datosEditar.idcliente_padre)
          : datosEditar.idClientePadre != null
            ? String(datosEditar.idClientePadre)
            : ''
      );

      setRazonSocial(datosEditar.razon_social || '');
      setContactoProv(datosEditar.contacto || '');
      setTelefonoContactoProv(datosEditar.telefono_contacto || '');
      setTipoVentaDefault(datosEditar.tipo_venta_default || 'NACIONAL');
      setCodSino(Boolean(datosEditar?.codsino));

      setIdPais(
        datosEditar.idpais !== undefined && datosEditar.idpais !== null
          ? String(datosEditar.idpais)
          : ''
      );
      setIdCarguera(
        datosEditar.idcarguera !== undefined && datosEditar.idcarguera !== null
          ? String(datosEditar.idcarguera)
          : ''
      );

      setClientesCombo(Array.isArray(clientes) ? clientes : []);
    } else {
      limpiarCampos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datosEditar]);

  /* =============== PRECARGA: DUPLICAR =============== */
  useEffect(() => {
    if (!show) return;
    if (tipo !== 'cliente' || datosEditar || !duplicarDe) return;

    setCodigoTercero('');
    setNombre(duplicarDe.nombre || '');
    setTelefono(duplicarDe.telefono || '');
    setCorreo(duplicarDe.correo || '');
    setEmail(duplicarDe.email || '');
    const ti = (duplicarDe.tipo_identificacion || '04').toString().padStart(2, '0');
    setTipoIdent(['04', '05', '06', '07', '08'].includes(ti) ? ti : '04');
    setIdentificacion(duplicarDe.identificacion || '');
    setDireccion(duplicarDe.direccion || '');
    setCodSino(Boolean(duplicarDe?.codsino));
    setTipoVentaDefault(duplicarDe.tipo_venta_default || 'NACIONAL');
    setIdPais(duplicarDe.idpais != null ? String(duplicarDe.idpais) : '');
    setIdCarguera(duplicarDe.idcarguera != null ? String(duplicarDe.idcarguera) : '');
    setIdVendedor(duplicarDe.idvendedor != null ? String(duplicarDe.idvendedor) : '');

    setClasifCliente('MARCACION');
    setIdClientePadre(String(duplicarDe.idtercero || ''));

    setClientesCombo(Array.isArray(clientes) ? clientes : []);
  }, [show, tipo, datosEditar, duplicarDe, clientes]);

  /* =============== COHERENCIA CLASIFICACIÓN =============== */
  useEffect(() => {
    if (!esCliente) return;

    if (clasifCliente === 'MARCACION') {
      // Sólo autocompletar en duplicado y si aún no hay padre
      if (!datosEditar && duplicarDe?.idtercero && !idClientePadre) {
        setIdClientePadre(String(duplicarDe.idtercero));
      }
    } else if (clasifCliente === 'CLIENTE') {
      // Los clientes principales no tienen padre
      if (idClientePadre) {
        setIdClientePadre('');
      }
    }
  }, [esCliente, clasifCliente, datosEditar, duplicarDe, idClientePadre]);

  if (!show) return null;

  const onChangeTipoIdent = (e) => {
    const v = e.target.value;
    setTipoIdent(v);
    if (v === '07' && (!identificacion || identificacion.trim() === '')) {
      setIdentificacion('9999999999999');
    }
    if (v !== '07' && identificacion === '9999999999999') {
      setIdentificacion('');
    }
  };

  const placeholderIdent = (() => {
    switch (tipoIdent) {
      case '04':
        return 'RUC (13 dígitos)';
      case '05':
        return 'Cédula';
      case '06':
        return 'Pasaporte';
      case '07':
        return '9999999999999';
      case '08':
        return 'ID del exterior';
      default:
        return 'Identificación';
    }
  })();

  const maxLenIdent = tipoIdent === '04' ? 13 : 50;

  /* =============== GUARDAR =============== */
  const guardar = async () => {
    if (!nombre.trim()) return alert('⚠️ El nombre es obligatorio');

    // regla: si está como MARCACION sin padre -> lo convertimos a CLIENTE
    let clasifEnviar = esCliente ? normClas(clasifCliente) : null;
    if (esCliente && clasifEnviar === 'MARCACION' && !idClientePadre) {
      clasifEnviar = 'CLIENTE';
    }

    if (esCliente) {
      if ((tipoVentaDefault === 'FOB' || tipoVentaDefault === 'CIF') && !idPais) {
        return alert('⚠️ Completa: País destino.');
      }
    }

    const ti = ['04', '05', '06', '07', '08'].includes(tipoIdent) ? tipoIdent : '04';
    let idn = (identificacion || '').trim();
    if (ti === '07' && !idn) idn = '9999999999999';

    // idcliente_padre: sólo aplica para marcaciones
    const idClientePadreAEnviar =
      esCliente && clasifEnviar === 'MARCACION' ? idClientePadre || null : null;

    const idcargueraParsed =
      esCliente && idCarguera
        ? Number.isNaN(Number(idCarguera))
          ? null
          : Number(idCarguera)
        : null;

    const idpaisParsed =
      esCliente && idPais ? (Number.isNaN(Number(idPais)) ? null : Number(idPais)) : null;

    const idvendedorParsed =
      esCliente && idVendedor
        ? Number.isNaN(Number(idVendedor))
          ? null
          : Number(idVendedor)
        : null;

    const payload = {
      codigotercero: codigotercero?.trim() || null,
      nombre: nombre?.trim(),
      telefono: telefono?.trim() || null,
      correo: correo?.trim() || null,
      email: email?.trim() || null,
      tipo_identificacion: ti,
      identificacion: idn || null,
      direccion: direccion?.trim() || null,
      tipo,
      codsino: esCliente ? (codSino ? 1 : 0) : null,
      idvendedor: idvendedorParsed,
      clasifcliente: esCliente ? clasifEnviar : null,
      idcliente_padre: idClientePadreAEnviar,
      tipo_venta_default: esCliente ? tipoVentaDefault : 'NACIONAL',
      idpais: idpaisParsed,
      idcarguera: idcargueraParsed,

      // proveedor
      razon_social: !esCliente ? razonSocial?.trim() || null : null,
      contacto: !esCliente ? contactoProv?.trim() || null : null,
      telefono_contacto: !esCliente ? telefonoContactoProv?.trim() || null : null
    };

    try {
      if (datosEditar) {
        await api.put(`/api/terceros/${datosEditar.idtercero}`, payload);
      } else {
        await api.post('/api/terceros', payload);
      }

      alert('✅ Tercero guardado correctamente');
      limpiarCampos();
      onSave?.();
      onClose?.();
    } catch (err) {
      console.error('❌ Error al guardar tercero:', err);
      const msg = err?.response?.data?.error || err?.message || 'Error al guardar tercero';
      alert(`❌ ${msg}`);
    }
  };

  /* =============== UI =============== */
  return (
    <div className="modal-overlay">
      <div className="modal modal-xl">
        <h3>
          {datosEditar ? '✏️ Editar' : '➕ Nuevo'} {esCliente ? 'Cliente' : 'Proveedor'}
        </h3>

        <div className="form-grid two-cols">
          {esCliente && (
            <div className="field">
              <label>Clasificación:</label>
              <select value={clasifCliente} onChange={(e) => setClasifCliente(e.target.value)}>
                {CLASIF_CLIENTE_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>Código (opcional):</label>
            <input
              type="text"
              value={codigotercero}
              maxLength={50}
              placeholder="Ej. C-001"
              onChange={(e) => setCodigoTercero(e.target.value.toUpperCase())}
            />
          </div>

          <div className="field">
            <label>Nombre:</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value.toUpperCase())}
            />
          </div>

          {esCliente && clasifCliente === 'MARCACION' && (
            <div className="field">
              <label>Cliente Principal (opcional):</label>
              <select
                value={idClientePadre || ''}
                onChange={(e) => setIdClientePadre(e.target.value)}
              >
                <option value="">-- Sin cliente principal --</option>
                {(clientesCombo || [])
                  .filter((c) => normClas(c.clasifcliente) === 'CLIENTE')
                  .filter(
                    (c) => !datosEditar || String(c.idtercero) !== String(datosEditar.idtercero)
                  )
                  .map((c) => (
                    <option key={c.idtercero} value={String(c.idtercero)}>
                      {c.nombre}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>Teléfono:</label>
            <input type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </div>

          <div className="field">
            <label>Correo:</label>
            <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </div>

          <div className="field">
            <label>Correo cartera:</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="field">
            <label>Tipo identificación (SRI):</label>
            <select value={tipoIdent} onChange={onChangeTipoIdent}>
              {TIPO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Identificación:</label>
            <input
              type="text"
              value={identificacion}
              onChange={(e) => setIdentificacion(e.target.value)}
              placeholder={placeholderIdent}
              maxLength={maxLenIdent}
            />
          </div>

          <div className="field">
            <label>Dirección:</label>
            <input
              type="text"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Calle, número, ciudad"
              maxLength={160}
            />
          </div>

          {esCliente && (
            <div className="field">
              <label>Vendedor:</label>
              <select value={idVendedor} onChange={(e) => setIdVendedor(e.target.value)}>
                <option value="">-- Selecciona --</option>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!esCliente && (
            <div className="card full">
              <b>Datos del proveedor</b>
              <div className="form-grid two-cols gap-sm">
                <div className="field">
                  <label>Razón social:</label>
                  <input
                    type="text"
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value.toUpperCase())}
                    placeholder="Ej. ROSAS ANDINAS LLC"
                  />
                </div>
                <div className="field">
                  <label>Contacto:</label>
                  <input
                    type="text"
                    value={contactoProv}
                    onChange={(e) => setContactoProv(e.target.value)}
                    placeholder="Nombre de contacto"
                  />
                </div>
                <div className="field">
                  <label>Teléfono contacto:</label>
                  <input
                    type="text"
                    value={telefonoContactoProv}
                    onChange={(e) => setTelefonoContactoProv(e.target.value)}
                    placeholder="+593 99 999 9999"
                  />
                </div>
              </div>
            </div>
          )}

          {esCliente && (
            <>
              <div className="field">
                <label>Tipo de venta (default):</label>
                <select
                  value={tipoVentaDefault}
                  onChange={(e) => setTipoVentaDefault(e.target.value)}
                >
                  {TIPO_VENTA_OPTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Carguera:</label>
                <select value={idCarguera} onChange={(e) => setIdCarguera(e.target.value)}>
                  <option value="">-- Selecciona --</option>
                  {cargueras.map((cg) => (
                    <option key={cg.id} value={cg.id}>
                      {cg.label}
                    </option>
                  ))}
                </select>
              </div>

              {esExport && (
                <div className="card full">
                  <b>Exportación</b>
                  <div className="form-grid two-cols gap-sm">
                    <div className="field">
                      <label>País destino:</label>
                      <select value={idPais} onChange={(e) => setIdPais(e.target.value)}>
                        <option value="">-- Selecciona --</option>
                        {paises.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
                      <label
                        htmlFor="codsinoChk"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}
                      >
                        <input
                          id="codsinoChk"
                          type="checkbox"
                          checked={codSino}
                          onChange={(e) => setCodSino(e.target.checked)}
                          aria-label="CODSINO"
                          style={{
                            width: 14,
                            height: 14,
                            transform: 'scale(0.9)',
                            transformOrigin: 'left center',
                            verticalAlign: 'middle'
                          }}
                        />
                        <span style={{ fontSize: 12 }}>CODSINO</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-buttons">
          <button onClick={guardar}>{datosEditar ? '💾 Actualizar' : '✅ Guardar'}</button>
          <button onClick={onClose}>❌ Cerrar</button>
        </div>
      </div>
    </div>
  );
}
