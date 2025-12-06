import { useState } from 'react';
import Sidebar from './Sidebar';

function Layout({ children }) {
  const [menuVisible, setMenuVisible] = useState(true);

  return (
    <div className={`dashboard-container ${menuVisible ? '' : 'menu-oculto'}`}>
      {/* Botón hamburguesa flotante */}
      <button
        className="sidebar-toggle"
        onClick={() => setMenuVisible(!menuVisible)}
      >
        ☰
      </button>

      {/* Menú lateral */}
      <div className="sidebar">
        <Sidebar />
      </div>

      {/* Contenido principal */}
      <main className="dashboard-main">
        {/* Scroll vertical interno */}
        <div className="dashboard-scroll-area">
          {children}
        </div>
      </main>
    </div>
  );
}

export default Layout;
