import { useEffect, useState } from 'react';
import api from '../services/api';

function UsuariosCrud() {
  const [usuarios, setUsuarios] = useState([]);
  const [nuevoUsuario, setNuevoUsuario] = useState({
    nombre: '',
    correo: '',
    contrasena: '',
    rol: 'usuario',
    activo: 1
  });
  const [modoEdicion, setModoEdicion] = useState(null);

  useEffect(() => {
    fetchUsuarios();
  }, []);

  const fetchUsuarios = async () => {
    try {
      const res = await api.get('/api/usuarios/listar');
      if (Array.isArray(res.data)) {
        setUsuarios(res.data);
      } else {
        console.warn('⚠️ La respuesta no es un array:', res.data);
        setUsuarios([]);
      }
    } catch (err) {
      console.error('❌ Error al cargar usuarios:', err);
      setUsuarios([]);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? (checked ? 1 : 0) : value;
    setNuevoUsuario((prev) => ({ ...prev, [name]: newValue }));
  };

  const agregarUsuario = async () => {
    try {
      if (!nuevoUsuario.nombre || !nuevoUsuario.correo || !nuevoUsuario.contrasena) {
        alert('⚠️ Faltan datos obligatorios');
        return;
      }

      await api.post('/api/usuarios', nuevoUsuario);
      await fetchUsuarios();
      setNuevoUsuario({ nombre: '', correo: '', contrasena: '', rol: 'usuario', activo: 1 });
    } catch (err) {
      alert('❌ Error: ' + (err.response?.data || err.message));
    }
  };

  const editarUsuario = (user) => {
    setModoEdicion(user.idusuario); // usa idusuario del backend
    setNuevoUsuario({
      nombre: user.nombre,
      correo: user.correo,
      contrasena: '',
      rol: user.rol || 'usuario',
      activo: user.activo ? 1 : 0
    });
  };

  const guardarEdicion = async () => {
    try {
      await api.put(`/api/usuarios/${modoEdicion}`, nuevoUsuario);
      setModoEdicion(null);
      setNuevoUsuario({ nombre: '', correo: '', contrasena: '', rol: 'usuario', activo: 1 });
      await fetchUsuarios();
    } catch (err) {
      alert('❌ Error al actualizar: ' + (err.response?.data || err.message));
    }
  };

  return (
    <div>
      <h2>👤 Gestión de Usuarios</h2>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Correo</th>
            <th>Rol</th>
            <th>Activo</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((user) => (
            <tr key={user.idusuario}>
              <td>{user.nombre}</td>
              <td>{user.correo}</td>
              <td>{user.rol}</td>
              <td>{user.activo ? '✅' : '❌'}</td>
              <td>
                <button onClick={() => editarUsuario(user)}>✏️ Editar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{modoEdicion ? '🔁 Actualizar Usuario' : '💾 Nuevo Usuario'}</h3>
      <input
        name="nombre"
        placeholder="Nombre"
        value={nuevoUsuario.nombre}
        onChange={handleChange}
      />
      <input
        name="correo"
        placeholder="Correo"
        value={nuevoUsuario.correo}
        onChange={handleChange}
      />
      <input
        type="password"
        name="contrasena"
        placeholder="Contraseña"
        value={nuevoUsuario.contrasena}
        onChange={handleChange}
      />
      <select name="rol" value={nuevoUsuario.rol} onChange={handleChange}>
        <option value="usuario">Usuario</option>
        <option value="admin">Administrador</option>
      </select>
      <label style={{ marginLeft: '1rem' }}>
        <input
          type="checkbox"
          name="activo"
          checked={nuevoUsuario.activo === 1}
          onChange={handleChange}
        />
        Activo
      </label>

      <button
        onClick={modoEdicion ? guardarEdicion : agregarUsuario}
        style={{ marginLeft: '1rem' }}
      >
        {modoEdicion ? '🔁 Actualizar' : '💾 Guardar'}
      </button>

      {modoEdicion && (
        <button
          onClick={() => {
            setModoEdicion(null);
            setNuevoUsuario({ nombre: '', correo: '', contrasena: '', rol: 'usuario', activo: 1 });
          }}
          style={{ marginLeft: '1rem' }}
        >
          ❌ Cancelar
        </button>
      )}
    </div>
  );
}

export default UsuariosCrud;
