import { useEffect, useState } from 'react';
import api from '../services/api';

function PermisosCatalogoAdmin() {
  const [catalogo, setCatalogo] = useState([]);
  const [nuevo, setNuevo] = useState({ permiso: '', descripcion: '' });
  const [busqueda, setBusqueda] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [editandoData, setEditandoData] = useState({ permiso: '', descripcion: '' });

  useEffect(() => {
    cargarCatalogo();
  }, []);

  const cargarCatalogo = async () => {
    const res = await api.get('/api/permisos/catalogo');
    setCatalogo(res.data);
  };

  const guardarNuevo = async () => {
    if (!nuevo.permiso.trim()) return alert('❌ Falta el nombre del permiso');
    try {
      await api.post('/api/permisos/catalogo', nuevo);
      setNuevo({ permiso: '', descripcion: '' });
      cargarCatalogo();
    } catch (err) {
      alert('❌ Error al guardar');
    }
  };

  const eliminar = async (id) => {
    if (!window.confirm('¿Seguro de eliminar este permiso?')) return;
    try {
      await api.delete(`/api/permisos/catalogo/${id}`);
      cargarCatalogo();
    } catch (err) {
      alert('❌ Error al eliminar');
    }
  };

  const iniciarEdicion = (permiso) => {
    setEditandoId(permiso.id);
    setEditandoData({ permiso: permiso.permiso, descripcion: permiso.descripcion });
  };

  const cancelarEdicion = () => {
    setEditandoId(null);
    setEditandoData({ permiso: '', descripcion: '' });
  };

  const guardarEdicion = async () => {
    try {
      await api.put(`/api/permisos/catalogo/${editandoId}`, editandoData);
      setEditandoId(null);
      setEditandoData({ permiso: '', descripcion: '' });
      cargarCatalogo();
    } catch (err) {
      alert('❌ Error al guardar los cambios');
    }
  };

  const catalogoFiltrado = catalogo.filter(
    (p) =>
      p.permiso.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.descripcion.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '16px' }}>
      <h2>⚙️ Catálogo de Permisos</h2>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          value={nuevo.permiso}
          placeholder="Nombre (ej. guardar_factura)"
          onChange={(e) => setNuevo({ ...nuevo, permiso: e.target.value })}
          style={{ flex: 1, padding: '6px' }}
        />
        <input
          value={nuevo.descripcion}
          placeholder="Descripción"
          onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
          style={{ flex: 2, padding: '6px' }}
        />
        <button onClick={guardarNuevo} style={{ padding: '6px 12px' }}>
          ➕ Agregar
        </button>
      </div>

      <input
        placeholder="🔍 Buscar permiso o descripción..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        style={{
          width: '100%',
          marginBottom: '12px',
          padding: '8px',
          border: '1px solid #ccc',
          borderRadius: '4px'
        }}
      />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ backgroundColor: '#f0f0f0' }}>
            <tr>
              <th style={{ padding: '8px' }}>#</th>
              <th style={{ padding: '8px' }}>Permiso</th>
              <th style={{ padding: '8px' }}>Descripción</th>
              <th style={{ padding: '8px' }}>✏️</th>
              <th style={{ padding: '8px' }}>🗑️</th>
            </tr>
          </thead>
          <tbody>
            {catalogoFiltrado.map((p) => (
              <tr key={p.id}>
                <td style={{ padding: '6px' }}>{p.id}</td>
                <td style={{ padding: '6px' }}>
                  {editandoId === p.id ? (
                    <input
                      value={editandoData.permiso}
                      onChange={(e) =>
                        setEditandoData({ ...editandoData, permiso: e.target.value })
                      }
                      style={{ width: '100%' }}
                    />
                  ) : (
                    p.permiso
                  )}
                </td>
                <td style={{ padding: '6px' }}>
                  {editandoId === p.id ? (
                    <input
                      value={editandoData.descripcion}
                      onChange={(e) =>
                        setEditandoData({ ...editandoData, descripcion: e.target.value })
                      }
                      style={{ width: '100%' }}
                    />
                  ) : (
                    p.descripcion
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {editandoId === p.id ? (
                    <>
                      <button onClick={guardarEdicion} style={{ marginRight: '6px' }}>
                        💾
                      </button>
                      <button onClick={cancelarEdicion}>❌</button>
                    </>
                  ) : (
                    <button onClick={() => iniciarEdicion(p)}>✏️</button>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button onClick={() => eliminar(p.id)}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PermisosCatalogoAdmin;
