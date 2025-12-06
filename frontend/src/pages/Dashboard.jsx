import { useSession } from '../context/SessionContext';

function Dashboard() {
  const { user } = useSession();

  return (
    <div>
      <h2>Bienvenido, {user?.nombre || 'Usuario'}</h2>
      <p>Usa el menú lateral para comenzar.</p>
    </div>
  );
}

export default Dashboard;

