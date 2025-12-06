import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import api from '../services/api';

function Sidebar() {
  const [categorias, setCategorias] = useState([]);
  const [permisos, setPermisos] = useState({});
  const [adminAbierto, setAdminAbierto] = useState(false);
  const [seguridadAbierto, setSeguridadAbierto] = useState(false);
  const [tercerosAbierto, setTercerosAbierto] = useState(false);
  const [procesoAbierto, setProcesoAbierto] = useState(true);
  const location = useLocation();
  const { user } = useSession();

  useEffect(() => {
    async function cargarCategorias() {
      try {
        const res = await api.get('/api/catalogo/categorias');
        setCategorias(res.data);
      } catch (err) {
        console.error('❌ Error al cargar categorías:', err);
      }
    }

    async function cargarPermisosUsuario() {
      try {
        if (user?.id) {
          const res = await api.get(`/api/permisos/usuario/${user.id}`);
          const mapa = {};
          res.data.forEach((p) => (mapa[p.permiso] = true));

          // ✅ Si es admin, asegurar accesos de seguridad, emisor y DAE
          if (user.rol === 'admin') {
            mapa['usuarios'] = true;
            mapa['permisos'] = true;
            mapa['catalogo_permisos'] = true;
            mapa['empresa_config'] = true; // Emisor (SRI)
            mapa['dae'] = true; // DAE listado/uso
            mapa['dae_admin'] = true; // DAE administración/CRUD
          }

          setPermisos(mapa);
        }
      } catch (err) {
        console.error('❌ Error al cargar permisos:', err);
      }
    }

    cargarCategorias();
    cargarPermisosUsuario();
  }, [user]);

  const puede = (permiso) => user?.rol === 'admin' || permisos[permiso];
  const excluir = ['no_usar', 'interno'];
  const isActive = (pathStart) => location.pathname.startsWith(pathStart);

  const puedeVerSeguridad =
    user?.rol === 'admin' ||
    permisos['usuarios'] ||
    permisos['permisos'] ||
    permisos['catalogo_permisos'] ||
    permisos['empresa_config'];

  // 👇 Ahora Administración se muestra si hay permisos de catálogos o DAE
  const puedeVerAdministracion =
    categorias.some((obj) => puede('catalogo_admin') || puede(`catalogo_${obj.categoria}`)) ||
    puede('dae') ||
    puede('dae_admin');

  return (
    <div className="sidebar">
      <h3>📚 Menú</h3>

      {/* Proceso */}
      <button onClick={() => setProcesoAbierto(!procesoAbierto)}>
        📦 Proceso {procesoAbierto ? '▲' : '▼'}
      </button>
      {procesoAbierto && (
        <ul>
          {puede('crear_pedido') && (
            <li>
              <Link className={isActive('/crear-pedido') ? 'active-link' : ''} to="/crear-pedido">
                📝 Crear Pedido
              </Link>
            </li>
          )}

          {puede('facturas') && (
            <li>
              <Link className={isActive('/facturas') ? 'active-link' : ''} to="/facturas">
                📁 Facturas
              </Link>
            </li>
          )}
          {puede('cartera') && (
            <li>
              <Link className={isActive('/cartera') ? 'active-link' : ''} to="/cartera">
                📒 Cartera
              </Link>
            </li>
          )}
          {puede('reporte_facturas') && (
            <li>
              <Link
                className={isActive('/reporte-factura') ? 'active-link' : ''}
                to="/reporte-factura"
              >
                📊 Reporte Facturas
              </Link>
            </li>
          )}
        </ul>
      )}

      {/* Terceros */}
      <button onClick={() => setTercerosAbierto(!tercerosAbierto)}>
        👥 Terceros {tercerosAbierto ? '▲' : '▼'}
      </button>
      {tercerosAbierto && (
        <ul>
          {puede('clientes') && (
            <li>
              <Link
                className={location.search.includes('cliente') ? 'active-link' : ''}
                to="/terceros?tipo=cliente"
              >
                🧑‍💼 Clientes
              </Link>
            </li>
          )}
          {puede('proveedores') && (
            <li>
              <Link
                className={location.search.includes('proveedor') ? 'active-link' : ''}
                to="/terceros?tipo=proveedor"
              >
                🚛 Proveedores
              </Link>
            </li>
          )}
        </ul>
      )}

      {/* Administración */}
      {puedeVerAdministracion && (
        <>
          <button onClick={() => setAdminAbierto(!adminAbierto)}>
            ⚙️ Administración {adminAbierto ? '▲' : '▼'}
          </button>

          {adminAbierto && (
            <ul>
              {/* Catálogos (dinámicos) */}
              {categorias
                .map((obj) => obj.categoria)
                .filter((cat) => !excluir.includes(cat))
                .filter((cat) => puede('catalogo_admin') || puede(`catalogo_${cat}`))
                .map((cat) => (
                  <li key={cat}>
                    <Link
                      className={location.search.includes(cat) ? 'active-link' : ''}
                      to={`/catalogo?categoria=${cat}`}
                    >
                      📌 {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Link>
                  </li>
                ))}

              {/* 🔹 Nuevo: DAE (CRUD) */}
              {(puede('dae') || puede('dae_admin')) && (
                <li>
                  <Link className={isActive('/dae') ? 'active-link' : ''} to="/dae">
                    📄 DAE
                  </Link>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {/* Seguridad */}
      {puedeVerSeguridad && (
        <>
          <button onClick={() => setSeguridadAbierto(!seguridadAbierto)}>
            🔑 Seguridad {seguridadAbierto ? '▲' : '▼'}
          </button>
          {seguridadAbierto && (
            <ul>
              {puede('usuarios') && (
                <li>
                  <Link className={isActive('/usuarios') ? 'active-link' : ''} to="/usuarios">
                    👤 Usuarios
                  </Link>
                </li>
              )}
              {puede('permisos') && (
                <li>
                  <Link className={isActive('/permisos') ? 'active-link' : ''} to="/permisos">
                    🔐 Permisos
                  </Link>
                </li>
              )}
              {puede('catalogo_permisos') && (
                <li>
                  <Link
                    className={isActive('/permisos-catalogo') ? 'active-link' : ''}
                    to="/permisos-catalogo"
                  >
                    📂 Catálogo de Permisos
                  </Link>
                </li>
              )}
              {(user?.rol === 'admin' || permisos['empresa_config']) && (
                <li>
                  <Link
                    className={isActive('/config/emisor') ? 'active-link' : ''}
                    to="/config/emisor"
                  >
                    🏷️ Emisor (SRI)
                  </Link>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #444' }}>
        <Link to="/logout">🔓 Cerrar sesión</Link>
      </div>
    </div>
  );
}

export default Sidebar;
