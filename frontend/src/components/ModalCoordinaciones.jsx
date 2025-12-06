import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

export default function ModalCoordinaciones({
  idfactura,
  idcarguera,
  selectedDetalleIds = [], // 👈 IDs seleccionados desde FacturaDetalleEditable
  onClose,
  onSaved
}) {
  const [detalles, setDetalles] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [confirmadas, setConfirmadas] = useState({});
  const [observaciones, setObservaciones] = useState({});
  const [hawb, setHawb] = useState(''); // 👈 Guía hija única en encabezado
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const splitCampos = (texto) =>
    String(texto || '')
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean);

  useEffect(() => {
    const cargar = async () => {
      if (!idfactura) {
        setDetalles([]);
        return;
      }
      setCargando(true);
      try {
        const [detRes, catRes, provRes, estadoRes] = await Promise.all([
          api.get(`/api/facturas/factura-detalle/${idfactura}`),
          api.get('/api/catalogo/todo'),
          api.get('/api/terceros?tipo=proveedor'),
          api.get(`/api/facturas/${idfactura}/coordinaciones/estado`).catch(() => ({ data: [] }))
        ]);

        const detallesArr = Array.isArray(detRes?.data) ? detRes.data : [];

        // ✅ Filtrar solo los seleccionados
        const idsSel = new Set((selectedDetalleIds || []).map(Number));
        const filtrados = idsSel.size
          ? detallesArr.filter((r) => idsSel.has(Number(r.iddetalle)))
          : detallesArr;

        setDetalles(filtrados);
        setCatalogo(catRes?.data || []);
        setProveedores(provRes?.data || []);

        // ✅ Inicializar estados
        const inicialSel = new Set();
        const inicialConf = {};
        const inicialObs = {};

        (Array.isArray(estadoRes?.data) ? estadoRes.data : []).forEach((g) => {
          const idp = Number(g.idproveedor);
          if (g.seleccionado) inicialSel.add(idp);
          if (g.confirmadas != null) inicialConf[idp] = Number(g.confirmadas);
          if (g.observaciones) inicialObs[idp] = g.observaciones;
        });

        if (inicialSel.size === 0) {
          filtrados.forEach((r) => {
            if (r.idproveedor) inicialSel.add(Number(r.idproveedor));
          });
        }

        setSeleccionados(inicialSel);
        setConfirmadas(inicialConf);
        setObservaciones(inicialObs);

        // ✅ HAWB inicial
        const primera = filtrados.find((r) => r.guia_master?.trim());
        setHawb(primera?.guia_master?.trim() || '');
      } catch (err) {
        console.error('❌ Error cargando coordinación:', err);
        setDetalles([]);
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, [idfactura, selectedDetalleIds]);

  const etiquetaTipoCaja = useCallback(
    (idtipocaja) => {
      const item = catalogo.find(
        (c) => c.categoria === 'tipocaja' && Number(c.id) === Number(idtipocaja)
      );
      return item?.valor || '';
    },
    [catalogo]
  );

  const equivalenciaMap = useMemo(() => {
    const mapa = new Map();
    (catalogo || [])
      .filter((c) => ['equivalencia_tipocaja', 'equivalencia'].includes(c.categoria))
      .forEach((c) => {
        const [k, v] = String(c.valor || '')
          .split('|')
          .map((s) => s.trim());
        const num = Number(v);
        if (!Number.isNaN(num)) mapa.set(isNaN(Number(k)) ? k.toUpperCase() : Number(k), num);
      });
    return mapa;
  }, [catalogo]);

  const inferirPorEtiqueta = useCallback((lbl) => {
    const t = (lbl || '').toUpperCase();
    if (t.includes('HB') || t === 'H') return 0.5;
    if (t.includes('QB') || t === 'Q') return 0.25;
    if (t.includes('EB') || t.includes('8H') || t === 'E') return 0.125;
    return 1;
  }, []);

  const equivalenciaTipocaja = useCallback(
    (idtipocaja) => {
      if (!idtipocaja) return 0;
      if (equivalenciaMap.has(Number(idtipocaja))) return equivalenciaMap.get(Number(idtipocaja));
      const etiqueta = etiquetaTipoCaja(idtipocaja);
      if (equivalenciaMap.has(etiqueta.toUpperCase()))
        return equivalenciaMap.get(etiqueta.toUpperCase());
      return inferirPorEtiqueta(etiqueta);
    },
    [equivalenciaMap, etiquetaTipoCaja, inferirPorEtiqueta]
  );

  const nombreProveedor = useCallback(
    (id) => proveedores.find((p) => Number(p.idtercero) === Number(id))?.nombre || `Prov ${id}`,
    [proveedores]
  );

  const nombreGrupo = useCallback(
    (id) =>
      catalogo.find((c) => c.categoria === 'grupo' && Number(c.id) === Number(id))?.valor || '',
    [catalogo]
  );

  const cargueraSeleccionada = useMemo(() => {
    if (!idcarguera) return null;
    return catalogo.find((c) => c.categoria === 'carguera' && Number(c.id) === Number(idcarguera));
  }, [idcarguera, catalogo]);

  const contactosCarguera = useMemo(
    () => (cargueraSeleccionada ? splitCampos(cargueraSeleccionada.equivalencia) : []),
    [cargueraSeleccionada]
  );
  const telefonosCarguera = useMemo(
    () => (cargueraSeleccionada ? splitCampos(cargueraSeleccionada.Otros) : []),
    [cargueraSeleccionada]
  );

  const resumen = useMemo(() => {
    const byProv = new Map();
    (detalles || []).forEach((row) => {
      const idp = row.idproveedor || 0;
      if (!idp) return;
      if (!byProv.has(idp)) {
        byProv.set(idp, {
          pedido: idfactura,
          idproveedor: idp,
          idgrupo: row.idgrupo || null,
          piezas: 0,
          fulls: 0,
          mixesVistos: new Set()
        });
      }
      const entry = byProv.get(idp);
      if (!entry.mixesVistos.has(row.idmix)) {
        entry.mixesVistos.add(row.idmix);
        const cantidad = Number(row.cantidad || 0);
        const eq = equivalenciaTipocaja(row.idtipocaja);
        entry.piezas += cantidad;
        entry.fulls += cantidad * (isNaN(eq) ? 0 : eq);
      }
    });
    return Array.from(byProv.values())
      .map((e) => ({
        pedido: e.pedido,
        grupo: nombreGrupo(e.idgrupo),
        idproveedor: e.idproveedor,
        finca: nombreProveedor(e.idproveedor),
        piezas: e.piezas,
        fulls: Number(e.fulls.toFixed(2))
      }))
      .sort((a, b) => a.finca.localeCompare(b.finca));
  }, [detalles, idfactura, equivalenciaTipocaja, nombreGrupo, nombreProveedor]);

  const totales = useMemo(() => {
    let piezas = 0,
      fulls = 0;
    resumen.forEach((r) => {
      piezas += Number(r.piezas || 0);
      fulls += Number(r.fulls || 0);
    });
    return { piezas, fulls: Number(fulls.toFixed(2)) };
  }, [resumen]);

  const toggleSeleccion = (idprov, piezas) => {
    setSeleccionados((prev) => {
      const n = new Set(prev);
      if (n.has(idprov)) {
        n.delete(idprov);
        setConfirmadas((p) => {
          const cp = { ...p };
          delete cp[idprov];
          return cp;
        });
      } else {
        n.add(idprov);
        setConfirmadas((p) => ({ ...p, [idprov]: piezas }));
      }
      return n;
    });
  };

  const todos = resumen.length > 0 && seleccionados.size === resumen.length;
  const seleccionarTodos = () => {
    if (todos) {
      setSeleccionados(new Set());
      setConfirmadas({});
    } else {
      const s = new Set();
      const c = {};
      resumen.forEach((r) => {
        s.add(r.idproveedor);
        c[r.idproveedor] = r.piezas;
      });
      setSeleccionados(s);
      setConfirmadas(c);
    }
  };

  // Guardar en backend:
  // - Coordinaciones por finca (solo si hay fincas seleccionadas)
  // - HAWB para los detalles seleccionados en la factura (siempre independiente)
  const guardar = async () => {
    if (!idfactura) return;

    const hawbValor = (hawb || '').trim();

    setGuardando(true);
    try {
      // 1) COORDINACIONES (OPCIONAL)
      //    Solo si marcaste alguna finca en el modal
      if (seleccionados.size > 0) {
        const items = resumen
          .filter((r) => seleccionados.has(r.idproveedor))
          .map((r) => ({
            idproveedor: r.idproveedor,
            seleccionado: 1,
            confirmadas: Number(confirmadas[r.idproveedor] ?? 0),
            observaciones: (observaciones[r.idproveedor] ?? '').trim()
          }));

        await api.post(`/api/facturas/${idfactura}/coordinaciones/guardar`, { items });
      }

      // 2) HAWB (INDEPENDIENTE DE LAS FINCAS SELECCIONADAS)
      if (hawbValor && selectedDetalleIds?.length) {
        await Promise.all(
          selectedDetalleIds.map((id) =>
            api.put(`/api/facturas/factura-detalle/${id}`, {
              campo: 'guia_master',
              valor: hawbValor
            })
          )
        );
      }

      // refrescar la grid del padre
      if (typeof onSaved === 'function') {
        await onSaved();
      }

      alert('✅ Datos de coordinación y HAWB guardados correctamente.');
      onClose && onClose();
    } catch (e) {
      console.error(e);
      alert('❌ Error al guardar.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-flex">
        <div className="modal-col" style={{ minWidth: 720 }}>
          <h3>🚚 Coordinaciones — Resumen por Finca</h3>

          {cargueraSeleccionada && (
            <div
              style={{
                marginBottom: 8,
                padding: '6px 8px',
                borderRadius: 4,
                backgroundColor: '#f3f4f6',
                fontSize: 13
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 16
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Carguera:</strong> {cargueraSeleccionada.valor || '—'}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto auto',
                      columnGap: 12,
                      alignItems: 'flex-start'
                    }}
                  >
                    <div>
                      <div>
                        <strong>Contacto:</strong>
                      </div>
                      {(contactosCarguera.length ? contactosCarguera : ['—']).map((c, idx) => (
                        <div key={`contacto-${idx}`}>{c}</div>
                      ))}
                    </div>
                    <div>
                      <div>
                        <strong>Teléfono:</strong>
                      </div>
                      {(telefonosCarguera.length ? telefonosCarguera : ['—']).map((t, idx) => (
                        <div key={`tel-${idx}`}>{t}</div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Guía hija única */}
                <div style={{ minWidth: 220 }}>
                  <div>
                    <strong>Guía hija (HAWB):</strong>
                  </div>
                  <input
                    type="text"
                    placeholder="GH12300"
                    value={hawb}
                    onChange={(e) => setHawb(e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: 14,
                      padding: '4px 8px',
                      marginTop: 2
                    }}
                  />
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    Se aplicará a los registros seleccionados.
                  </div>
                </div>
              </div>
            </div>
          )}

          {cargando && <p>Cargando…</p>}
          {!cargando && (
            <>
              <div
                className="tabla-like header"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 56px 1fr 80px 80px 36px 110px 1fr',
                  gap: '4px',
                  fontWeight: 600,
                  borderBottom: '1px solid #ddd',
                  padding: '4px'
                }}
              >
                <div>Pedido</div>
                <div>Grupo</div>
                <div>Finca</div>
                <div style={{ textAlign: 'right' }}>Piezas</div>
                <div style={{ textAlign: 'right' }}>Fulls</div>
                <div style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={todos}
                    onChange={seleccionarTodos}
                    className="checkbox-mini"
                  />
                </div>
                <div>Confirmadas</div>
                <div>Observaciones</div>
              </div>

              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                {resumen.map((r) => (
                  <div
                    key={r.idproveedor}
                    className="tabla-like row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '80px 56px 1fr 80px 80px 36px 110px 1fr',
                      gap: '4px',
                      alignItems: 'center',
                      padding: '3px 4px',
                      borderBottom: '1px dashed #eee'
                    }}
                  >
                    <div>{r.pedido}</div>
                    <div>{r.grupo}</div>
                    <div>{r.finca}</div>
                    <div style={{ textAlign: 'right' }}>{r.piezas}</div>
                    <div style={{ textAlign: 'right' }}>{r.fulls}</div>
                    <div style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={seleccionados.has(r.idproveedor)}
                        onChange={() => toggleSeleccion(r.idproveedor, r.piezas)}
                      />
                    </div>
                    <div>
                      <input
                        type="number"
                        min={0}
                        style={{ width: 100 }}
                        value={confirmadas[r.idproveedor] ?? ''}
                        onChange={(e) =>
                          setConfirmadas((p) => ({
                            ...p,
                            [r.idproveedor]: e.target.value === '' ? '' : Number(e.target.value)
                          }))
                        }
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Observaciones…"
                        value={observaciones[r.idproveedor] ?? ''}
                        onChange={(e) =>
                          setObservaciones((p) => ({
                            ...p,
                            [r.idproveedor]: e.target.value
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 56px 1fr 80px 80px 36px 110px 1fr',
                  gap: '4px',
                  padding: '6px 4px',
                  fontWeight: 700
                }}
              >
                <div />
                <div />
                <div style={{ textAlign: 'right' }}>Totales:</div>
                <div style={{ textAlign: 'right' }}>{totales.piezas}</div>
                <div style={{ textAlign: 'right' }}>{totales.fulls}</div>
                <div />
                <div />
                <div style={{ textAlign: 'right' }}>
                  <button onClick={guardar} disabled={guardando}>
                    💾 Guardar
                  </button>
                  <button onClick={onClose} style={{ marginLeft: 8 }}>
                    Cerrar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
