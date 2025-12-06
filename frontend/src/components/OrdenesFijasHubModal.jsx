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

function niceDate(d) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const x = new Date(s);
  return isNaN(x.getTime()) ? s : x.toISOString().slice(0, 10);
}

export default function OrdenesFijasHubModal({
  open,
  onClose,
  selectedDetalleIds = [],
  defaultCliente = '',
  defaultCarguera = '',
  onProgramarSuccess,
  onSubirSuccess,
  onOpenFactura
}) {
  const [tab, setTab] = useState('subir'); // "programar" | "subir" | "gestionar"
  const [loading, setLoading] = useState(false);

  // ---------- PROGRAMAR ----------
  const [formProg, setFormProg] = useState({
    Idcliente: defaultCliente || '',
    idcarguera: defaultCarguera || '',
    dia_semana: 1,
    frecuencia: 'SEMANAL',
    fecha_inicio: '',
    fecha_fin: '',
    lead_time_dias: 3,
    observaciones: '',
    esramo: 0
  });

  useEffect(() => {
    if (open) {
      setFormProg((f) => ({
        ...f,
        Idcliente: defaultCliente || '',
        idcarguera: defaultCarguera || ''
      }));
    }
  }, [open, defaultCliente, defaultCarguera]);

  const disabledProg = useMemo(
    () =>
      !formProg.Idcliente ||
      !formProg.idcarguera ||
      !formProg.dia_semana ||
      selectedDetalleIds.length === 0 ||
      loading,
    [formProg, selectedDetalleIds, loading]
  );

  const handleProg = (e) => {
    const { name, value } = e.target;
    setFormProg((f) => ({ ...f, [name]: value }));
  };

  const submitProgramar = async (e) => {
    e?.preventDefault();
    if (disabledProg) return;
    try {
      setLoading(true);
      const payload = {
        Idcliente: Number(formProg.Idcliente),
        idcarguera: Number(formProg.idcarguera),
        dia_semana: Number(formProg.dia_semana),
        frecuencia: formProg.frecuencia,
        fecha_inicio: formProg.fecha_inicio || null,
        fecha_fin: formProg.fecha_fin || null,
        lead_time_dias: Number(formProg.lead_time_dias || 0),
        observaciones: formProg.observaciones || null,
        iddetalle_list: selectedDetalleIds,
        esramo_all: Number(formProg.esramo || 0)
      };
      const { data } = await api.post('/api/ordenes-fijas/from-factura', payload);
      if (data?.ok) {
        onProgramarSuccess?.(data);
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

  // ---------- SUBIR ----------
  const [fechaSubir, setFechaSubir] = useState(() => new Date().toISOString().slice(0, 10));
  const [resultadoSubir, setResultadoSubir] = useState(null);

  // PREVIEW de esa fecha
  const [preLoading, setPreLoading] = useState(false);
  const [preview, setPreview] = useState({ ok: true, items: [] });

  const fetchPreview = async (fecha) => {
    try {
      setPreLoading(true);
      const { data } = await api.get('/api/ordenes-fijas/preview', { params: { fecha } });
      setPreview(data);
    } catch (e) {
      console.error('Preview error:', e);
      setPreview({ ok: false, items: [], msg: e?.response?.data?.msg || e.message });
    } finally {
      setPreLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (tab === 'subir') fetchPreview(fechaSubir);
  }, [open, tab, fechaSubir]);

  const submitSubir = async (e) => {
    e?.preventDefault();
    try {
      setLoading(true);
      const { data } = await api.post('/api/ordenes-fijas/subir', { fecha: fechaSubir });
      setResultadoSubir(data);
      onSubirSuccess?.(data);
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.msg || err.message || 'Error al subir programadas');
    } finally {
      setLoading(false);
    }
  };

  // ---------- GESTIONAR (listar/seleccionar/eliminar) ----------
  const [plLoading, setPlLoading] = useState(false);
  const [plantillas, setPlantillas] = useState([]);
  const [selPlantillas, setSelPlantillas] = useState(new Set());
  const [searchPl, setSearchPl] = useState('');

  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [selJobs, setSelJobs] = useState(new Set());
  const [searchJobs, setSearchJobs] = useState('');

  // limpiar selección al cambiar de pestaña
  useEffect(() => {
    if (tab !== 'gestionar') {
      setSelPlantillas(new Set());
      setSelJobs(new Set());
    }
  }, [tab]);

  const fetchPlantillas = async () => {
    try {
      setPlLoading(true);
      const { data } = await api.get('/api/ordenes-fijas/list');
      setPlantillas(data?.items || []);
    } catch (e) {
      console.error(e);
      setPlantillas([]);
    } finally {
      setPlLoading(false);
    }
  };

  const fetchJobs = async () => {
    try {
      setJobsLoading(true);
      const { data } = await api.get('/api/ordenes-fijas/jobs'); // trae todos
      setJobs(data?.items || []);
    } catch (e) {
      console.error(e);
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (tab === 'gestionar') {
      fetchPlantillas();
      fetchJobs();
    }
  }, [open, tab]);

  const eliminarPlantillas = async () => {
    if (!selPlantillas.size) return alert('Selecciona al menos una orden fija.');
    if (
      !window.confirm(
        '¿Eliminar la(s) orden(es) fija(s) seleccionada(s)? Se borrarán también sus detalles y programaciones (jobs).'
      )
    )
      return;
    try {
      const ids = Array.from(selPlantillas);
      const { data } = await api.delete('/api/ordenes-fijas', { data: { ids } });
      if (data?.ok) {
        await fetchPlantillas();
        setSelPlantillas(new Set());
        alert(`✅ Eliminadas: ${data.borradas}`);
      } else {
        alert(data?.msg || 'No se pudo eliminar.');
      }
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.msg || e.message || 'Error al eliminar');
    }
  };

  const eliminarProgramaciones = async () => {
    if (!selJobs.size) return alert('Selecciona al menos una programación.');
    if (
      !window.confirm(
        '¿Eliminar la(s) programación(es) seleccionada(s)? Esto permite re-subir esa fecha nuevamente.'
      )
    )
      return;
    try {
      const job_ids = Array.from(selJobs);
      const { data } = await api.delete('/api/ordenes-fijas/jobs', { data: { job_ids } });
      if (data?.ok) {
        await fetchJobs();
        setSelJobs(new Set());
        alert(`✅ Programaciones eliminadas: ${data.eliminados}`);
      } else {
        alert(data?.msg || 'No se pudo eliminar.');
      }
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.msg || e.message || 'Error al eliminar');
    }
  };

  // Ver PDF de PLANTILLA (cuando hay exactamente 1 seleccionada)
  const verPdfPlantilla = () => {
    const ids = Array.from(selPlantillas);
    if (ids.length !== 1) return;
    const id = ids[0];
    window.open(`/api/ordenes-fijas/plantilla/${id}/pdf`, '_blank');
  };

  // ---------- estilos ----------
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
    width: 1040,
    maxWidth: '96vw',
    boxShadow: '0 10px 30px rgba(0,0,0,.2)',
    color: '#111'
  };
  const tabsWrap = { background: '#eef2ff', padding: 6, borderRadius: 10, display: 'flex', gap: 6 };
  const tabBtn = (active) => ({
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid ' + (active ? '#2563eb' : '#d1d5db'),
    background: active ? '#2563eb' : '#fff',
    color: active ? '#fff' : '#111',
    fontWeight: 700,
    cursor: 'pointer'
  });
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  const filtroPl = plantillas.filter(
    (p) =>
      !searchPl ||
      String(p.cliente || p.Idcliente || '')
        .toLowerCase()
        .includes(searchPl.toLowerCase())
  );

  const filtroJobs = jobs.filter(
    (j) =>
      !searchJobs ||
      String(j.cliente || j.Idcliente || '')
        .toLowerCase()
        .includes(searchJobs.toLowerCase())
  );

  return !open ? null : (
    <div style={overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div style={card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
            Órdenes fijas
          </h3>
          <button onClick={onClose} style={{ border: 0, background: 'transparent', fontSize: 18 }}>
            ✕
          </button>
        </div>

        <div style={tabsWrap}>
          <button
            style={tabBtn(tab === 'programar')}
            onClick={() => setTab('programar')}
            type="button"
          >
            Programar desde factura
          </button>
          <button style={tabBtn(tab === 'subir')} onClick={() => setTab('subir')} type="button">
            Subir programadas
          </button>
          <button
            style={tabBtn(tab === 'gestionar')}
            onClick={() => setTab('gestionar')}
            type="button"
          >
            Gestionar
          </button>
        </div>

        {/* ---------- PROGRAMAR ---------- */}
        {tab === 'programar' && (
          <form onSubmit={submitProgramar} style={{ marginTop: 14 }}>
            <div style={{ color: '#667085', fontSize: 12, marginBottom: 12 }}>
              Seleccionadas: <b>{selectedDetalleIds.length}</b> filas de la factura.
            </div>
            <div style={grid2}>
              <label>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Cliente (Idcliente)</div>
                <input
                  name="Idcliente"
                  type="number"
                  value={formProg.Idcliente}
                  onChange={handleProg}
                  style={{ width: '100%', padding: 8 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Carguera (idcarguera)</div>
                <input
                  name="idcarguera"
                  type="number"
                  value={formProg.idcarguera}
                  onChange={handleProg}
                  style={{ width: '100%', padding: 8 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Día de la semana</div>
                <select
                  name="dia_semana"
                  value={formProg.dia_semana}
                  onChange={handleProg}
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
                  value={formProg.frecuencia}
                  onChange={handleProg}
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
                  value={formProg.fecha_inicio}
                  onChange={handleProg}
                  style={{ width: '100%', padding: 8 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Fecha fin (opcional)</div>
                <input
                  name="fecha_fin"
                  type="date"
                  value={formProg.fecha_fin}
                  onChange={handleProg}
                  style={{ width: '100%', padding: 8 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Lead time (días)</div>
                <input
                  name="lead_time_dias"
                  type="number"
                  min={0}
                  value={formProg.lead_time_dias}
                  onChange={handleProg}
                  style={{ width: '100%', padding: 8 }}
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Observaciones</div>
                <textarea
                  name="observaciones"
                  rows={3}
                  value={formProg.observaciones}
                  onChange={handleProg}
                  style={{ width: '100%', padding: 8 }}
                />
              </label>
            </div>
            <div
              style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', gap: 8 }}
            >
              <div style={{ color: '#6b7280', fontSize: 12 }}>
                <div>
                  • <b>Lead time</b>: el cron de “lead_time” generará con días de anticipación.
                </div>
                <div>• El cron de “hoy” ignora este valor y genera el mismo día.</div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={onClose}
                  style={{ padding: '8px 14px', marginRight: 8 }}
                  disabled={loading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={disabledProg}
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
            </div>
          </form>
        )}

        {/* ---------- SUBIR ---------- */}
        {tab === 'subir' && (
          <form onSubmit={submitSubir} style={{ marginTop: 14 }}>
            <div style={{ color: '#475569', fontSize: 13, marginBottom: 10 }}>
              Se crearán encabezados y detalle para las plantillas activas cuyo día coincida con la
              fecha seleccionada.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ flex: '0 0 240px' }}>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Fecha (vuelo/embarque)</div>
                <input
                  type="date"
                  value={fechaSubir}
                  onChange={(e) => setFechaSubir(e.target.value)}
                  style={{ width: '100%', padding: 8 }}
                />
              </label>
              <button
                type="button"
                onClick={() => fetchPreview(fechaSubir)}
                disabled={preLoading}
                style={{ padding: '8px 14px' }}
              >
                {preLoading ? 'Actualizando...' : 'Actualizar lista'}
              </button>
              <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>
                {preview?.items?.length ?? 0} programacione(s) para {niceDate(fechaSubir)}
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
                maxHeight: 260,
                overflowY: 'auto'
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#f8fafc', color: '#0f172a' }}>
                  <tr>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      #
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Cliente
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Día
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Frecuencia
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Vigencia
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Creado
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Líneas
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(preview?.items || []).map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px' }}>{r.id}</td>
                      <td style={{ padding: '8px 10px' }}>{r.cliente || r.Idcliente}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {DOW_OPTS.find((d) => d.value === Number(r.dia_semana))?.label ||
                          r.dia_semana}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{r.frecuencia}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {r.fecha_inicio ? niceDate(r.fecha_inicio) : '—'} →{' '}
                        {r.fecha_fin ? niceDate(r.fecha_fin) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{niceDate(r.created_at)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.lineas ?? '—'}</td>
                    </tr>
                  ))}
                  {(!preview?.items || preview.items.length === 0) && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}
                      >
                        {preLoading ? 'Cargando...' : 'No hay programaciones para esta fecha.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {resultadoSubir && (
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
                  <b>OK:</b> {String(resultadoSubir.ok)}
                </div>
                {'generados' in resultadoSubir && (
                  <div>Detalles generados: {resultadoSubir.generados}</div>
                )}
                {'plantillas' in resultadoSubir && (
                  <div>Plantillas aplicadas: {resultadoSubir.plantillas}</div>
                )}
                {resultadoSubir?.headers?.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontWeight: 600 }}>Facturas creadas:</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {resultadoSubir.headers.map((h, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          orden_fija_id: <b>{h.orden_fija_id}</b> → idfactura:{' '}
                          <button
                            type="button"
                            onClick={() => onOpenFactura?.(h.idfactura)}
                            style={{
                              border: 0,
                              background: 'transparent',
                              color: '#2563eb',
                              textDecoration: 'underline',
                              cursor: 'pointer'
                            }}
                          >
                            {h.idfactura}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
        )}

        {/* ---------- GESTIONAR ---------- */}
        {tab === 'gestionar' && (
          <div style={{ marginTop: 14 }}>
            {/* PLANTILLAS */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6
              }}
            >
              <h4 style={{ margin: 0 }}>Plantillas</h4>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={searchPl}
                  onChange={(e) => setSearchPl(e.target.value)}
                  placeholder="Buscar cliente..."
                  style={{ padding: 8 }}
                />
                <button onClick={fetchPlantillas} disabled={plLoading}>
                  {plLoading ? 'Actualizando...' : 'Refrescar'}
                </button>
                <button
                  onClick={verPdfPlantilla}
                  disabled={selPlantillas.size !== 1}
                  title="Ver PDF de la orden fija"
                >
                  PDF
                </button>
                <button
                  onClick={eliminarPlantillas}
                  disabled={selPlantillas.size === 0}
                  style={{
                    background: '#b91c1c',
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 0
                  }}
                >
                  Eliminar orden fija
                </button>
              </div>
            </div>
            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
                maxHeight: 220,
                overflowY: 'auto',
                marginBottom: 14
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          if (e.target.checked)
                            setSelPlantillas(new Set(filtroPl.map((p) => p.id)));
                          else setSelPlantillas(new Set());
                        }}
                      />
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      ID
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Cliente
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Día
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Frecuencia
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Vigencia
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Líneas
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtroPl.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <input
                          type="checkbox"
                          checked={selPlantillas.has(p.id)}
                          onChange={(e) => {
                            const s = new Set(selPlantillas);
                            if (e.target.checked) s.add(p.id);
                            else s.delete(p.id);
                            setSelPlantillas(s);
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px 10px' }}>{p.id}</td>
                      <td style={{ padding: '8px 10px' }}>{p.cliente || p.Idcliente}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {DOW_OPTS.find((d) => d.value === Number(p.dia_semana))?.label ||
                          p.dia_semana}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{p.frecuencia}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {p.fecha_inicio ? niceDate(p.fecha_inicio) : '—'} →{' '}
                        {p.fecha_fin ? niceDate(p.fecha_fin) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{p.lineas ?? '—'}</td>
                    </tr>
                  ))}
                  {filtroPl.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}
                      >
                        {plLoading ? 'Cargando...' : 'No hay plantillas.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* PROGRAMACIONES (JOBS) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6
              }}
            >
              <h4 style={{ margin: 0 }}>Programaciones generadas</h4>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={searchJobs}
                  onChange={(e) => setSearchJobs(e.target.value)}
                  placeholder="Buscar cliente..."
                  style={{ padding: 8 }}
                />
                <button onClick={fetchJobs} disabled={jobsLoading}>
                  {jobsLoading ? 'Actualizando...' : 'Refrescar'}
                </button>

                <button
                  onClick={eliminarProgramaciones}
                  disabled={selJobs.size === 0}
                  style={{
                    background: '#b91c1c',
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 0
                  }}
                >
                  Eliminar programación
                </button>
              </div>
            </div>

            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
                maxHeight: 220,
                overflowY: 'auto'
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          if (e.target.checked) setSelJobs(new Set(filtroJobs.map((j) => j.id)));
                          else setSelJobs(new Set());
                        }}
                      />
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      JobID
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Plantilla
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Cliente
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Fecha envío
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Estado
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid #e5e7eb'
                      }}
                    >
                      Creado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtroJobs.map((j) => (
                    <tr key={j.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <input
                          type="checkbox"
                          checked={selJobs.has(j.id)}
                          onChange={(e) => {
                            const s = new Set(selJobs);
                            if (e.target.checked) s.add(j.id);
                            else s.delete(j.id);
                            setSelJobs(s);
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px 10px' }}>{j.id}</td>
                      <td style={{ padding: '8px 10px' }}>{j.orden_fija_id}</td>
                      <td style={{ padding: '8px 10px' }}>{j.cliente || j.Idcliente}</td>
                      <td style={{ padding: '8px 10px' }}>{niceDate(j.fecha_envio)}</td>
                      <td style={{ padding: '8px 10px' }}>{j.estado}</td>
                      <td style={{ padding: '8px 10px' }}>{niceDate(j.created_at)}</td>
                    </tr>
                  ))}
                  {filtroJobs.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}
                      >
                        {jobsLoading ? 'Cargando...' : 'No hay programaciones.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
