import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const SessionContext = createContext();

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);

  /**
   * 🔄 Al cargar, recuperar usuario del localStorage
   */
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);

        // 🔁 Compatibilidad con formatos viejos
        if (parsed.idusuario && !parsed.id) {
          parsed.id = parsed.idusuario;
          delete parsed.idusuario;
        }

        setUser(parsed);
      } catch (error) {
        console.error('❌ Error al parsear usuario en localStorage:', error);
        localStorage.removeItem('user'); // Borra corrupto
      }
    }
  }, []);

  /**
   * ✅ Login
   */
  const login = (datos) => {
    if (!datos) return;

    // Normaliza: asegura que tenga campo id
    const normalizado = {
      ...datos,
      id: datos.id ?? datos.idusuario
    };
    delete normalizado.idusuario;

    setUser(normalizado);
    localStorage.setItem('user', JSON.stringify(normalizado));
  };

  /**
   * ✅ Logout
   * Limpia usuario del state, localStorage y desbloquea sus pedidos en base
   */
  const logout = async () => {
    try {
      if (user?.id) {
        await api.post('/api/pedidos/desbloquear-usuario', { idusuario: user.id });
      }
    } catch (err) {
      console.error('⚠️ Error limpiando bloqueos en servidor:', err);
    } finally {
      setUser(null);
      localStorage.removeItem('user');
    }
  };

  /**
   * ✅ Limpieza automática al cerrar pestaña o recargar
   */
  useEffect(() => {
    const handleUnload = () => {
      if (user?.id) {
        try {
          navigator.sendBeacon(
            '/api/pedidos/desbloquear-usuario',
            JSON.stringify({ idusuario: user.id })
          );
        } catch (err) {
          console.error('⚠️ Error enviando beacon de desbloqueo:', err);
        }
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [user]);

  return (
    <SessionContext.Provider value={{ user, login, logout }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

export { SessionContext };
