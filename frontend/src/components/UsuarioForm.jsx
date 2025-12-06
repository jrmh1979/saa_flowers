import { useState } from 'react';
import api from '../services/api';

function UsuarioForm() {
  const [form, setForm] = useState({
    nombre: '',
    correo: '',
    contrasena: ''
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/usuarios', form);
      alert('✅ Usuario registrado correctamente');
      setForm({ nombre: '', correo: '', contrasena: '' });
    } catch (err) {
      alert('❌ Error al registrar usuario: ' + err.response?.data || err.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Registrar Usuario</h2>
      <input type="text" name="nombre" value={form.nombre} onChange={handleChange} placeholder="Nombre" required />
      <input type="email" name="correo" value={form.correo} onChange={handleChange} placeholder="Correo" required />
      <input type="password" name="contrasena" value={form.contrasena} onChange={handleChange} placeholder="Contraseña" required />
      <button type="submit">Registrar</button>
    </form>
  );
}

export default UsuarioForm;
