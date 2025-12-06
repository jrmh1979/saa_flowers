import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

function ModalAplicarPrepagos({ show, onClose, tipoMovimiento, idTercero, desde, hasta }) {
  const [cargando, setCargando] = useState(false);
  const [prepagos, setPrepagos] = useState([]);
  const [facturas, setFacturas] = useState([]);

  // selección: id -> usarHasta
  const [selPrepagos, setSelPrepagos] = useState({});
  // selección: idfactura -> valor a aplicar
  const [selFacturas, setSelFacturas] = useState({});

  // nuevos: datos del movimiento PG que se registrará
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [obs, setObs] = useState('');

  const fmt = (n) => Number(n || 0).toFixed(2);

  useEffect(() => {
    if (!show) return;
    const load = async () => {
      try {
        setCargando(true);
        const [{ data: pps }, { data: facs }] = await Promise.all([
          api.get('/api/cartera/prepagos', {
            params: { tipoMovimiento, idtercero: idTercero }
          }),
          api.get('/api/cartera', {
            params: { tipoMovimiento, idtercero: idTercero, desde, hasta }
          })
        ]);
        const ppsOk = Array.isArray(pps) ? pps : [];
        const facsOk = (Array.isArray(facs) ? facs : []).filter((f) => Number(f.saldo || 0) > 0);
        setPrepagos(ppsOk);
        setFacturas(facsOk);
        setSelPrepagos({});
        setSelFacturas({});
        setFecha(new Date().toISOString().slice(0, 10));
        setObs('');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        alert('❌ Error cargando anticipos/facturas');
      } finally {
        setCargando(false);
      }
    };
    load();
  }, [show, tipoMovimiento, idTercero, desde, hasta]);

  const totalPrepagosSel = useMemo(
    () => Object.values(selPrepagos).reduce((s, v) => s + (v === '' ? 0 : Number(v || 0)), 0),
    [selPrepagos]
  );

  const totalFacturasSel = useMemo(
    () => Object.values(selFacturas).reduce((s, v) => s + (v === '' ? 0 : Number(v || 0)), 0),
    [selFacturas]
  );

  const saldoRestante = Math.max(0, totalPrepagosSel - totalFacturasSel);

  const togglePrepago = (pp) => {
    setSelPrepagos((prev) => {
      const nuevo = { ...prev };
      if (pp.idpago in nuevo) {
        delete nuevo[pp.idpago];
      } else {
        nuevo[pp.idpago] = Number(pp.restante || 0);
      }
      return nuevo;
    });
  };

  const setUsarPrepago = (pp, valor) => {
    const limite = Number(pp.restante || 0);
    const val = Math.max(0, Math.min(Number(valor || 0), limite));
    setSelPrepagos((prev) => ({ ...prev, [pp.idpago]: val }));
  };

  const toggleFactura = (f) => {
    setSelFacturas((prev) => {
      const nuevo = { ...prev };
      if (f.id in nuevo) {
        delete nuevo[f.id];
      } else {
        nuevo[f.id] = Number(f.saldo || 0);
      }
      return nuevo;
    });
  };

  const setAplicarFactura = (f, valor) => {
    const limite = Number(f.saldo || 0);
    const val = Math.max(0, Math.min(Number(valor || 0), limite));
    setSelFacturas((prev) => ({ ...prev, [f.id]: val }));
  };

  // Autollenar por antigüedad
  const autollenar = () => {
    const objetivo = totalPrepagosSel;
    if (objetivo <= 0) {
      alert('Selecciona al menos un anticipo.');
      return;
    }
    const ordenadas = [...facturas]
      .filter((f) => Number(f.saldo || 0) > 0)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    let restante = objetivo;
    const nuevo = {};
    for (const f of ordenadas) {
      if (restante <= 0) break;
      const s = Number(f.saldo || 0);
      const usar = Math.min(s, restante);
      if (usar > 0) {
        nuevo[f.id] = +usar.toFixed(2);
        restante -= usar;
      }
    }
    setSelFacturas(nuevo);
  };

  const guardar = async () => {
    if (totalPrepagosSel <= 0) {
      alert('Selecciona y define monto a usar en al menos un anticipo.');
      return;
    }
    if (totalFacturasSel <= 0) {
      alert('Selecciona y define montos en las facturas.');
      return;
    }
    if (totalFacturasSel - totalPrepagosSel > 1e-6) {
      alert('El total a aplicar en facturas no puede exceder el total de anticipos.');
      return;
    }

    const prepagosPayload = Object.entries(selPrepagos).map(([id, usarHasta]) => ({
      idpago: Number(id),
      usarHasta: Number(usarHasta || 0)
    }));
    const facturasPayload = Object.entries(selFacturas)
      .filter(([, v]) => Number(v || 0) > 0)
      .map(([id, val]) => ({ idfactura: Number(id), valorpago: Number(val) }));

    try {
      setCargando(true);
      await api.put('/api/cartera/prepagos/aplicar', {
        tipoMovimiento, // <-- nuevo
        idtercero: idTercero,
        fechaAplicacion: fecha, // <-- nuevo
        observaciones: obs, // <-- nuevo
        prepagos: prepagosPayload,
        facturas: facturasPayload
      });
      alert('✅ Anticipos aplicados');
      onClose();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert(
        `❌ No se pudo aplicar. ${e?.response?.data?.error ? `\n${e.response.data.error}` : ''}`
      );
    } finally {
      setCargando(false);
    }
  };

  if (!show) return null;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 'min(1100px, 98vw)' }}>
        <h3>💠 Aplicar anticipos</h3>

        {/* Encabezado: fecha y observaciones del movimiento PG */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <label>
            Fecha aplicación:{' '}
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              disabled={cargando}
            />
          </label>
          <label style={{ flex: 1 }}>
            Observaciones:{' '}
            <input
              type="text"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Ej: Aplicación anticipo(s) a facturas"
              disabled={cargando}
              style={{ width: '100%' }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12 }}>
          {/* Prepagos */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Anticipos disponibles</div>
            <table className="tabla-cartera">
              <thead>
                <tr>
                  <th />
                  <th>Fecha</th>
                  <th>Obs</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th style={{ textAlign: 'right' }}>Restante</th>
                  <th style={{ textAlign: 'right' }}>Usar</th>
                </tr>
              </thead>
              <tbody>
                {prepagos.map((pp) => {
                  const checked = pp.idpago in selPrepagos;
                  return (
                    <tr key={pp.idpago}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePrepago(pp)}
                          disabled={cargando}
                        />
                      </td>
                      <td>{new Date(pp.fecha).toLocaleDateString()}</td>
                      <td>{pp.observaciones || ''}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(pp.valor)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(pp.restante)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {checked ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={Number(pp.restante || 0)}
                            value={selPrepagos[pp.idpago]}
                            onChange={(e) => setUsarPrepago(pp, e.target.value)}
                            style={{ width: 90, textAlign: 'right' }}
                            disabled={cargando}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
                {prepagos.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: '#666', padding: 8 }}>
                      (sin anticipos)
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>
                    Total anticipos
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(totalPrepagosSel)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Facturas */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>Facturas con saldo</div>
              <button onClick={autollenar} disabled={totalPrepagosSel <= 0 || cargando}>
                Por antigüedad
              </button>
            </div>

            <table className="tabla-cartera">
              <thead>
                <tr>
                  <th />
                  <th>Fecha</th>
                  <th>Factura</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th>
                  <th style={{ textAlign: 'right' }}>Aplicar</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => {
                  const checked = f.id in selFacturas;
                  return (
                    <tr key={f.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFactura(f)}
                          disabled={cargando}
                        />
                      </td>
                      <td>{new Date(f.fecha).toLocaleDateString()}</td>
                      <td>{f.numero_factura || f.numero || f.id}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(f.saldo)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {checked ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={Number(f.saldo || 0)}
                            value={selFacturas[f.id]}
                            onChange={(e) => setAplicarFactura(f, e.target.value)}
                            style={{ width: 90, textAlign: 'right' }}
                            disabled={cargando}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
                {facturas.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: '#666', padding: 8 }}>
                      (no hay facturas con saldo en el rango)
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>
                    Total a aplicar
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(totalFacturasSel)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 10,
            alignItems: 'center'
          }}
        >
          <div>
            <strong>Saldo por asignar:</strong> {fmt(saldoRestante)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={guardar} disabled={cargando}>
              Aplicar
            </button>
            <button onClick={onClose} disabled={cargando}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModalAplicarPrepagos;
