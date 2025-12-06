import { useRef } from 'react';
import api from '../services/api';
import { useSession } from '../context/SessionContext';

function ImportadorVilnius({
  idfactura,
  onImportacionFinalizada,
  loadingVilnius,
  setLoadingVilnius
}) {
  const inputRef = useRef();
  const { user } = useSession();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const archivo = inputRef.current.files[0];

    if (!archivo || !idfactura) {
      alert('Selecciona un archivo y asegúrate de tener una factura activa.');
      return;
    }

    const formData = new FormData();
    formData.append('archivo', archivo);
    formData.append('idfactura', idfactura);

    try {
      setLoadingVilnius(true);
      const res = await api.post('/api/importar/vilnius', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const cantidad = res.data?.cantidad || 0;
      const nombre = user?.nombre?.toUpperCase?.() || 'USUARIO';

      alert(
        `✅ HOLA ${nombre} SE MIGRARON ${cantidad} REGISTROS PARA EL PEDIDO ${idfactura} CORRECTAMENTE`
      );

      inputRef.current.value = '';
      setTimeout(() => {
        if (onImportacionFinalizada) onImportacionFinalizada();
      }, 500);
    } catch (err) {
      alert('❌ Error al importar: ' + (err.response?.data || err.message));
    } finally {
      setLoadingVilnius(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
      <h3>🟢 Importar archivo Vilnius (.xlsx)</h3>
      <input type="file" accept=".xlsx" ref={inputRef} required disabled={loadingVilnius} />
      <button type="submit" disabled={loadingVilnius}>
        {loadingVilnius ? 'Migrando...' : 'Subir archivo Vilnius'}
      </button>
    </form>
  );
}

export default ImportadorVilnius;
