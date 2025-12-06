import React, { useEffect, useState } from 'react';
import api from '../services/api';

const ModalAsignarEtiqueta = ({ idfactura, open, onClose, onAsignado }) => {
  const [labels, setLabels] = useState([]);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [pdfData, setPdfData] = useState(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  useEffect(() => {
    if (open) {
      api.get('/api/catalogo?categoria=etiqueta')
        .then(res => setLabels(res.data))
        .catch(err => {
          console.error('❌ Error cargando etiquetas:', err);
          alert('❌ Error cargando etiquetas');
        });

      setSelectedLabel('');
      setPdfData(null);
    }
  }, [open]);

  const asignarEtiqueta = async () => {
    if (!selectedLabel) {
      alert('⚠️ Debes seleccionar un label base');
      return;
    }
    try {
      await api.post(`/api/etiquetas/asignar`, {
        idfactura,
        base: selectedLabel
      });
      alert('✅ Etiquetas asignadas correctamente');
      onAsignado?.();
    } catch (err) {
      console.error('❌ Error asignando etiquetas:', err);
      alert('❌ Ocurrió un error al asignar las etiquetas');
    }
  };

  const verEtiquetas = async () => {
    setLoadingPdf(true);
    try {
      const response = await api.get(`/api/facturas/${idfactura}/etiquetas/pdf`, {
        responseType: 'blob'
      });
      const url = URL.createObjectURL(response.data);
      setPdfData(url);
    } catch (err) {
      console.error('❌ Error al cargar etiquetas PDF:', err);
      alert('❌ No se pudo cargar el PDF de etiquetas');
    } finally {
      setLoadingPdf(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ display: 'flex', maxWidth: '90vw', minWidth: '800px' }}>
        {/* LADO IZQUIERDO */}
        <div style={{ flex: 1 }}>
          <h4>Asignar etiquetas</h4>
          <select
            value={selectedLabel}
            onChange={e => setSelectedLabel(e.target.value)}
            style={{ width: '100%', marginBottom: '1rem' }}
          >
            <option value="">-- Selecciona un label base --</option>
            {labels.map(et => (
              <option key={et.id} value={et.valor}>{et.valor}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={asignarEtiqueta} disabled={!selectedLabel}>Aplicar</button>
            <button onClick={onClose}>Cancelar</button>
            <button onClick={verEtiquetas} disabled={loadingPdf}>
              {loadingPdf ? 'Cargando PDF...' : '📄 Ver etiquetas PDF'}
            </button>
          </div>
        </div>

        {/* LADO DERECHO */}
        {pdfData && (
          <div style={{ flex: 1.5, marginLeft: '2rem' }}>
            <label style={{ fontWeight: 'bold' }}>Vista previa PDF</label>
            <iframe
              src={pdfData}
              style={{ width: '100%', height: '500px', border: '1px solid #ccc', marginTop: '0.5rem' }}
              title="Vista previa etiquetas"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ModalAsignarEtiqueta;
