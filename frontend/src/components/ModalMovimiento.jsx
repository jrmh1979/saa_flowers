import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../services/api';

// Tipos ligados a facturas (ya SIN NC)
const TIPOS_FACTURA = ['PG', 'ND', 'RT'];
// Tipos libres (no requieren facturas seleccionadas)
const TIPOS_LIBRES = ['PP', 'SI'];

function ModalMovimiento({
  show,
  onClose,
  tipoMovimiento, // 'C' | 'P'
  idSeleccionado, // idtercero
  movimientoParaEditar, // { id, tipoDocumento, fecha, valorTotal, observaciones, idbanco, ... }
  facturasSeleccionadas = [], // [{ idfactura, numero_factura, saldo/amount_due/valorpago... }]
  tiposPermitidos
}) {
  const [tipoDocumento, setTipoDocumento] = useState('PG');
  const [fecha, setFecha] = useState('');
  const [valor, setValor] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // ====== SI (manual / import) ======
  const [numeroFacturaSI, setNumeroFacturaSI] = useState('');
  const [usarImportador, setUsarImportador] = useState(false);
  const [archivoImport, setArchivoImport] = useState(null);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState(null);

  // ====== Banco (solo PG/PP) ======
  const [bancos, setBancos] = useState([]);
  const [idBanco, setIdBanco] = useState(null);
  const [costoBancario, setCostoBancario] = useState('');
  const [numeroComprobante, setNumeroComprobante] = useState('');

  // ===== Helpers de saldo =====
  const getSaldoFactura = useCallback(
    (f) =>
      Number(
        f.saldo ?? f.amount_due ?? f.valorpago ?? f.valor_pendiente ?? f.valorpendiente ?? 0
      ) || 0,
    []
  );
  const totalSaldoSeleccion = useCallback(
    (arr) => (arr || []).reduce((s, f) => s + getSaldoFactura(f), 0),
    [getSaldoFactura]
  );

  const esEdicion = Boolean(movimientoParaEditar);
  const listaTipos = useMemo(
    () =>
      Array.isArray(tiposPermitidos) && tiposPermitidos.length
        ? tiposPermitidos
        : facturasSeleccionadas.length > 0
          ? TIPOS_FACTURA
          : TIPOS_LIBRES,
    [tiposPermitidos, facturasSeleccionadas.length]
  );

  const titulo = esEdicion
    ? `✏️ Editar Movimiento (${tipoMovimiento === 'C' ? 'Cliente' : 'Proveedor'})`
    : `➕ Nuevo Movimiento (${tipoMovimiento === 'C' ? 'Cliente' : 'Proveedor'})`;

  // ===== Estilos mínimos =====
  const styles = {
    grid: { display: 'grid', gap: 12 },
    two: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 },
    input: { height: 36, padding: '8px 10px' },
    number: { height: 36, padding: '8px 10px', textAlign: 'right' },
    textarea: { minHeight: 96, padding: 10, resize: 'vertical', lineHeight: 1.35 },
    hintRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 6
    },
    hint: { fontSize: 12, color: '#666' },
    chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    chip: {
      fontSize: 12,
      padding: '6px 10px',
      borderRadius: 999,
      border: '1px solid #d0d0d0',
      background: '#f7f7f7',
      color: '#333',
      cursor: 'pointer'
    },
    preview: {
      marginTop: 8,
      background: '#f6f9ff',
      border: '1px solid #dbe7ff',
      padding: 10,
      borderRadius: 8,
      fontSize: 13,
      color: '#2a3a55'
    }
  };

  // ===== Chips / snippets (ya sin NC) =====
  const CHIP_SETS = {
    PG: ['Transferencia', 'Efectivo', 'Cheque #', 'Banco: ', 'Ref: ', 'Comprobante: '],
    ND: ['Intereses', 'Ajuste', 'Servicios adicionales', 'ND N° '],
    RT: ['Fuente', 'IVA', 'Régimen: ', 'Comprobante: '],
    PP: ['Anticipo', 'Aplicable a futuras facturas', 'Ref: '],
    SI: ['Saldo inicial por migración', 'Periodo: ', 'N° doc: ']
  };
  const chips = CHIP_SETS[tipoDocumento] || [];
  const insertSnippet = (txt) =>
    setObservaciones((prev) =>
      !prev ? txt : prev.trim().endsWith(';') ? prev + ' ' + txt : prev + '; ' + txt
    );

  // ===== Observaciones =====
  const MAX_OBS = 280;
  const normalizeSpaces = (s) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s*;\s*/g, '; ')
      .trim();
  const beautify = (s) => {
    const t = normalizeSpaces(s);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  };

  // ===== Init =====
  useEffect(() => {
    if (!show) return;

    const hoy = new Date().toISOString().slice(0, 10);

    // Resets básicos al abrir
    setFecha(hoy);
    setResultadoImport(null);
    setArchivoImport(null);
    setUsarImportador(false);
    setNumeroFacturaSI('');

    // Resets de banco/comisión/comprobante
    setIdBanco(null);
    setCostoBancario('');
    setNumeroComprobante('');

    // Cargar catálogo de bancos
    api
      .get('/api/catalogo?categoria=bancos')
      .then((res) => setBancos(Array.isArray(res.data) ? res.data : []))
      .catch(() => setBancos([]));

    // ===== MODO EDICIÓN =====
    if (esEdicion && movimientoParaEditar) {
      setTipoDocumento((movimientoParaEditar.tipoDocumento || 'PG').toUpperCase());
      setFecha((movimientoParaEditar.fecha || hoy).slice(0, 10));
      setValor(
        movimientoParaEditar.valorTotal != null
          ? String(Number(movimientoParaEditar.valorTotal))
          : ''
      );
      setObservaciones(movimientoParaEditar.observaciones || '');

      // nuevos campos de banco
      setIdBanco(
        movimientoParaEditar.idbanco != null ? Number(movimientoParaEditar.idbanco) : null
      );
      setCostoBancario(
        movimientoParaEditar.costo_bancario != null
          ? String(movimientoParaEditar.costo_bancario)
          : ''
      );
      setNumeroComprobante(movimientoParaEditar.numero_comprobante || '');

      return;
    }

    // ===== NUEVO MOVIMIENTO =====
    const defaultTipo = listaTipos[0] || 'PG';
    setTipoDocumento(defaultTipo);

    // Autocalcular por SALDO de facturas seleccionadas (para PG/ND/RT)
    const total = totalSaldoSeleccion(facturasSeleccionadas);
    const obs = facturasSeleccionadas
      .map((f) => f.numero_factura)
      .filter(Boolean)
      .join(', ');

    if (TIPOS_FACTURA.includes(defaultTipo)) {
      setValor(total > 0 ? total.toFixed(2) : '');
      setObservaciones(obs ? `Operación sobre facturas ${obs}` : '');
    } else {
      setValor('');
      setObservaciones('');
    }
  }, [
    show,
    esEdicion,
    movimientoParaEditar,
    facturasSeleccionadas,
    listaTipos,
    totalSaldoSeleccion
  ]);

  // Autocalcular valor cuando cambia el tipo (por SALDO)
  useEffect(() => {
    if (esEdicion) return;
    const total = totalSaldoSeleccion(facturasSeleccionadas);
    if (TIPOS_FACTURA.includes(tipoDocumento)) setValor(total > 0 ? total.toFixed(2) : '');
    else setValor('');
  }, [tipoDocumento, facturasSeleccionadas, esEdicion, totalSaldoSeleccion]);

  const valorEsSoloLectura = useMemo(
    () => !esEdicion && TIPOS_FACTURA.includes(tipoDocumento),
    [esEdicion, tipoDocumento]
  );

  const isPagoOAnticipo = tipoDocumento === 'PG' || tipoDocumento === 'PP';

  // ===== SI: importar =====
  const validarImport = async () => {
    if (!archivoImport) return alert('Adjunta un archivo (.xlsx/.xls/.csv)');
    setImportando(true);
    setResultadoImport(null);
    try {
      const fd = new FormData();
      fd.append('file', archivoImport);
      const { data } = await api.post(`/api/cartera/si-import/${idSeleccionado}`, fd, {
        params: { tipoMovimiento, dry_run: 1, on_duplicate: 'skip' },
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResultadoImport(data);
    } catch (e) {
      console.error(e);
      alert('❌ Error al validar el archivo');
    } finally {
      setImportando(false);
    }
  };

  const importarArchivo = async () => {
    if (!archivoImport) return alert('Adjunta un archivo');
    if (!window.confirm('¿Importar saldos iniciales para este tercero?')) return;
    setImportando(true);
    setResultadoImport(null);
    try {
      const fd = new FormData();
      fd.append('file', archivoImport);
      const { data } = await api.post(`/api/cartera/si-import/${idSeleccionado}`, fd, {
        params: { tipoMovimiento, dry_run: 0, on_duplicate: 'skip' },
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      alert('✅ Importación completa');
      setResultadoImport(data);
      onClose?.();
    } catch (e) {
      console.error(e);
      alert('❌ Error al importar');
    } finally {
      setImportando(false);
    }
  };

  // ===== Guardar (sin NC) =====
  const guardar = async () => {
    try {
      const obsFinal = beautify(observaciones);
      const esPagoOAnticipo = tipoDocumento === 'PG' || tipoDocumento === 'PP';

      // ===== EDICIÓN =====
      if (esEdicion && movimientoParaEditar) {
        await api.put(`/api/cartera/pago/${movimientoParaEditar.id}`, {
          tipoMovimiento,
          idtercero: idSeleccionado,
          tipoDocumento,
          fecha,
          valorTotal: parseFloat(valor || 0),
          observaciones: obsFinal,
          ...(esPagoOAnticipo
            ? {
                idbanco: idBanco || null,
                costo_bancario: parseFloat(costoBancario || 0),
                numero_comprobante: (numeroComprobante || '').trim() || null
              }
            : {})
        });
        alert('✅ Movimiento actualizado');
        onClose?.();
        return;
      }

      if (!fecha) return alert('Ingresa fecha');

      // ===== TIPOS LIBRES (PP / SI) =====
      if (TIPOS_LIBRES.includes(tipoDocumento)) {
        // --- PP (Prepago) ---
        if (tipoDocumento === 'PP') {
          if (!valor || Number(valor) <= 0) return alert('Valor debe ser > 0');

          await api.post('/api/cartera/pago-prepago', {
            tipoMovimiento,
            idtercero: idSeleccionado,
            fecha,
            valorTotal: parseFloat(valor),
            observaciones: obsFinal,
            idbanco: idBanco || null,
            costo_bancario: parseFloat(costoBancario || 0),
            numero_comprobante: (numeroComprobante || '').trim() || null
          });

          alert('✅ Prepago registrado');
          onClose?.();
          return;
        }

        // --- SI (Saldo inicial) ---
        if (tipoDocumento === 'SI') {
          if (usarImportador) return alert('Estás en modo importación. Usa Validar/Importar.');
          if (!numeroFacturaSI.trim()) return alert('Número de factura es obligatorio');
          if (!valor || Number(valor) <= 0) return alert('Valor debe ser > 0');

          await api.post('/api/cartera/pago-completo', {
            tipoMovimiento,
            tipoDocumento: 'SI',
            idtercero: idSeleccionado,
            fecha,
            valorTotal: parseFloat(valor),
            observaciones: obsFinal,
            facturas: [],
            numero_factura: numeroFacturaSI.trim()
          });

          alert('✅ Saldo inicial registrado');
          onClose?.();
          return;
        }
      }

      // ===== TIPOS LIGADOS A FACTURAS (PG / ND / RT) =====
      const facturasValidas = facturasSeleccionadas.filter(
        (f) => f.idfactura && f.valorpago != null && f.valorpago > 0
      );
      if (facturasValidas.length === 0) {
        return alert('Selecciona facturas con valor para este tipo de movimiento.');
      }

      await api.post('/api/cartera/pago-completo', {
        tipoMovimiento,
        tipoDocumento,
        idtercero: idSeleccionado,
        fecha,
        valorTotal: parseFloat(valor || 0),
        observaciones: obsFinal,
        facturas: facturasValidas,
        ...(tipoDocumento === 'PG'
          ? {
              idbanco: idBanco || null,
              costo_bancario: parseFloat(costoBancario || 0),
              numero_comprobante: (numeroComprobante || '').trim() || null
            }
          : {})
      });

      alert('✅ Movimiento registrado');
      onClose?.();
    } catch (e) {
      console.error(e);
      alert('❌ Error al guardar el movimiento');
    }
  };

  if (!show) return null;

  const obsPlaceholder =
    {
      PG: 'Ej.: Transferencia, Banco Pichincha, Ref: 12345…',
      ND: 'Ej.: Ajuste por servicios adicionales…',
      RT: 'Ej.: Retención IVA/Fuente, comprobante…',
      PP: 'Ej.: Anticipo aplicado en futuras facturas…',
      SI: 'Ej.: Saldo inicial por migración (periodo)…'
    }[tipoDocumento] || 'Escribe detalles breves…';

  return (
    <div className="modal-overlay">
      <div className="modal modal-mov" style={{ width: '90vw', maxWidth: 900 }}>
        <h3 style={{ marginBottom: 10 }}>{titulo}</h3>

        <div style={styles.two}>
          <label style={styles.label}>
            Fecha:
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Tipo de Documento:
            <select
              value={tipoDocumento}
              onChange={(e) => setTipoDocumento(e.target.value)}
              style={styles.input}
            >
              {listaTipos.includes('PG') && <option value="PG">Pago</option>}
              {listaTipos.includes('ND') && <option value="ND">Nota Débito</option>}
              {listaTipos.includes('RT') && <option value="RT">Retención</option>}
              {listaTipos.includes('SI') && <option value="SI">Saldo Inicial</option>}
              {listaTipos.includes('PP') && <option value="PP">Prepago</option>}
            </select>
          </label>
        </div>

        {/* Banco + Costo bancario + Nº Comprobante (solo PG/PP) */}
        {isPagoOAnticipo && (
          <>
            <div style={{ ...styles.two, marginTop: 8 }}>
              <label style={styles.label}>
                Banco:
                <select
                  value={idBanco ?? ''}
                  onChange={(e) => setIdBanco(e.target.value ? Number(e.target.value) : null)}
                  style={styles.input}
                >
                  <option value="">— Selecciona banco —</option>
                  {bancos.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.valor}
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.label}>
                Costo bancario:
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={costoBancario}
                  onChange={(e) => setCostoBancario(e.target.value)}
                  placeholder="0.00"
                  style={styles.number}
                />
              </label>
            </div>

            <label style={{ ...styles.label, marginTop: 8 }}>
              Nº comprobante bancario:
              <input
                type="text"
                value={numeroComprobante}
                onChange={(e) => setNumeroComprobante(e.target.value)}
                placeholder="Ref/Comprobante de banco"
                style={styles.input}
              />
            </label>
          </>
        )}

        {tipoDocumento === 'SI' && !usarImportador && (
          <label style={{ ...styles.label, marginTop: 8 }}>
            Número de Factura (obligatorio):
            <input
              type="text"
              value={numeroFacturaSI}
              onChange={(e) => setNumeroFacturaSI(e.target.value)}
              placeholder="Ej. SI-0001"
              style={styles.input}
            />
          </label>
        )}

        <label style={{ ...styles.label, marginTop: 8 }}>
          Valor Total:
          <input
            type="number"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            readOnly={valorEsSoloLectura}
            placeholder={
              !esEdicion && TIPOS_FACTURA.includes(tipoDocumento)
                ? 'Autocalculado por saldos de facturas seleccionadas'
                : ''
            }
            style={styles.number}
          />
        </label>

        {/* Observaciones */}
        <div style={{ ...styles.grid, marginTop: 8 }}>
          <label style={styles.label}>
            Observaciones:
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value.slice(0, MAX_OBS))}
              onBlur={(e) => setObservaciones(beautify(e.target.value))}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault();
                  guardar();
                }
              }}
              rows={3}
              placeholder={obsPlaceholder}
              maxLength={MAX_OBS}
              style={styles.textarea}
            />
          </label>
          <div style={styles.hintRow}>
            <div style={styles.hint}>
              Tip: usa los chips para completar más rápido; <b>Ctrl + Enter</b> para guardar.
            </div>
            <div style={styles.hint}>
              {observaciones.length}/{MAX_OBS}
            </div>
          </div>
          <div style={styles.chips}>
            {chips.map((c) => (
              <button key={c} type="button" style={styles.chip} onClick={() => insertSnippet(c)}>
                {c}
              </button>
            ))}
          </div>
          <div style={styles.preview}>
            📝 <b>Vista previa:</b> {beautify(observaciones) || '— Sin observaciones —'}
          </div>
        </div>

        {/* Importador SI */}
        {tipoDocumento === 'SI' && (
          <div className="mmov-card">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={usarImportador}
                onChange={(e) => setUsarImportador(e.target.checked)}
              />
              Importar desde Excel (para este tercero)
            </label>
            {usarImportador && (
              <div style={{ marginTop: 8 }}>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setArchivoImport(e.target.files?.[0] || null)}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button disabled={importando || !archivoImport} onClick={validarImport}>
                    🔎 Validar (simular)
                  </button>
                  <button disabled={importando || !archivoImport} onClick={importarArchivo}>
                    ⬆️ Importar
                  </button>
                </div>
                {resultadoImport && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <b>Resultado:</b> {resultadoImport.dry_run ? '(simulación)' : '(importado)'} ·
                    insertados: {resultadoImport.insertados || 0} · simulados:{' '}
                    {resultadoImport.ok_simulados || 0} · saltados: {resultadoImport.saltados || 0}{' '}
                    · errores: {resultadoImport.errores || 0}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Botonera */}
        <div className="modal-buttons" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {!usarImportador && (
            <button onClick={guardar}>{esEdicion ? '💾 Actualizar' : '✅ Guardar'}</button>
          )}
          <button onClick={onClose}>❌ Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export default ModalMovimiento;
