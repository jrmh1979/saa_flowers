// frontend/src/components/DAEForm.jsx
import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import ModalDAE from './ModalDAE';

export default function DAEForm() {
  const [list, setList] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [datosEditar, setDatosEditar] = useState(null);

  const [paises, setPaises] = useState([]);
  const [puertos, setPuertos] = useState([]);

  const [vigentes, setVigentes] = useState(true);
  const [pais, setPais] = useState('');
  const [pEmb, setPEmb] = useState('');
  const [pDest, setPDest] = useState('');

  // Cargar catálogos una vez
  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const [cp, pt] = await Promise.all([
          api.get('/api/terceros/catalogo?categoria=pais_sri'),
          api.get('/api/terceros/catalogo?categoria=puerto')
        ]);
        setPaises(cp.data || []);
        setPuertos(pt.data || []);
      } catch (e) {
        console.error('Error cargando catálogos:', e);
      }
    };
    cargarCatalogos();
  }, []);

  // Cargar listado (memoizado)
  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (vigentes) qs.set('vigentes', '1');
      if (pais) qs.set('pais_destino', pais);
      if (pEmb) qs.set('p_embarque', pEmb);
      if (pDest) qs.set('p_destino', pDest);

      const { data } = await api.get(`/api/dae?${qs.toString()}`);
      setList(data ?? []);
    } catch (e) {
      console.error('Error cargando DAE:', e);
    }
  }, [vigentes, pais, pEmb, pDest]);

  // Llamar cargar cuando cambian filtros
  useEffect(() => {
    cargar();
  }, [cargar]);

  const filtrados = list.filter((d) => {
    const q = filtro.toLowerCase();
    return (
      (d.numero || '').toLowerCase().includes(q) ||
      (d.puerto_embarque_txt || '').toLowerCase().includes(q) ||
      (d.puerto_destino_txt || '').toLowerCase().includes(q) ||
      (d.pais_destino_txt || '').toLowerCase().includes(q)
    );
  });

  const abrirModal = (row = null) => {
    setDatosEditar(row);
    setShowModal(true);
  };

  const eliminar = async (row) => {
    if (!window.confirm(`¿Eliminar DAE ${row.numero}?`)) return;
    try {
      await api.delete(`/api/dae/${row.iddae}`);
      alert('🗑️ Eliminada');
      cargar();
    } catch (e) {
      alert(e?.response?.data?.error || 'Error al eliminar');
    }
  };

  return (
    <div style={{ padding: '1rem' }}>
      <h2>📄 DAE</h2>

      <div className="barra-filtros-cartera">
        <input
          type="text"
          placeholder="Buscar por número, puertos o país..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={vigentes}
            onChange={(e) => setVigentes(e.target.checked)}
          />
          Solo vigentes
        </label>
        <select value={pais} onChange={(e) => setPais(e.target.value)}>
          <option value="">País destino</option>
          {paises.map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {p.codigo} - {p.nombre}
            </option>
          ))}
        </select>
        <select value={pEmb} onChange={(e) => setPEmb(e.target.value)}>
          <option value="">Puerto embarque</option>
          {puertos.map((pt) => (
            <option key={pt.codigo} value={pt.codigo}>
              {pt.codigo} - {pt.nombre}
            </option>
          ))}
        </select>
        <select value={pDest} onChange={(e) => setPDest(e.target.value)}>
          <option value="">Puerto destino</option>
          {puertos.map((pt) => (
            <option key={pt.codigo} value={pt.codigo}>
              {pt.codigo} - {pt.nombre}
            </option>
          ))}
        </select>

        <button className="btn-nuevo-movimiento" onClick={() => abrirModal()}>
          ➕ Nueva DAE
        </button>
      </div>

      <div className="tabla-scrollable">
        <table className="tabla-cartera">
          <thead>
            <tr>
              <th>#</th>
              <th>Número</th>
              <th>País destino</th>
              <th>Puerto embarque</th>
              <th>Puerto destino</th>
              <th>Apertura</th>
              <th>Caducidad</th>
              <th>Obs</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((d, i) => (
              <tr key={d.iddae}>
                <td>{i + 1}</td>
                <td>{d.numero}</td>
                <td>{d.pais_destino_txt || d.pais_destino_codigo}</td>
                <td>{d.puerto_embarque_txt || d.puerto_embarque_codigo}</td>
                <td>{d.puerto_destino_txt || d.puerto_destino_codigo}</td>
                <td>{(d.fecha_apertura || '').substring(0, 10)}</td>
                <td>{(d.fecha_caducidad || '').substring(0, 10)}</td>
                <td>{d.observaciones || ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => abrirModal(d)}>✏️ Editar</button>{' '}
                  <button onClick={() => eliminar(d)}>🗑️ Eliminar</button>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center' }}>
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ModalDAE
          show={showModal}
          onClose={() => setShowModal(false)}
          onSave={cargar}
          datosEditar={datosEditar}
        />
      )}
    </div>
  );
}
