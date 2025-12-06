import { useEffect, useState } from 'react';
import api from '../services/api';

function PermisosForm() {
  const [usuarios, setUsuarios] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [permisosAsignados, setPermisosAsignados] = useState([]);
  const [catalogoPermisos, setCatalogoPermisos] = useState([]);

  useEffect(() => {
    cargarUsuarios();
    cargarCatalogoPermisos();
  }, []);

  const cargarUsuarios = async () => {
    const res = await api.get('/api/usuarios/listar');
    const ordenados = res.data.sort((a, b) => a.nombre.localeCompare(b.nombre));
    setUsuarios(ordenados);
  };

  const cargarCatalogoPermisos = async () => {
    const res = await api.get('/api/permisos/catalogo');
    setCatalogoPermisos(res.data);
  };

  const cargarPermisos = async (idusuario) => {
    setSeleccionado(idusuario);
    const res = await api.get(`/api/permisos/usuario/${idusuario}`);
    const permisosIds = res.data.map((p) => p.permiso);
    setPermisosAsignados(permisosIds);
  };

  const togglePermiso = (permisoNombre) => {
    if (permisosAsignados.includes(permisoNombre)) {
      setPermisosAsignados((prev) => prev.filter((p) => p !== permisoNombre));
    } else {
      setPermisosAsignados((prev) => [...prev, permisoNombre]);
    }
  };

  const guardar = async () => {
    const idsSeleccionados = catalogoPermisos
      .filter((p) => permisosAsignados.includes(p.permiso))
      .map((p) => p.id);

    await api.post('/api/permisos/asignar', {
      idusuario: seleccionado,
      idpermisos: idsSeleccionados
    });

    alert('✅ Permisos actualizados');
  };

  return (
    <div>
      <h2>🔐 Permisos por Usuario</h2>
      <select onChange={(e) => cargarPermisos(e.target.value)} value={seleccionado || ''}>
        <option value="">-- Seleccionar usuario --</option>
        {usuarios.map((u) => (
          <option key={u.idusuario} value={u.idusuario}>
            {u.nombre}
          </option>
        ))}
      </select>

      {seleccionado && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Permisos asignados:</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '8px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '12px',
              backgroundColor: '#f9f9f9'
            }}
          >
            {catalogoPermisos.map((permiso) => (
              <label
                key={permiso.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  backgroundColor: permisosAsignados.includes(permiso.permiso) ? '#e8fce8' : '#fff',
                  fontSize: '14px',
                  fontWeight: '400'
                }}
              >
                <input
                  type="checkbox"
                  checked={permisosAsignados.includes(permiso.permiso)}
                  onChange={() => togglePermiso(permiso.permiso)}
                  style={{
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer',
                    accentColor: '#007bff',
                    margin: 0
                  }}
                />
                <span>
                  <strong>{permiso.permiso}</strong> - {permiso.descripcion}
                </span>
              </label>
            ))}
          </div>
          <button
            onClick={guardar}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              backgroundColor: '#27ae60',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            💾 Guardar
          </button>
        </div>
      )}
    </div>
  );
}

export default PermisosForm;
