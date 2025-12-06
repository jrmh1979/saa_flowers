import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import api from '../services/api';

function LoginForm() {
  // 👇 Usamos keys estándar: email / password (para autocomplete)
  const [form, setForm] = useState({ email: '', password: '' });
  const [verPassword, setVerPassword] = useState(false);

  // Logo / empresa
  const [logoSrc, setLogoSrc] = useState('/logo.png');
  const [empresaNombre, setEmpresaNombre] = useState('Logo');

  const { login } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/api/empresa/emisor');
        if (data?.logo_base64) setLogoSrc(`data:image/*;base64,${data.logo_base64}`);
        const nombre = data?.nombre_comercial || data?.razon_social;
        if (nombre) setEmpresaNombre(nombre);
      } catch {
        // Silencioso: si requiere token o no existe, usamos /logo.png
      }
    })();
  }, []);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // 👇 Mapeamos a los nombres que espera tu backend
      const payload = { correo: form.email, contrasena: form.password };
      const res = await api.post('/api/usuarios/login', payload);
      const usuario = res.data?.usuario;

      if (!usuario) throw new Error('Respuesta inválida del servidor');

      const id = usuario.id ?? usuario.idusuario;
      if (!id) throw new Error('El usuario no tiene ID válido');

      login({
        id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        correo: usuario.correo,
        activo: usuario.activo,
        permisos: usuario.permisos,
        token: res.data.token
      });

      navigate('/dashboard');
    } catch (err) {
      console.error('❌ Error al iniciar sesión:', err);
      const msg = err?.response?.data?.error || err?.response?.data || err.message;
      alert('❌ Error al iniciar sesión: ' + msg);
    }
  };

  return (
    <div className="login-container">
      {/* 👇 Habilitamos autocomplete a nivel de formulario */}
      <form className="login-card" onSubmit={handleSubmit} autoComplete="on">
        <img
          src={logoSrc}
          alt={empresaNombre}
          className="login-logo"
          style={{ objectFit: 'contain', maxHeight: 80 }}
        />
        <h2>Iniciar Sesión</h2>

        {/* Campo de usuario (email) */}
        <input
          className="login-input"
          type="email"
          name="email" // nombre estándar
          placeholder="Correo"
          value={form.email}
          onChange={handleChange}
          autoComplete="username" // ✅ para emparejar con current-password
          inputMode="email"
          required
        />

        {/* Campo de contraseña */}
        <div style={{ position: 'relative', width: '100%' }}>
          <input
            className="login-input"
            type={verPassword ? 'text' : 'password'}
            name="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={handleChange}
            autoComplete="current-password"
            required
            style={{ paddingRight: '2.5rem' }}
          />
          <span
            onClick={() => setVerPassword(!verPassword)}
            style={{
              position: 'absolute',
              top: '50%',
              right: '10px',
              transform: 'translateY(-50%)',
              cursor: 'pointer'
            }}
            title={verPassword ? 'Ocultar' : 'Mostrar'}
            aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="20"
              viewBox="0 0 24 24"
              width="20"
              fill="currentColor"
            >
              {verPassword ? (
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c.64 1.56 1.67 2.97 2.97 4.13L2 20l1.41 1.41 18-18L20 2l-3.91 3.91C15.07 5.61 13.59 5 12 5v-.5zM5.27 7.09 9.11 10.93C9.04 11.28 9 11.63 9 12c0 1.66 1.34 3 3 3 .37 0 .72-.04 1.07-.11l2.84 2.84C14.67 18.07 13.38 18.5 12 18.5c-4.42 0-8-3.58-8-8 0-1.38.43-2.67 1.27-3.91zM22 12c-1.18-2.93-3.62-5.17-6.65-6.09L16.06 7c1.97.87 3.58 2.36 4.51 4.22-.64 1.56-1.67 2.97-2.97 4.13l1.41 1.41C21.27 15.59 22.36 13.9 23 12z" />
              ) : (
                <path d="M12 6.5C7 6.5 2.73 9.61 1 14c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 9.61 17 6.5 12 6.5zm0 12c-2.48 0-4.5-2.02-4.5-4.5S9.52 9.5 12 9.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5z" />
              )}
            </svg>
          </span>
        </div>

        <button className="login-card-button" type="submit">
          Entrar
        </button>
      </form>
    </div>
  );
}

export default LoginForm;
