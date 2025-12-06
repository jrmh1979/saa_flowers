import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import '../assets/style.css';

function CatalogoFormulario() {
  const [searchParams] = useSearchParams();
  const categoria = searchParams.get('categoria');

  const [registros, setRegistros] = useState([]);
  const [nuevo, setNuevo] = useState('');
  const [nuevoContacto, setNuevoContacto] = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');

  const [editandoId, setEditandoId] = useState(null);
  const [valorEditado, setValorEditado] = useState('');
  const [equivalenciaEditada, setEquivalenciaEditada] = useState('');
  const [otrosEditado, setOtrosEditado] = useState('');

  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    if (!categoria) return;
    api
      .get(`/api/catalogo?categoria=${categoria}`)
      .then((res) => setRegistros(res.data))
      .catch((err) => console.error('❌ Error al cargar registros:', err));
  }, [categoria]);

  const recargarRegistros = async () => {
    if (!categoria) return;
    const res = await api.get(`/api/catalogo?categoria=${categoria}`);
    setRegistros(res.data);
  };

  const agregarRegistro = async () => {
    if (!nuevo.trim()) return;

    try {
      const payload = {
        categoria,
        valor: nuevo
      };

      if (categoria === 'carguera') {
        payload.equivalencia = nuevoContacto; // Contacto
        payload.otros = nuevoTelefono; // Teléfono
      }

      await api.post('/api/catalogo/catalogo-simple', payload);
      setNuevo('');
      setNuevoContacto('');
      setNuevoTelefono('');
      await recargarRegistros();
    } catch (err) {
      console.error('❌ Error al agregar:', err);
    }
  };

  const eliminarRegistro = async (id) => {
    if (!window.confirm('¿Estás seguro de eliminar este registro?')) return;
    try {
      await api.delete(`/api/catalogo/catalogo-simple/${id}`);
      setRegistros((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      const mensaje = err?.response?.data?.error || '❌ Error al eliminar';
      alert(mensaje);
      console.error(mensaje);
    }
  };

  const guardarEdicion = async (id) => {
    try {
      const payload = { valor: valorEditado };

      if (categoria === 'carguera') {
        payload.equivalencia = equivalenciaEditada; // Contacto
        payload.otros = otrosEditado; // Teléfono
      }

      await api.put(`/api/catalogo/catalogo-simple/${id}`, payload);
      setEditandoId(null);
      setValorEditado('');
      setEquivalenciaEditada('');
      setOtrosEditado('');
      await recargarRegistros();
    } catch (err) {
      console.error('❌ Error al editar:', err);
    }
  };

  const nombreCapitalizado = categoria?.charAt(0).toUpperCase() + categoria?.slice(1);

  // Filtro aplicado
  const registrosFiltrados = registros.filter((r) =>
    r.valor.toLowerCase().includes(filtro.toLowerCase())
  );

  const esCarguera = categoria === 'carguera';

  return (
    <div className="form-card">
      <h3>📚 Catálogo de {nombreCapitalizado || '...'}</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <input placeholder="Nuevo valor" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />

        {esCarguera && (
          <>
            <input
              placeholder="Contacto"
              value={nuevoContacto}
              onChange={(e) => setNuevoContacto(e.target.value)}
            />
            <input
              placeholder="Teléfono"
              value={nuevoTelefono}
              onChange={(e) => setNuevoTelefono(e.target.value)}
            />
          </>
        )}

        <button onClick={agregarRegistro}>➕ Agregar</button>
      </div>

      {/* 🔍 Buscador */}
      <input
        type="text"
        placeholder="🔍 Buscar valor..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className="form-control mb-2"
        style={{ marginBottom: '1rem', padding: '0.4rem', width: '100%' }}
      />

      <div className="tabla-scrollable">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Valor</th>
              {esCarguera && (
                <>
                  <th>Contacto</th>
                  <th>Teléfono</th>
                </>
              )}
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {registrosFiltrados.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>
                  {editandoId === r.id ? (
                    <input
                      value={valorEditado}
                      onChange={(e) => setValorEditado(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    r.valor
                  )}
                </td>

                {esCarguera && (
                  <>
                    <td>
                      {editandoId === r.id ? (
                        <input
                          value={equivalenciaEditada}
                          onChange={(e) => setEquivalenciaEditada(e.target.value)}
                        />
                      ) : (
                        r.equivalencia || ''
                      )}
                    </td>
                    <td>
                      {editandoId === r.id ? (
                        <input
                          value={otrosEditado}
                          onChange={(e) => setOtrosEditado(e.target.value)}
                        />
                      ) : (
                        r.Otros || ''
                      )}
                    </td>
                  </>
                )}

                <td>
                  {editandoId === r.id ? (
                    <>
                      <button onClick={() => guardarEdicion(r.id)}>💾</button>
                      <button
                        onClick={() => {
                          setEditandoId(null);
                          setValorEditado('');
                          setEquivalenciaEditada('');
                          setOtrosEditado('');
                        }}
                      >
                        ❌
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditandoId(r.id);
                          setValorEditado(r.valor);
                          if (esCarguera) {
                            setEquivalenciaEditada(r.equivalencia || '');
                            setOtrosEditado(r.Otros || '');
                          }
                        }}
                      >
                        ✏️
                      </button>
                      <button onClick={() => eliminarRegistro(r.id)}>🗑</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CatalogoFormulario;
