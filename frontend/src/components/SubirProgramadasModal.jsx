import React, { useEffect, useState } from 'react';
import api from '../services/api';

export default function SubirProgramadasModal({ open, onClose, onSuccess }) {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);

  // cerrar con ESC
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && open && onClose?.();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const overlay = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  };
  const card = {
    background: '#fff',
    padding: 16,
    borderRadius: 12,
    width: 480,
    maxWidth: '95vw',
    boxShadow: '0 10px 30px rgba(0,0,0,.2)'
  };

  const submit = async (e) => {
    e?.preventDefault();
    try {
      setLoading(true);
      const { data } = await api.post('/api/ordenes-fijas/subir', { fecha });
      setResultado(data);
      if (data?.ok) onSuccess?.(data);
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.msg || err.message || 'Error al subir programadas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <form style={card} onSubmit={submit}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Subir órdenes programadas</h3>
        <p style={{ color: '#667085', fontSize: 12, marginTop: 4 }}>
          Se generarán las plantillas cuyo día coincida con la fecha.
        </p>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>Fecha (vuelo/embarque)</div>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </div>

        {resultado && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              fontSize: 13
            }}
          >
            <div>
              <b>OK:</b> {String(resultado.ok)}
            </div>
            {'generados' in resultado && <div>Detalles generados: {resultado.generados}</div>}
            {'plantillas' in resultado && <div>Plantillas aplicadas: {resultado.plantillas}</div>}
            {resultado.msg && <div>Mensaje: {resultado.msg}</div>}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 14px' }}
            disabled={loading}
          >
            Cerrar
          </button>
          <button
            type="submit"
            style={{
              padding: '8px 14px',
              background: '#059669',
              color: '#fff',
              border: 0,
              borderRadius: 8
            }}
            disabled={loading}
          >
            {loading ? 'Procesando...' : 'Subir programadas'}
          </button>
        </div>
      </form>
    </div>
  );
}
