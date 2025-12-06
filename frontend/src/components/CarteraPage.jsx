import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import ModalMovimiento from './ModalMovimiento';
import ModalEstadoCuenta from './ModalEstadoCuenta';
import ModalAplicarPrepagos from './ModalAplicarPrepagos';
import ModalNotaCredito from './ModalNotaCredito';

function CarteraPage() {
  const [tipoMovimiento, setTipoMovimiento] = useState('C');
  const [idTercero, setIdTercero] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [timeline, setTimeline] = useState([]);
  const [facturasIndex, setFacturasIndex] = useState({});

  const [terceros, setTerceros] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [showPrepagos, setShowPrepagos] = useState(false);
  const [showNC, setShowNC] = useState(false);
  const [movimientoParaEditar, setMovimientoParaEditar] = useState(null);
  const [seleccionados, setSeleccionados] = useState({});
  const [mostrarModalEstadoCuenta, setMostrarModalEstadoCuenta] = useState(false);
  const [terceroActual, setTerceroActual] = useState(null);
  const [rangoFechas, setRangoFechas] = useState({ desde: '', hasta: '' });

  // Panel de prepagos
  const [prepagos, setPrepagos] = useState([]);
  const [hayPrepagos, setHayPrepagos] = useState(false);

  // saldo inicial para arrancar el acumulado
  const [saldoInicial, setSaldoInicial] = useState(0);

  // ✅ filtro visual “Solo pendientes”
  const [soloPendientes, setSoloPendientes] = useState(false);

  const fmt = (n) => Number(n || 0).toFixed(2);

  // --- helpers ---
  const normClas = (v) =>
    String(v ?? '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

  const toNum = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/\s+/g, '');
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const pickNum = (obj, keys) => {
    for (const k of keys) {
      if (k in obj) {
        const n = toNum(obj[k]);
        if (n !== 0 || obj[k] === 0) return n;
      }
    }
    return 0;
  };

  // 'YYYY-MM-DD' sin tocar zona horaria
  const ymd = (v) => {
    if (!v) return '';
    if (typeof v === 'string') {
      const s = v.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    }
    if (v instanceof Date && !isNaN(v)) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  };

  // 'DD/MM/YYYY' para UI, inmune a zonas horarias
  const dmy = (v) => {
    const s = typeof v === 'string' ? v.slice(0, 10) : ymd(v);
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  };

  // ✅ sumar/restar días sobre un 'YYYY-MM-DD' en UTC
  const addDaysYmd = (s, days) => {
    if (!s) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return '';
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    dt.setUTCDate(dt.getUTCDate() + days);
    const y = dt.getUTCFullYear();
    const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  };

  // ---- cargar terceros (solo CLIENTE cuando es Clientes) ----
  useEffect(() => {
    const tipo = tipoMovimiento === 'C' ? 'cliente' : 'proveedor';
    const params = tipo === 'cliente' ? { tipo, solo_principales: 1 } : { tipo };

    api
      .get('/api/terceros', { params })
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : [];

        if (tipoMovimiento === 'C') {
          // ✅ Solo principales
          const principales = data
            .filter((t) => normClas(t.clasifcliente) === 'CLIENTE')
            .map((t) => ({
              idtercero: Number(t.idtercero),
              nombre: t.nombre
            }));

          setTerceros(principales);

          if (idTercero && !principales.some((p) => String(p.idtercero) === String(idTercero))) {
            setIdTercero('');
          }
        } else {
          const provs = data.map((t) => ({
            idtercero: Number(t.idtercero),
            nombre: t.nombre
          }));
          setTerceros(provs);
        }
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoMovimiento]);

  const buscar = async () => {
    try {
      // -------- Normalizamos el lado (C = cliente, P = proveedor) --------
      const lado = String(tipoMovimiento || '')
        .toUpperCase()
        .trim()
        .startsWith('P')
        ? 'P'
        : 'C';

      // -------- Fechas de trabajo --------
      const hoyYmd = new Date().toISOString().slice(0, 10);
      const hastaSaldo = (hasta && hasta.slice(0, 10)) || hoyYmd;

      // ---------- FACTURAS ----------
      const { data: facturas } = await api.get('/api/cartera', {
        params: {
          tipoMovimiento: lado,
          idtercero: idTercero,
          desde: '1900-01-01',
          hasta: hastaSaldo
        }
      });

      const index = {};
      (facturas || []).forEach((f) => {
        index[f.id] = {
          numero: f.numero_factura,
          saldo: Number(f.saldo || 0),
          mark: f.terceroNombre || ''
        };
      });
      setFacturasIndex(index);

      // ---------- TIMELINE ----------
      const { data: tl } = await api.get('/api/cartera/timeline', {
        params: { tipoMovimiento: lado, idtercero: idTercero, desde, hasta }
      });

      const normTL = (Array.isArray(tl) ? tl : []).map((r) => {
        const tipo = String(r.tipoDocumento || r.tipo || '').toUpperCase();

        const amount =
          Number(r.amount ?? (['F', 'ND', 'SI'].includes(tipo) ? (r.valorTotal ?? r.valor) : 0)) ||
          0;
        const credits =
          Number(r.credits ?? (['NC', 'RT'].includes(tipo) ? (r.valorTotal ?? r.valor) : 0)) || 0;
        const payment = Number(r.payment ?? (tipo === 'PG' ? (r.valorTotal ?? r.valor) : 0)) || 0;

        return {
          id: Number(r.idfactura ?? r.id ?? 0),
          fecha: (r.fecha || '').slice(0, 10),
          tipoDocumento: tipo,
          numero: r.numero_factura ?? r.numero ?? '',
          mark: r.mark ?? r.terceroNombre ?? r.terceroNombrePrincipal ?? '',
          obs: r.observaciones ?? r.obs ?? '',
          editable: !!r.editable,
          amount,
          credits,
          payment
        };
      });

      setTimeline(normTL);

      // ---------- SALDO INICIAL (día anterior a 'desde') ----------
      const hastaPrev = addDaysYmd(desde, -1);

      let saldoInicialCalc = 0;
      if (hastaPrev) {
        const { data: tlPrev } = await api.get('/api/cartera/timeline', {
          params: {
            tipoMovimiento: lado,
            idtercero: idTercero,
            desde: '1900-01-01',
            hasta: hastaPrev
          }
        });

        const normPrev = (Array.isArray(tlPrev) ? tlPrev : []).map((r) => {
          const tipo = String(r.tipoDocumento || r.tipo || '').toUpperCase();
          const amount =
            Number(
              r.amount ?? (['F', 'ND', 'SI'].includes(tipo) ? (r.valorTotal ?? r.valor) : 0)
            ) || 0;
          const credits =
            Number(r.credits ?? (['NC', 'RT'].includes(tipo) ? (r.valorTotal ?? r.valor) : 0)) || 0;
          const payment = Number(r.payment ?? (tipo === 'PG' ? (r.valorTotal ?? r.valor) : 0)) || 0;
          return { tipo, amount, credits, payment };
        });

        // Igual que en la grilla: excluimos PP
        const sinPP = normPrev.filter((x) => x.tipo !== 'PP');

        saldoInicialCalc = sinPP.reduce(
          (acc, r) => acc + Number(r.amount || 0) - Number(r.credits || 0) - Number(r.payment || 0),
          0
        );
      }
      setSaldoInicial(saldoInicialCalc);

      // --------- PREPAGOS (por lado) ----------
      const { data: pps } = await api.get('/api/cartera/prepagos', {
        params: { tipoMovimiento: lado, idtercero: idTercero }
      });

      const norm = (Array.isArray(pps) ? pps : []).map((p) => {
        const tipo = (p.tipoDocumento || p.tipo || 'PP').toString().toUpperCase();
        const monto =
          pickNum(p, [
            'monto',
            'valor',
            'amount',
            'monto_total',
            'valor_total',
            'total',
            'valorTotal',
            'amount_total'
          ]) || 0;
        const aplicado =
          pickNum(p, [
            'aplicado',
            'usado',
            'aplicado_total',
            'valor_aplicado',
            'payment',
            'credits',
            'pagado'
          ]) || 0;
        let disponible =
          pickNum(p, ['saldo', 'disponible', 'restante', 'pendiente', 'por_aplicar']) || 0;

        if (!disponible && (monto || aplicado)) disponible = Math.max(0, monto - aplicado);
        const montoFinal = monto || aplicado + disponible;

        return {
          id: Number(p.id || p.idpago || p.idprepago || p.idmov || 0),
          fecha: (p.fecha || p.fecha_pago || p.created_at || '').slice(0, 10),
          tipo,
          mark: p.mark || p.terceroNombre || '',
          monto: toNum(montoFinal),
          aplicado: toNum(aplicado),
          disponible: toNum(disponible),
          obs: p.obs || p.observaciones || '',
          editable: !!p.editable
        };
      });

      setPrepagos(norm);
      setHayPrepagos(norm.length > 0);
    } catch (err) {
      console.error(err);
      alert('❌ Error al buscar cartera');
    }
  };

  // selección y pagos
  const actualizarValorPago = (idFactura, valor) => {
    setSeleccionados((prev) => ({ ...prev, [idFactura]: valor }));
  };

  const toggleSeleccion = (row) => {
    const idFactura = row.id;
    const saldo = facturasIndex[idFactura]?.saldo || 0;
    setSeleccionados((prev) => {
      const nuevo = { ...prev };
      if (nuevo[idFactura] !== undefined) {
        delete nuevo[idFactura];
      } else {
        nuevo[idFactura] = saldo > 0 ? saldo.toFixed(2) : '';
      }
      return nuevo;
    });
  };

  const facturasSeleccionadas = useMemo(
    () =>
      Object.entries(seleccionados)
        .filter(([, v]) => v !== '' && Number(v) > 0)
        .map(([id, v]) => ({
          idfactura: Number(id),
          valorpago: Number(v),
          numero_factura: facturasIndex[id]?.numero
        })),
    [seleccionados, facturasIndex]
  );

  // estado de cuenta
  const abrirModalEstadoCuenta = (tercero) => {
    if (!desde || !hasta) {
      alert('❗ Debes seleccionar un rango de fechas para ver el estado de cuenta.');
      return;
    }
    setTerceroActual(tercero);
    setRangoFechas({ desde, hasta });
    setMostrarModalEstadoCuenta(true);
  };

  const terceroSeleccionado = terceros.find((t) => String(t.idtercero) === String(idTercero));

  // ---- MOVIMIENTOS visibles (quitamos solo PP) ----
  const rowsMov = useMemo(
    () =>
      (timeline || []).filter((r) => {
        const t = (r.tipoDocumento || r.tipo || '').toString().toUpperCase();
        return t !== 'PP';
      }),
    [timeline]
  );

  // ---- Enriquecer filas con saldos acumulados ----
  const rowsConSaldo = useMemo(() => {
    let running = Number(saldoInicial || 0);
    return rowsMov.map((r) => {
      const tipo = (r.tipoDocumento || r.tipo || '').toUpperCase();
      const amount = Number(r.amount || 0);
      const credits = Number(r.credits || 0);
      const payment = Number(r.payment || 0);

      running += amount - credits - payment;

      return {
        ...r,
        __tipo: tipo,
        __amount: amount,
        __credits: credits,
        __payment: payment,
        __runningDue: running
      };
    });
  }, [rowsMov, saldoInicial]);

  const totals = rowsConSaldo.reduce(
    (acc, r) => {
      acc.amount += r.__amount;
      acc.credits += r.__credits;
      acc.payment += r.__payment;
      return acc;
    },
    { amount: 0, credits: 0, payment: 0 }
  );

  const amountDueBase = rowsConSaldo.length
    ? rowsConSaldo[rowsConSaldo.length - 1].__runningDue
    : Number(saldoInicial || 0);

  const totalAnticipo = prepagos.reduce((s, p) => s + Number(p.disponible || 0), 0);

  const balanceFinal = amountDueBase - totalAnticipo;

  const totalMovSel = Object.values(seleccionados).reduce(
    (s, v) => s + (v === '' ? 0 : Number(v || 0)),
    0
  );

  const tieneFacturas = facturasSeleccionadas.length > 0;
  // ModalMovimiento ya no maneja NC:
  const tiposPermitidos = tieneFacturas ? ['PG', 'ND', 'RT'] : ['PP', 'SI'];

  const esPagable = (tipo) => tipo === 'F' || tipo === 'SI';

  // ✅ filas visibles con filtro “Solo pendientes”
  const rowsVisibles = useMemo(() => {
    if (!soloPendientes) return rowsConSaldo;
    return rowsConSaldo.filter(
      (r) => esPagable(r.__tipo) && Number(facturasIndex[r.id]?.saldo || 0) > 0
    );
  }, [rowsConSaldo, soloPendientes, facturasIndex]);

  // edición (usa el mismo modal)
  const abrirEditarMovimiento = (row) => {
    if (!row.editable) return;

    const tipoDetectado = (row.tipoDocumento || row.tipo || row.tipoDoc || row.tipodocumento || '')
      .toString()
      .toUpperCase();

    const valorBase =
      Number(row.payment || 0) || Number(row.credits || 0) || Number(row.amount || 0) || 0;

    setMovimientoParaEditar({
      id: row.id,
      tipoDocumento: tipoDetectado,
      fecha: (row.fecha || '').slice(0, 10),
      valorTotal: valorBase,
      observaciones: row.obs || ''
    });

    setShowModal(true);
  };

  return (
    <div className="cartera-page">
      <h2>📒 Cartera {tipoMovimiento === 'C' ? 'Clientes' : 'Proveedores'}</h2>

      <div className="barra-filtros-cartera">
        <select
          value={tipoMovimiento}
          onChange={(e) => {
            setTipoMovimiento(e.target.value);
            setIdTercero('');
            setTimeline([]);
            setFacturasIndex({});
            setSeleccionados({});
            setPrepagos([]);
            setHayPrepagos(false);
            setSaldoInicial(0);
          }}
        >
          <option value="C">Clientes</option>
          <option value="P">Proveedores</option>
        </select>

        <select value={idTercero} onChange={(e) => setIdTercero(e.target.value)}>
          <option value="">
            -- {tipoMovimiento === 'C' ? 'Cliente principal (con marks)' : 'Proveedor'} --
          </option>
          {terceros.map((t) => (
            <option key={t.idtercero} value={t.idtercero}>
              {t.nombre}
            </option>
          ))}
        </select>

        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />

        {/* ✅ Toggle “Solo pendientes” con automatización de fechas y búsqueda */}
        <label className="filtro-pendientes">
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(e) => {
              const checked = e.target.checked;
              setSoloPendientes(checked);
              if (checked) {
                const hoy = new Date().toISOString().slice(0, 10);
                setDesde('1900-01-01');
                setHasta(hoy);
                if (idTercero) setTimeout(() => buscar(), 0);
              }
            }}
          />
          <span>Pendientes</span>
        </label>

        <button onClick={buscar} disabled={!idTercero || !desde || !hasta}>
          🔍 Buscar
        </button>

        <button
          onClick={() => {
            setMovimientoParaEditar(null);
            setShowModal(true);
          }}
          title={
            tieneFacturas
              ? 'Registrar PG/ND/RT para las facturas marcadas'
              : 'Registrar Prepago o Saldo Inicial'
          }
        >
          {tieneFacturas ? '➕ Registrar Movimiento' : '➕ Prepago / Saldo inicial'}
        </button>

        {/* Botón independiente para Nota de Crédito */}
        <button
          onClick={() => setShowNC(true)}
          disabled={!tieneFacturas || tipoMovimiento !== 'C'}
          title={
            !tieneFacturas
              ? 'Marca una o más facturas para aplicar Nota de Crédito'
              : tipoMovimiento !== 'C'
                ? 'La Nota de Crédito se aplica del lado de Clientes'
                : 'Aplicar Nota de Crédito sobre las facturas marcadas'
          }
          style={{ marginLeft: 8 }}
        >
          ➕ Nota de Crédito
        </button>

        {hayPrepagos && (
          <button onClick={() => setShowPrepagos(true)} style={{ marginLeft: 8 }}>
            💠 Aplicar anticipos
          </button>
        )}

        {terceroSeleccionado && (
          <div className="fila-tercero" style={{ marginTop: 6 }}>
            <button
              onClick={() =>
                abrirModalEstadoCuenta({
                  id: terceroSeleccionado.idtercero,
                  nombre: terceroSeleccionado.nombre,
                  tipo: tipoMovimiento
                })
              }
            >
              📄 Estado de Cuenta
            </button>
          </div>
        )}
      </div>

      {/* Panel de prepagos/saldos iniciales disponibles */}
      {prepagos.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>
            🔹 Prepagos / saldos iniciales disponibles
            <small style={{ marginLeft: 8, color: '#7a7a7a' }}>
              ({prepagos.length} {prepagos.length === 1 ? 'registro' : 'registros'})
            </small>
          </h3>

          <table className="tabla-cartera">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Fecha</th>
                <th>Descripción (Mark)</th>
                <th>Factura</th>
                <th>Tipo</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Aplicado</th>
                <th style={{ textAlign: 'right' }}>Disponible</th>
                <th>Obs</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {prepagos.map((p, idx) => {
                const cliente =
                  (p.mark && p.mark !== '-' && p.mark) ||
                  p.subcliente ||
                  p.terceroNombre ||
                  p.terceroNombrePrincipal ||
                  '—';

                const monto = Number(p.monto ?? p.amount ?? 0);
                const disponible = Number(p.disponible ?? 0);
                const aplicado = p.aplicado != null ? Number(p.aplicado) : monto - disponible;

                return (
                  <tr key={`prep-${p.id}-${idx}`}>
                    <td />
                    <td>{p.fecha ? dmy(p.fecha) : ''}</td>
                    <td>{cliente}</td>
                    <td>—</td>
                    <td>{p.tipo}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(monto)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(aplicado)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(disponible)}</td>
                    <td>{p.obs || ''}</td>
                    <td>
                      {p.editable ? (
                        <>
                          <button
                            onClick={() => {
                              setMovimientoParaEditar({
                                id: p.id,
                                tipoDocumento: p.tipo,
                                fecha: p.fecha,
                                valorTotal: monto,
                                observaciones: p.obs || ''
                              });
                              setShowModal(true);
                            }}
                            title="Editar"
                          >
                            ✏️
                          </button>{' '}
                          <button
                            onClick={async () => {
                              if (!window.confirm('¿Eliminar este movimiento?')) return;
                              try {
                                await api.delete(`/api/cartera/pago/${p.id}`);
                                await buscar();
                              } catch (err) {
                                console.error(err);
                                alert('❌ Error al eliminar movimiento');
                              }
                            }}
                            title="Eliminar"
                          >
                            🗑
                          </button>
                        </>
                      ) : (
                        <span style={{ color: '#aaa' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              {(() => {
                const t = prepagos.reduce(
                  (acc, x) => {
                    const monto = Number(x.monto ?? x.amount ?? 0);
                    const disponible = Number(x.disponible ?? 0);
                    const aplicado = x.aplicado != null ? Number(x.aplicado) : monto - disponible;
                    acc.monto += monto;
                    acc.aplicado += aplicado;
                    acc.disponible += disponible;
                    return acc;
                  },
                  { monto: 0, aplicado: 0, disponible: 0 }
                );

                return (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'right', fontWeight: 'bold' }}>
                      TOTALS
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(t.monto)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(t.aplicado)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(t.disponible)}</td>
                    <td colSpan={2} />
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </>
      )}

      <h3 style={{ marginTop: 16 }}>Movimientos</h3>
      <table className="tabla-cartera">
        <thead>
          <tr>
            <th style={{ width: 28 }} />
            <th>Fecha</th>
            <th>Descripción (Mark)</th>
            <th>Factura</th>
            <th>Tipo</th>
            <th>Amount</th>
            <th>Credits</th>
            <th>Payment</th>
            <th>Amount Due</th>
            <th>Mov.</th>
            <th>Obs</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rowsVisibles.map((row, idx) => {
            const tipoReal = row.__tipo;
            const esItemPagable = esPagable(tipoReal);
            const saldoFactura = esItemPagable ? Number(facturasIndex[row.id]?.saldo || 0) : 0;
            const puedePagar = esItemPagable && saldoFactura > 0;
            const seleccionado = esItemPagable && seleccionados[row.id] !== undefined;

            return (
              <tr key={`${tipoReal}-${row.id}-${idx}`}>
                <td>
                  {puedePagar && (
                    <input
                      type="checkbox"
                      checked={seleccionado}
                      onChange={() => toggleSeleccion(row)}
                    />
                  )}
                </td>
                <td>{row.fecha ? dmy(row.fecha) : ''}</td>
                <td>{row.mark || '-'}</td>
                <td>{row.numero || ''}</td>
                <td>{tipoReal}</td>
                <td style={{ textAlign: 'right' }}>{fmt(row.__amount)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(row.__credits)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(row.__payment)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(row.__runningDue)}</td>
                <td>
                  {seleccionado ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={saldoFactura}
                      value={seleccionados[row.id] ?? ''}
                      placeholder="0.00"
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') {
                          actualizarValorPago(row.id, '');
                          return;
                        }
                        const val = Math.min(parseFloat(raw) || 0, saldoFactura);
                        actualizarValorPago(row.id, val.toString());
                      }}
                      style={{ width: 90, textAlign: 'right' }}
                      title={`Saldo: ${fmt(saldoFactura)}`}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td>{row.obs || ''}</td>
                <td>
                  {row.editable ? (
                    <>
                      <button onClick={() => abrirEditarMovimiento(row)} title="Editar">
                        ✏️
                      </button>{' '}
                      <button
                        onClick={async () => {
                          if (!window.confirm('¿Eliminar este movimiento?')) return;
                          try {
                            if (tipoReal === 'SI') {
                              await api.delete(`/api/cartera/${row.id}`);
                            } else {
                              await api.delete(`/api/cartera/pago/${row.id}`);
                            }
                            await buscar();
                          } catch (err) {
                            console.error(err);
                            alert('❌ Error al eliminar movimiento');
                          }
                        }}
                        title="Eliminar"
                      >
                        🗑
                      </button>
                    </>
                  ) : (
                    <span style={{ color: '#aaa' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rowsVisibles.length === 0 && (
            <tr>
              <td colSpan={12} style={{ textAlign: 'center', color: '#666', padding: 12 }}>
                {soloPendientes
                  ? '(sin facturas pendientes con saldo)'
                  : '(sin movimientos en el rango)'}
              </td>
            </tr>
          )}
        </tbody>

        <tfoot>
          <tr>
            <td colSpan={5} style={{ textAlign: 'right', fontWeight: 'bold' }}>
              TOTALS
            </td>
            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(totals.amount)}</td>
            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(totals.credits)}</td>
            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(totals.payment)}</td>
            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
              {fmt(
                rowsConSaldo.length
                  ? rowsConSaldo[rowsConSaldo.length - 1].__runningDue
                  : Number(saldoInicial || 0)
              )}
            </td>
            <td colSpan={3} />
          </tr>
          {totalAnticipo > 0 && (
            <tr>
              <td colSpan={8} style={{ textAlign: 'right', fontWeight: 'bold' }}>
                Anticipo
              </td>
              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(totalAnticipo)}</td>
              <td colSpan={3} />
            </tr>
          )}
          <tr>
            <td colSpan={8} style={{ textAlign: 'right', fontWeight: 'bold' }}>
              Balance
            </td>
            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(balanceFinal)}</td>
            <td colSpan={3} />
          </tr>
          <tr>
            <td colSpan={9} style={{ textAlign: 'right', fontWeight: 'bold' }}>
              Mov. seleccionado
            </td>
            <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmt(totalMovSel)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      {showModal && (
        <ModalMovimiento
          show={showModal}
          onClose={() => {
            setShowModal(false);
            setMovimientoParaEditar(null);
            setSeleccionados({});
            buscar();
          }}
          tipoMovimiento={tipoMovimiento}
          idSeleccionado={idTercero}
          movimientoParaEditar={movimientoParaEditar}
          facturasSeleccionadas={facturasSeleccionadas}
          tiposPermitidos={tiposPermitidos}
        />
      )}

      {showNC && (
        <ModalNotaCredito
          show={showNC}
          onClose={() => {
            setShowNC(false);
            setSeleccionados({});
            buscar();
          }}
          tipoMovimiento={tipoMovimiento} // usualmente 'C'
          idSeleccionado={idTercero}
          facturasSeleccionadas={facturasSeleccionadas}
        />
      )}

      {showPrepagos && (
        <ModalAplicarPrepagos
          show={showPrepagos}
          onClose={() => {
            setShowPrepagos(false);
            buscar();
          }}
          tipoMovimiento={tipoMovimiento}
          idTercero={idTercero}
          desde={desde}
          hasta={hasta}
        />
      )}

      {mostrarModalEstadoCuenta && terceroActual && (
        <ModalEstadoCuenta
          show={mostrarModalEstadoCuenta}
          onClose={() => setMostrarModalEstadoCuenta(false)}
          tercero={terceroActual}
          desde={rangoFechas.desde}
          hasta={rangoFechas.hasta}
        />
      )}
    </div>
  );
}

export default CarteraPage;
