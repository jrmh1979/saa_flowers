import './licenseConfig';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider, useSession } from './context/SessionContext';

import LoginForm from './components/LoginForm';
import Dashboard from './pages/Dashboard';
import PedidosLista from './components/PedidosLista';
import TercerosForm from './components/TercerosForm';
import CatalogoFormulario from './components/CatalogoFormulario';
import FacturaForm from './components/FacturaForm';
import FacturaDetalleEditable from './components/FacturaDetalleEditable';
import ReporteDinamico from './components/ReporteDinamico';
import UsuariosCrud from './components/UsuariosCrud';
import PermisosForm from './components/PermisosForm';
import PermisosCatalogoAdmin from './components/PermisosCatalogoAdmin';
import CarteraPage from './components/CarteraPage';
import Layout from './components/Layout';
import InventarioFlorGrid from './components/InventarioFlorGrid';
import EmisorConfig from './components/EmisorConfig';
import DAEForm from './components/DAEForm'; // ⬅️ NUEVO
import './assets/style.css';

function ProtectedRoute({ children }) {
  const { user } = useSession();
  return user ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  if (user.rol !== 'admin') return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <SessionProvider>
      <Router>
        <Routes>
          {/* Login sin protección */}
          <Route path="/login" element={<LoginForm />} />

          {/* Rutas protegidas */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/crear-pedido"
            element={
              <ProtectedRoute>
                <FacturaForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pedidos"
            element={
              <ProtectedRoute>
                <PedidosLista />
              </ProtectedRoute>
            }
          />
          <Route
            path="/facturas"
            element={
              <ProtectedRoute>
                <FacturaDetalleEditable />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reporte-factura"
            element={
              <ProtectedRoute>
                <ReporteDinamico />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cartera"
            element={
              <ProtectedRoute>
                <CarteraPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventario-flor"
            element={
              <ProtectedRoute>
                <InventarioFlorGrid />
              </ProtectedRoute>
            }
          />
          <Route
            path="/terceros"
            element={
              <ProtectedRoute>
                <TercerosForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/catalogo"
            element={
              <ProtectedRoute>
                <CatalogoFormulario />
              </ProtectedRoute>
            }
          />

          <Route
            path="/dae"
            element={
              <ProtectedRoute>
                <DAEForm />
              </ProtectedRoute>
            }
          />

          {/* Seguridad (solo admin) */}
          <Route
            path="/usuarios"
            element={
              <AdminRoute>
                <UsuariosCrud />
              </AdminRoute>
            }
          />
          <Route
            path="/permisos"
            element={
              <AdminRoute>
                <PermisosForm />
              </AdminRoute>
            }
          />
          <Route
            path="/permisos-catalogo"
            element={
              <AdminRoute>
                <PermisosCatalogoAdmin />
              </AdminRoute>
            }
          />

          {/* Configuración del Emisor (empresa) */}
          <Route
            path="/config/emisor"
            element={
              <AdminRoute>
                <EmisorConfig />
              </AdminRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </SessionProvider>
  );
}

export default App;
