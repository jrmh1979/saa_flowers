import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const DOW_OPTS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' }
];

const FREQ_OPTS = ['SEMANAL', 'BISEMANAL', 'ODD_WEEKS', 'EVEN_WEEKS'];

export default function ProgramarDesdeFacturaModal({
  open,
  onClose,
  selectedDetalleIds = [], // IDs (iddetalle) seleccionados en la grilla
  defaultCliente = '',
  defaultCarguera = '',
  onSuccess // callback(data)
}) {
  const [form, setForm] = useState({
    Idcliente: defaultCliente || '',
    idcarguera: defaultCarguera || '',
    dia_semana: 1,
    frecuencia: 'SEMANAL',
    fecha_inicio: '',
    fecha_fin: '',
    lead_time_dias: 3,
    observaciones: ''
  });
  const [loading, setLoading] = useState(false);

  // sincroniza defaults cuando abra el modal o cambien props
  useEffect(() => {
    if (open) {
      setForm((f) => ({
        ...f,
        Idcliente: defaultCliente || '',
        idcarguera: defaultCarguera || ''
      }));
    }
  }, [open, defaultCliente, defaultCarguera]);

  // cerrar con ESC
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && open && onClose?.();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  const disabled = useMemo(
    () =>
      !form.Idcliente ||
      !form.idcarguera ||
      !form.dia_semana ||
      selectedDetalleIds.length === 0 ||
      loading,
    [form, selectedDetalleIds, loading]
  );

  const handle = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (disabled) return;
    try {
      setLoading(true);
      const payload = {
        Idcliente: Number(form.Idcliente),
        idcarguera: Number(form.idcarguera),
        dia_semana: Number(form.dia_semana),
        frecuencia: form.frecuencia,
        fecha_inicio: form.fecha_inicio || null,
        fecha_fin: form.fecha_fin || null,
        lead_time_dias: Number(form.lead_time_dias || 3),
        observaciones: form.observaciones || null,
        iddetalle_list: selectedDetalleIds
      };
      const { data } = await api.post('/ordenes-fijas/from-factura', payload);
      if (data?.ok) {
        onSuccess?.(data);
        onClose?.();
      } else {
        alert(data?.msg || 'No se pudo programar.');
      }
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.msg || err.message || 'Error al programar');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  // estilos simples sin dependencias
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
    width: 680,
    maxWidth: '95vw',
    boxShadow: '0 10px 30px rgba(0,0,0,.2)'
  };
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  return (
    <div style={overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <form style={card} onSubmit={submit}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Programar orden fija</h3>
        <div style={{ color: '#667085', fontSize: 12, marginTop: 6, marginBottom: 16 }}>
          Seleccionadas: {selectedDetalleIds.length} filas.
        </div>

        <div style={grid2}>
          <label>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Cliente (Idcliente)</div>
            <input
              name="Idcliente"
              type="number"
              value={form.Idcliente}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Carguera (idcarguera)</div>
            <input
              name="idcarguera"
              type="number"
              value={form.idcarguera}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            />
          </label>

          <label>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Día de la semana</div>
            <select
              name="dia_semana"
              value={form.dia_semana}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            >
              {DOW_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Frecuencia</div>
            <select
              name="frecuencia"
              value={form.frecuencia}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            >
              {FREQ_OPTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Fecha inicio (opcional)</div>
            <input
              name="fecha_inicio"
              type="date"
              value={form.fecha_inicio}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Fecha fin (opcional)</div>
            <input
              name="fecha_fin"
              type="date"
              value={form.fecha_fin}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            />
          </label>

          <label>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Lead time (días)</div>
            <input
              name="lead_time_dias"
              type="number"
              min={0}
              value={form.lead_time_dias}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Observaciones</div>
            <textarea
              name="observaciones"
              rows={3}
              value={form.observaciones}
              onChange={handle}
              style={{ width: '100%', padding: 8 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 14px' }}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={disabled}
            style={{
              padding: '8px 14px',
              background: '#2563eb',
              color: '#fff',
              border: 0,
              borderRadius: 8
            }}
          >
            {loading ? 'Guardando...' : 'Guardar programación'}
          </button>
        </div>
      </form>
    </div>
  );
}
