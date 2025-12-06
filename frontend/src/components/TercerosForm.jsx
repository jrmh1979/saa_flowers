// components/TercerosForm.jsx
import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useLocation, useNavigate } from 'react-router-dom';
import ModalTercero from './ModalTercero';

/* ==================== CONFIG DE COLUMNAS ==================== */
// Clientes (sin Razón social, sin Tipo Ident.)
const COLS_CLIENTE = [
  { key: 'sel', label: '', width: '2.8%', align: 'left' },
  { key: 'idx', label: '#', width: '4%', align: 'left' },
  { key: 'codigo', label: 'Código', width: '4%', align: 'left' },
  { key: 'nombre', label: 'Nombre Cliente/Mark', width: '18%', align: 'left' },
  { key: 'ident', label: 'Identificación', width: '7%', align: 'left' },
  { key: 'tel', label: 'Teléfono', width: '7%', align: 'left' },
  { key: 'mail', label: 'Correo', width: '10%', align: 'left' },
  { key: 'dir', label: 'Dirección', width: '12%', align: 'left' },
  { key: 'venta', label: 'Tipo Venta', width: '5%', align: 'left' },
  { key: 'padre', label: 'Cliente Principal', width: '7%', align: 'left' }
];

// Proveedores (sin Tipo Ident., con Razón social)
const COLS_PROV = [
  { key: 'sel', label: '', width: '2.8%', align: 'left' },
  { key: 'idx', label: '#', width: '4%', align: 'left' },
  { key: 'codigo', label: 'Código', width: '4%', align: 'left' },
  { key: 'nombre', label: 'Nombre Comercial', width: '16%', align: 'left' },
  { key: 'razon', label: 'Razón social', width: '18%', align: 'left' },
  { key: 'ident', label: 'Identificación', width: '10%', align: 'left' },
  { key: 'tel', label: 'Teléfono', width: '8%', align: 'left' },
  { key: 'mail', label: 'Correo', width: '10%', align: 'left' },
  { key: 'dir', label: 'Dirección', width: '12%', align: 'left' }
];

function TercerosForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const tipo = query.get('tipo') || 'cliente'; // 'cliente' | 'proveedor'

  const [terceros, setTerceros] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [datosEditar, setDatosEditar] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // (por ahora no se usa visualmente, pero lo dejamos por si se requiere luego)
  const [, setCompactActions] = useState(false);

  const COLS = tipo === 'cliente' ? COLS_CLIENTE : COLS_PROV;
  const COL_COUNT = COLS.length;

  /* ===== estilos compactos ===== */
  const tableStyle = {
    tableLayout: 'fixed',
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontSize: 13,
    lineHeight: 1.2
  };
  const thStyle = {
    padding: '6px 8px',
    textAlign: 'left',
    position: 'sticky',
    top: 0,
    background: '#f5f6f7',
    zIndex: 1
  };
  const tdStyle = { padding: '6px 8px', verticalAlign: 'top' };
  const wrap = { whiteSpace: 'normal', wordBreak: 'break-word', textAlign: 'justify' };

  useEffect(() => {
    cargarTerceros();
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, location.search]);

  useEffect(() => {
    const updateCompact = () => setCompactActions(window.innerWidth < 1200);
    updateCompact();
    window.addEventListener('resize', updateCompact);
    return () => window.removeEventListener('resize', updateCompact);
  }, []);

  const cargarTerceros = async () => {
    try {
      const res = await api.get(`/api/terceros?tipo=${tipo}`);
      setTerceros(res.data || []);
      if (tipo === 'cliente') setClientes(res.data || []);
    } catch (err) {
      console.error(`Error al cargar ${tipo}s:`, err);
    }
  };

  const abrirModal = (tercero = null) => {
    setDatosEditar(tercero);
    setShowModal(true);
  };

  // Duplicado (crear marcación desde un cliente principal)
  const [duplicarDe, setDuplicarDe] = useState(null);
  const abrirDuplicado = (principal) => {
    if (tipo !== 'cliente') return;
    const esPrincipal = (principal.clasifcliente ?? 'CLIENTE') === 'CLIENTE';
    if (!esPrincipal) return;
    setDatosEditar(null); // crear (no editar)
    setDuplicarDe(principal);
    setShowModal(true);
  };

  // 🔎 filtro (incluye razón social para proveedor)
  const filtrados = useMemo(() => {
    const q = (filtro || '').toLowerCase();
    return (terceros || []).filter(
      (t) =>
        (t.nombre || '').toLowerCase().includes(q) ||
        (t.razon_social || '').toLowerCase().includes(q) ||
        (t.codigotercero || '').toLowerCase().includes(q) ||
        (t.identificacion || '').toLowerCase().includes(q) ||
        (t.correo || '').toLowerCase().includes(q) ||
        (t.telefono || '').toLowerCase().includes(q)
    );
  }, [terceros, filtro]);

  const placeholder =
    tipo === 'proveedor'
      ? 'Buscar por nombre, razón social, código, identificación, correo o teléfono...'
      : 'Buscar por nombre, código, identificación, correo o teléfono...';

  const selectedTercero = useMemo(
    () => (selectedId ? filtrados.find((t) => t.idtercero === selectedId) : null),
    [selectedId, filtrados]
  );

  /* ==================== CHECK & DELETE ==================== */
  // Devuelve:
  //   true  -> HAY facturas (NO se puede eliminar)
  //   false -> NO hay facturas (sí se puede eliminar)
  //   null  -> no se pudo verificar
  const existeFacturaParaCliente = async (idtercero) => {
    // 1) Endpoint oficial (si lo tienes creado como te propuse)
    try {
      const r = await api.get(`/api/terceros/${idtercero}/can-delete`);
      if (typeof r?.data?.canDelete === 'boolean') {
        return r.data.canDelete ? false : true;
      }
    } catch (_) {
      // seguimos al fallback
    }

    // 2) Fallback: consultas candidatas
    const candidates = [
      `/api/factura_consolidada?Idcliente=${idtercero}&limit=1`,
      `/api/factura-consolidada?Idcliente=${idtercero}&limit=1`,
      `/api/facturas-consolidadas?Idcliente=${idtercero}&limit=1`,
      `/api/factura_consolidada/exists?Idcliente=${idtercero}`
    ];
    for (const url of candidates) {
      try {
        const res = await api.get(url);
        const data = res?.data;
        if (data == null) continue;
        if (typeof data === 'object' && 'exists' in data) return !!data.exists;
        if (Array.isArray(data)) return data.length > 0;
        if (typeof data === 'number') return data > 0;
      } catch (_) {}
    }

    // 3) No pudimos verificar
    return null;
  };

  const eliminarTercero = async () => {
    if (!selectedTercero) return;
    try {
      const ok = window.confirm(
        `¿Eliminar "${selectedTercero.nombre}"? Esta acción no se puede deshacer.`
      );
      if (!ok) return;

      // Verificación opcional (si falla igual seguimos al DELETE)
      const check = await existeFacturaParaCliente(selectedTercero.idtercero);
      if (check === true) {
        alert(
          'No se puede eliminar este tercero porque existen facturas emitidas a este cliente (factura_consolidada).'
        );
        return;
      }

      await api.delete(`/api/terceros/${selectedTercero.idtercero}`);
      alert('Tercero eliminado.');
      await cargarTerceros();
      setSelectedId(null);
    } catch (err) {
      const status = err?.response?.status;
      const reason = err?.response?.data?.reason || '';
      const serverMsg = err?.response?.data?.error || '';

      if (status === 409 && reason === 'FACTURAS_EMITIDAS') {
        alert(
          'No se puede eliminar: existen facturas emitidas a este tercero (factura_consolidada).'
        );
        return;
      }
      if (status === 404) {
        alert('Tercero no encontrado.');
        return;
      }

      console.error(err);
      alert(serverMsg || 'No se pudo eliminar el tercero. Revisa la consola para más detalles.');
    }
  };

  /* ==================== RENDER ==================== */
  return (
    <div style={{ padding: '1rem' }}>
      <h2 style={{ margin: '0 0 0.6rem' }}>{tipo === 'cliente' ? 'Clientes' : 'Proveedores'}</h2>

      {/* ===== Toolbar superior ===== */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: '0.7rem',
          flexWrap: 'wrap'
        }}
      >
        <select
          value={tipo}
          onChange={(e) => {
            const v = e.target.value;
            const q = new URLSearchParams(location.search);
            q.set('tipo', v);
            navigate({ search: `?${q.toString()}` }, { replace: false });
          }}
          style={{ padding: '6px 8px', fontSize: 13, lineHeight: 1.2 }}
        >
          <option value="cliente">Clientes</option>
          <option value="proveedor">Proveedores</option>
        </select>

        <input
          type="text"
          placeholder={placeholder}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          style={{
            padding: '6px 8px',
            fontSize: 13,
            lineHeight: 1.2,
            minWidth: 260,
            flex: 1
          }}
        />

        <button
          onClick={() => abrirModal()}
          style={{ padding: '6px 10px', fontSize: 13, lineHeight: 1.2 }}
          title={`Nuevo ${tipo}`}
        >
          ➕ Nuevo {tipo}
        </button>

        <button
          onClick={() => selectedTercero && abrirModal(selectedTercero)}
          disabled={!selectedTercero}
          style={{ padding: '6px 10px', fontSize: 13, lineHeight: 1.2 }}
          title="Editar seleccionado"
        >
          ✏️ Editar
        </button>

        {tipo === 'cliente' && (
          <button
            onClick={() => {
              if (!selectedTercero) return;
              const esPrincipal = (selectedTercero.clasifcliente ?? 'CLIENTE') === 'CLIENTE';
              if (!esPrincipal) {
                alert('Solo se puede duplicar desde un Cliente Principal.');
                return;
              }
              abrirDuplicado(selectedTercero);
            }}
            disabled={!selectedTercero}
            style={{ padding: '6px 10px', fontSize: 13, lineHeight: 1.2 }}
            title="Crear marcación duplicando datos del cliente principal seleccionado"
          >
            🧬 Duplicar
          </button>
        )}

        <button
          onClick={eliminarTercero}
          disabled={!selectedTercero}
          style={{ padding: '6px 10px', fontSize: 13, lineHeight: 1.2 }}
          title="Eliminar seleccionado"
        >
          🗑️ Eliminar
        </button>
      </div>

      <div className="tabla-scrollable">
        <table style={tableStyle} className="tabla-cartera">
          <colgroup>
            {COLS.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  style={{ ...thStyle, textAlign: c.align === 'right' ? 'right' : 'left' }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtrados.map((t, i) => {
              const isSel = selectedId === t.idtercero;
              return (
                <tr
                  key={t.idtercero}
                  onClick={() => setSelectedId(t.idtercero)}
                  style={{
                    cursor: 'pointer',
                    background: isSel ? '#eef6ff' : undefined
                  }}
                >
                  {/* Selección */}
                  <td style={{ ...tdStyle }}>
                    <input
                      type="radio"
                      name="sel-tercero"
                      checked={isSel}
                      onChange={() => setSelectedId(t.idtercero)}
                    />
                  </td>

                  {/* # */}
                  <td style={{ ...tdStyle }}>{i + 1}</td>

                  {/* Código */}
                  <td style={{ ...tdStyle, ...wrap }}>{t.codigotercero || ''}</td>

                  {/* Nombre */}
                  <td style={{ ...tdStyle, ...wrap }}>{t.nombre}</td>

                  {/* Razón social (solo proveedores) */}
                  {tipo === 'proveedor' && (
                    <td style={{ ...tdStyle, ...wrap }}>{t.razon_social || ''}</td>
                  )}

                  {/* Identificación */}
                  <td style={{ ...tdStyle, ...wrap }}>{t.identificacion || ''}</td>

                  {/* Teléfono */}
                  <td style={{ ...tdStyle, ...wrap }}>{t.telefono || ''}</td>

                  {/* Correo */}
                  <td style={{ ...tdStyle, ...wrap }}>{t.correo || ''}</td>

                  {/* Dirección */}
                  <td style={{ ...tdStyle, ...wrap }}>{t.direccion || ''}</td>

                  {/* (Sólo clientes) Tipo Venta */}
                  {tipo === 'cliente' && (
                    <td style={{ ...tdStyle, ...wrap }}>{t.tipo_venta_default || 'NACIONAL'}</td>
                  )}

                  {/* (Sólo clientes) Cliente Principal */}
                  {tipo === 'cliente' && (
                    <td style={{ ...tdStyle, ...wrap }}>
                      {clientes.find((c) => c.idtercero === t.idcliente_padre)?.nombre || ''}
                    </td>
                  )}
                </tr>
              );
            })}

            {filtrados.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} style={{ textAlign: 'center', color: '#777', padding: 12 }}>
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ModalTercero
          show={showModal}
          onClose={() => {
            setShowModal(false);
            setDuplicarDe(null);
          }}
          onSave={() => {
            setShowModal(false);
            setDuplicarDe(null);
            cargarTerceros();
          }}
          tipo={tipo}
          clientes={clientes}
          datosEditar={datosEditar} // null cuando es duplicado => modo crear
          duplicarDe={duplicarDe} // origen para prellenar marcación
        />
      )}
    </div>
  );
}

export default TercerosForm;
