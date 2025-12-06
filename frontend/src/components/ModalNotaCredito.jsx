// src/components/ModalNotaCredito.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../services/api';

export default function ModalNotaCredito({
  show,
  onClose,
  tipoMovimiento = 'C',
  idSeleccionado, // cliente
  facturasSeleccionadas = [] // [{ idfactura, numero_factura }]
}) {
  const [fecha, setFecha] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // ---- Totales cabecera
  const [credito, setCredito] = useState(0); // crédito que se reparte en filas
  const [flete, setFlete] = useState(0);
  const [otros, setOtros] = useState(0);
  const valorTotal = useMemo(
    () => Number(credito || 0) + Number(flete || 0) + Number(otros || 0),
    [credito, flete, otros]
  );

  // Saldos de facturas seleccionadas (para validar crédito)
  const [saldoPorFactura, setSaldoPorFactura] = useState({});
  const saldoTotalSeleccion = useMemo(
    () =>
      (facturasSeleccionadas || []).reduce(
        (s, f) => s + Number(saldoPorFactura[f.idfactura] || 0),
        0
      ),
    [saldoPorFactura, facturasSeleccionadas]
  );

  const [ncLineas, setNcLineas] = useState([]);
  const [ncLoading, setNcLoading] = useState(false);

  // ===== Catálogos (labels) =====
  const [, setCatalogos] = useState({ producto: {}, variedad: {}, longitud: {} });
  const arrToMapById = (arr) =>
    (arr || []).reduce((acc, it) => {
      if (it && it.id != null) acc[String(it.id)] = it.valor ?? String(it.id);
      return acc;
    }, {});

  // ===== Helpers =====
  const fmt = (n) => Number(n || 0).toFixed(2);

  // Fotos por proveedor
  function appendFotosPorProveedor(fd, fotosProveedor = {}) {
    Object.entries(fotosProveedor || {}).forEach(([provId, files]) => {
      (files || []).forEach((file) => {
        fd.append(`fotos_proveedor_${provId}[]`, file);
      });
    });
  }

  // ===== Init (fecha/obs y saldos de facturas) =====
  useEffect(() => {
    if (!show) return;
    setFecha(new Date().toISOString().slice(0, 10));
    const nums = (facturasSeleccionadas || [])
      .map((f) => f.numero_factura)
      .filter(Boolean)
      .join(', ');
    setObservaciones(nums ? `Operación sobre factura(s) ${nums}` : '');

    setCredito(0);
    setFlete(0);
    setOtros(0);

    (async () => {
      try {
        const hoy = new Date().toISOString().slice(0, 10);
        const { data } = await api.get('/api/cartera', {
          params: {
            tipoMovimiento: 'C',
            idtercero: idSeleccionado,
            desde: '1900-01-01',
            hasta: hoy
          }
        });
        const m = {};
        (Array.isArray(data) ? data : []).forEach((r) => {
          if (r?.id != null) m[Number(r.id)] = Number(r.saldo || 0);
        });
        setSaldoPorFactura(m);
      } catch (e) {
        console.error('No se pudo cargar saldos de facturas', e);
      }
    })();
  }, [show, idSeleccionado, facturasSeleccionadas]);

  // ===== Cargar detalle consolidado =====
  useEffect(() => {
    const cargar = async () => {
      const ids = facturasSeleccionadas.map((f) => f.idfactura).filter(Boolean);
      if (!ids.length) {
        setNcLineas([]);
        return;
      }
      setNcLoading(true);
      try {
        const [prod, varz, longi] = await Promise.all([
          api.get('/api/catalogo', { params: { categoria: 'producto' } }),
          api.get('/api/catalogo', { params: { categoria: 'variedad' } }),
          api.get('/api/catalogo', { params: { categoria: 'longitud' } })
        ]);
        const cats = {
          producto: arrToMapById(prod.data),
          variedad: arrToMapById(varz.data),
          longitud: arrToMapById(longi.data)
        };
        setCatalogos(cats);

        const { data } = await api.get('/api/facturas/consolidada-detalle', {
          params: { ids: ids.join(',') }
        });
        const lineas = Array.isArray(data) ? data : [];

        const rows = lineas.map((r) => {
          const idproducto = r.idproducto ?? r.producto ?? null;
          const idvariedad = r.idvariedad ?? r.variedad ?? null;
          const idlongitud = r.idlongitud ?? r.longitud ?? null;
          const cantidad_tallos =
            Number(
              r.cantidad_tallos ??
                r.tallos ??
                r.stems ??
                r.qty_stems ??
                r.cant_tallos ??
                r.cantidad ??
                0
            ) || 0;

          const sub = Number(r.subtotal || 0);

          // 💰 Precio unitario desde la factura
          const precio_unitario =
            r.precio_unitario != null
              ? Number(r.precio_unitario || 0)
              : cantidad_tallos > 0
                ? sub / cantidad_tallos
                : 0;

          return {
            iddetalle: r.iddetalle,
            idfactura: Number(r.idfactura),
            proveedor_id: Number(r.proveedor_id || 0),
            proveedor: r.proveedor || `Prov ${r.proveedor_id ?? ''}`,

            // ids reales
            producto: idproducto,
            variedad: idvariedad,
            longitud: idlongitud,

            // labels
            productoNom: cats.producto[String(idproducto)] ?? String(idproducto ?? ''),
            variedadNom: cats.variedad[String(idvariedad)] ?? String(idvariedad ?? ''),
            longitudNom: cats.longitud[String(idlongitud)] ?? String(idlongitud ?? ''),

            documento_proveedor: String(r.documento_proveedor || '').trim() || '—',
            subtotal: sub,
            precio_unitario, // 👈 NUEVO

            // montos editables
            saldo_linea: sub,
            max_credito: sub,
            cantidad_tallos,
            tallos_reclamo: 0,
            monto_credito: 0,
            motivo: ''
          };
        });

        setNcLineas(rows);
        if (rows.length) setProveedorSel(rows[0].proveedor_id || null);
      } catch (e) {
        console.error(e);
        alert('❌ No se pudo cargar el detalle de la factura consolidada');
      } finally {
        setNcLoading(false);
      }
    };

    if (show) cargar();
    if (!show) setNcLineas([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, facturasSeleccionadas]);

  // ===== Lista de proveedores / filtro =====
  const proveedores = useMemo(() => {
    const map = new Map();
    for (const r of ncLineas) {
      const id = Number(r.proveedor_id || 0);
      if (!id) continue;
      if (!map.has(id)) map.set(id, { id, nombre: r.proveedor || `Prov ${id}` });
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.nombre).localeCompare(String(b.nombre))
    );
  }, [ncLineas]);

  const [proveedorSel, setProveedorSel] = useState(null);

  // ==== Imágenes por proveedor ====
  const [fotosProveedor, setFotosProveedor] = useState({});
  const fileInputRef = useRef(null);
  const triggerUpload = () => proveedorSel && fileInputRef.current?.click();
  const onFilesPicked = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !proveedorSel) return;
    setFotosProveedor((prev) => ({
      ...prev,
      [proveedorSel]: [...(prev[proveedorSel] || []), ...files]
    }));
    e.target.value = '';
  };
  const borrarFoto = (provId, idx) => {
    setFotosProveedor((prev) => {
      const arr = [...(prev[provId] || [])];
      arr.splice(idx, 1);
      return { ...prev, [provId]: arr };
    });
  };

  const filasProveedor = useMemo(
    () => ncLineas.filter((r) => !proveedorSel || r.proveedor_id === proveedorSel),
    [ncLineas, proveedorSel]
  );
  const totalAsignadoProveedor = useMemo(
    () => filasProveedor.reduce((s, r) => s + Number(r.monto_credito || 0), 0),
    [filasProveedor]
  );
  // ===== Guardar =====
  const guardar = async () => {
    try {
      if (!fecha) {
        alert('Ingresa fecha');
        return;
      }

      const creditoNum = Number(credito || 0);
      const fleteNum = Number(flete || 0);
      const otrosNum = Number(otros || 0);

      if (!(creditoNum > 0)) {
        alert('El campo "Crédito" debe ser > 0');
        return;
      }

      if (creditoNum > saldoTotalSeleccion) {
        alert(
          `El Crédito (${fmt(
            creditoNum
          )}) no puede superar el saldo disponible de las facturas seleccionadas (${fmt(
            saldoTotalSeleccion
          )}).`
        );
        return;
      }

      // 👇 ya NO obligamos a que totalAsignadoGlobal === creditoNum
      const detalle_nc = ncLineas
        .filter((r) => Number(r.monto_credito) > 0)
        .map((r) => ({
          iddetalle: r.iddetalle,
          proveedor_id: r.proveedor_id,
          motivo: r.motivo || '',
          monto: Number(r.monto_credito),
          producto: r.producto,
          variedad: r.variedad,
          longitud: r.longitud,
          tallos_reclamo: Number(r.tallos_reclamo || 0)
        }));

      // Reparto de crédito contra facturas (greedy)
      const ids = facturasSeleccionadas.map((f) => f.idfactura).filter(Boolean);
      if (!ids.length) {
        alert('Debes seleccionar al menos una factura.');
        return;
      }

      let restante = creditoNum;
      const facturas = [];

      for (const id of ids) {
        if (restante <= 0) break;
        const saldo = Number(saldoPorFactura[id] || 0);
        if (saldo <= 0) continue;
        const usar = Math.min(restante, saldo);
        facturas.push({ idfactura: id, valorpago: usar });
        restante = Math.max(0, restante - usar);
      }

      if (restante > 0) {
        alert(`El Crédito excede el saldo de las facturas seleccionadas en ${fmt(restante)}.`);
        return;
      }

      const fd = new FormData();
      const payload = {
        tipoMovimiento, // 'C'
        tipoDocumento: 'NC',
        idtercero: idSeleccionado,
        fecha,
        valorTotal: Number(valorTotal), // Crédito + Flete + Otros
        observaciones,
        facturas,
        detalle_nc,
        // Enviamos para persistir en pagos
        flete: fleteNum,
        otros: otrosNum,
        credito_items: creditoNum
      };

      fd.append('payload', JSON.stringify(payload));
      appendFotosPorProveedor(fd, fotosProveedor);

      await api.post('/api/cartera/pago-completo-nc', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      alert('✅ Nota de crédito registrada.');
      onClose?.();
    } catch (e) {
      console.error(e);
      alert('❌ Error al guardar la Nota de Crédito');
    }
  };

  // ===== UX modal =====
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [show, onClose]);

  if (!show) return null;

  const tituloFacturas = (facturasSeleccionadas || [])
    .map((f) => f.numero_factura)
    .filter(Boolean)
    .join(', ');

  return createPortal(
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div style={cardStyle} onMouseDown={(e) => e.stopPropagation()}>
        {/* Título con número(s) de factura */}
        <h3 style={{ marginBottom: 6 }}>
          Nota de Crédito (Cliente){' '}
          {tituloFacturas && (
            <span style={{ fontWeight: 800, marginLeft: 8 }}>• Factura(s): {tituloFacturas}</span>
          )}
        </h3>

        {/* Cabecera compacta en una sola línea */}
        <div style={headRow}>
          <label style={lbl}>
            Fecha
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={inSm}
            />
          </label>

          <label style={lblInline}>
            Crédito
            <input
              type="number"
              step="0.01"
              min="0"
              value={credito}
              onChange={(e) => setCredito(e.target.value)}
              style={inSm}
              title={`No puede superar el saldo: ${fmt(saldoTotalSeleccion)}`}
            />
          </label>

          <label style={lblInline}>
            Flete
            <input
              type="number"
              step="0.01"
              min="0"
              value={flete}
              onChange={(e) => setFlete(e.target.value)}
              style={inSm}
            />
          </label>

          <label style={lblInline}>
            Otros
            <input
              type="number"
              step="0.01"
              min="0"
              value={otros}
              onChange={(e) => setOtros(e.target.value)}
              style={inSm}
            />
          </label>

          <div style={totalBox}>
            Total crédito:&nbsp;<b>{fmt(valorTotal)}</b>
          </div>
        </div>

        {/* Observaciones (queda aparte pero en línea, con wrap si no cabe) */}
        <div
          style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}
        >
          <label style={{ ...lbl, margin: 0, flex: '1 1 420px' }}>
            Observaciones
            <input
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              style={inFull}
            />
          </label>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '260px 1fr',
            gap: 12,
            marginTop: 10,
            minHeight: 460
          }}
        >
          {/* Proveedores (lista compacta con scroll interno) */}
          <div style={leftPane}>
            <div style={{ fontWeight: 600, margin: '0 0 6px 0' }}>Proveedores</div>
            {proveedores.length === 0 && <div style={{ opacity: 0.6 }}>Sin proveedores</div>}
            <ul style={provListUl}>
              {proveedores.map((p) => (
                <li
                  key={p.id}
                  onClick={() => setProveedorSel(p.id)}
                  style={{
                    ...provItem,
                    ...(p.id === proveedorSel ? provItemSel : null)
                  }}
                  title={p.nombre}
                >
                  {p.nombre}
                </li>
              ))}
            </ul>
          </div>

          {/* Detalle por proveedor (tabla compacta con scroll interno) */}
          <div style={rightPane}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <strong>Detalle de compra del proveedor seleccionado</strong>
              <div style={{ marginLeft: 'auto', fontSize: 13 }}>
                Crédito proveedor: <b>{fmt(totalAsignadoProveedor)}</b> / Crédito global:&nbsp;
                <b>{fmt(credito)}</b>
              </div>
            </div>

            {/* Botón subir imágenes */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input
                type="file"
                ref={fileInputRef}
                multiple
                accept="image/*"
                style={{ display: 'none' }}
                onChange={onFilesPicked}
              />
              <button onClick={triggerUpload} disabled={!proveedorSel}>
                📷 Subir imágenes (proveedor)
              </button>
              {proveedorSel && (fotosProveedor[proveedorSel]?.length || 0) > 0 && (
                <span style={{ fontSize: 12, color: '#555' }}>
                  {fotosProveedor[proveedorSel].length} archivo(s)
                </span>
              )}
            </div>

            {ncLoading ? (
              'Cargando…'
            ) : (
              <div style={{ overflow: 'auto', maxHeight: 420 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thSm}>Doc Prov</th>
                      <th style={thSm}>Producto</th>
                      <th style={thSm}>Variedad</th>
                      <th style={thSm}>Long.</th>
                      <th style={thRightSm}>Saldo línea</th>
                      <th style={thRightSm}>Tallos</th>
                      <th style={thRightSm}>P. und</th>
                      <th style={thRightSm}>Tallos reclamo</th>
                      <th style={thSm}>Motivo</th>
                      <th style={thRightSm}>Crédito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasProveedor.map((r) => (
                      <tr key={r.iddetalle} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={tdSm}>{r.documento_proveedor}</td>
                        <td style={tdSm}>{r.productoNom || '—'}</td>
                        <td style={tdSm}>{r.variedadNom || '—'}</td>
                        <td style={tdSm}>{r.longitudNom || '—'}</td>
                        <td style={tdRightSm}>{fmt(r.saldo_linea)}</td>
                        <td style={tdRightSm}>{Number(r.cantidad_tallos || 0)}</td>
                        <td style={tdRightSm}>{fmt(r.precio_unitario)}</td>
                        <td style={tdRightSm}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={r.tallos_reclamo ?? 0}
                            onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                              setNcLineas((rows) =>
                                rows.map((x) => {
                                  if (x.iddetalle !== r.iddetalle) return x;
                                  const precio = Number(x.precio_unitario || 0);
                                  const max = Number(x.max_credito || 0);
                                  let monto = v * precio;
                                  if (monto > max) monto = max; // no pasar del saldo de la línea
                                  return { ...x, tallos_reclamo: v, monto_credito: monto };
                                })
                              );
                            }}
                            style={inXs}
                          />
                        </td>
                        <td style={tdSm}>
                          <select
                            value={r.motivo}
                            onChange={(e) =>
                              setNcLineas((rows) =>
                                rows.map((x) =>
                                  x.iddetalle === r.iddetalle ? { ...x, motivo: e.target.value } : x
                                )
                              )
                            }
                            style={selXs}
                          >
                            <option value="">— Selecciona —</option>
                            <option value="Producto dañado">Producto dañado</option>
                            <option value="Falta de calidad">Falta de calidad</option>
                            <option value="Falta de peso">Falta de peso</option>
                            <option value="Error de facturación">Error de facturación</option>
                            <option value="Otro">Otro</option>
                          </select>
                        </td>
                        <td style={tdRightSm}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={r.max_credito ?? 0}
                            value={r.monto_credito ?? 0}
                            onChange={(e) => {
                              const v = Math.max(
                                0,
                                Math.min(
                                  Number(r.max_credito || 0),
                                  parseFloat(e.target.value || 0)
                                )
                              );
                              setNcLineas((rows) =>
                                rows.map((x) =>
                                  x.iddetalle === r.iddetalle ? { ...x, monto_credito: v } : x
                                )
                              );
                            }}
                            style={inXs}
                          />
                        </td>
                      </tr>
                    ))}
                    {!filasProveedor.length && (
                      <tr>
                        <td colSpan={9} style={{ padding: 10, opacity: 0.6, textAlign: 'center' }}>
                          Selecciona un proveedor para ver su detalle.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {proveedorSel && (fotosProveedor[proveedorSel]?.length || 0) > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <b>Imágenes del proveedor seleccionado:</b>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                      {fotosProveedor[proveedorSel].map((f, idx) => (
                        <li key={`${f.name}-${idx}`}>
                          {f.name}{' '}
                          <button type="button" onClick={() => borrarFoto(proveedorSel, idx)}>
                            quitar
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onClose}>Cancelar</button>
          <button onClick={guardar}>Guardar Nota de Crédito</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ===== estilos ===== */
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.40)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '28px 20px',
  zIndex: 1300
};
const cardStyle = {
  width: '96vw',
  maxWidth: 1400,
  background: '#fff',
  borderRadius: 14,
  boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
  padding: 16,
  maxHeight: 'calc(100dvh - 56px)',
  overflow: 'auto'
};

/* Cabecera compacta */
const headRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap'
};
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 };
const lblInline = { ...lbl, width: 140 };
const inSm = { height: 28, lineHeight: '28px', padding: '2px 8px', fontSize: 13 };
const inFull = { ...inSm, width: '100%' };
const totalBox = {
  marginLeft: 'auto',
  fontWeight: 700,
  fontSize: 14,
  padding: '2px 8px'
};

/* Paneles con scroll interno */
const leftPane = {
  overflow: 'auto',
  border: 'none',
  borderRadius: 8,
  padding: 0,
  maxHeight: 520
};
const rightPane = {
  border: '1px solid #ddd',
  borderRadius: 10,
  padding: 8,
  overflow: 'hidden'
};

/* Lista de proveedores (compacta) */
const provListUl = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  maxHeight: 480,
  overflow: 'auto',
  border: '1px solid #e6e6e6',
  borderRadius: 8
};
const provItem = {
  padding: '6px 10px',
  fontSize: 13,
  cursor: 'pointer',
  borderBottom: '1px solid #ececec',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};
const provItemSel = {
  background: '#e8f2ff',
  fontWeight: 600
};

/* Tabla compacta */
const thSm = {
  textAlign: 'left',
  padding: '6px 6px',
  borderBottom: '1px solid #ddd',
  position: 'sticky',
  top: 0,
  background: '#fafafa',
  zIndex: 1,
  fontSize: 12
};
const thRightSm = { ...thSm, textAlign: 'right' };
const tdSm = { padding: '4px 6px', fontSize: 13, verticalAlign: 'middle' };
const tdRightSm = { ...tdSm, textAlign: 'right' };

/* Inputs compactos dentro de la grilla */
const inXs = {
  height: 26,
  lineHeight: '26px',
  padding: '2px 6px',
  fontSize: 13,
  width: 96,
  textAlign: 'right'
};
const selXs = { height: 26, padding: '2px 6px', fontSize: 13 };
