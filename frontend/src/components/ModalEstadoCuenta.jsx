// ModalEstadoCuenta.jsx
import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Stack,
  Button,
  Typography,
  LinearProgress,
  Checkbox,
  Divider
} from '@mui/material';

const hoyISO = () => new Date().toISOString().slice(0, 10);

const ModalEstadoCuenta = ({
  show,
  onClose,
  tercero, // { id, tipo, nombre }
  desde,
  hasta,
  soloPendientes = false // modo inicial
}) => {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [cargandoPdf, setCargandoPdf] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // "movimientos" | "pendientes" | "notas_credito" | "comprobantes_pago"
  const [tipoReporte, setTipoReporte] = useState(soloPendientes ? 'pendientes' : 'movimientos');

  // ====== Estado para Notas de Crédito ======
  const [ncLista, setNcLista] = useState([]); // [{ idpago, fecha, nombre, correo, valor }]
  const [ncCargando, setNcCargando] = useState(false);
  const [ncSeleccionadas, setNcSeleccionadas] = useState([]); // ids de pago seleccionados
  const [ncIdVista, setNcIdVista] = useState(null); // idpago que se está viendo en el PDF

  // ====== Estado para Comprobantes de pago/cobro ======
  // esperamos algo tipo: [{ idpago, fecha, numero_comprobante, nombre, correo, valor }]
  const [cpLista, setCpLista] = useState([]);
  const [cpCargando, setCpCargando] = useState(false);
  const [cpSeleccionadas, setCpSeleccionadas] = useState([]);
  const [cpIdVista, setCpIdVista] = useState(null);

  // Al abrir, respetar el modo inicial
  useEffect(() => {
    if (show) {
      setTipoReporte(soloPendientes ? 'pendientes' : 'movimientos');
    }
  }, [soloPendientes, show]);

  /* ====================== Cargar PDF (Estados de cuenta) ====================== */
  useEffect(() => {
    let currentUrl = null;

    const cargarPdf = async () => {
      if (!tercero?.id) return;

      const esPendientes = tipoReporte === 'pendientes';
      const esNotasCredito = tipoReporte === 'notas_credito';
      const esComprobantes = tipoReporte === 'comprobantes_pago';

      // Para NC y Comprobantes NO cargamos PDF aquí, se carga al seleccionar un item
      if (esNotasCredito || esComprobantes) {
        setPdfUrl(null);
        setCargandoPdf(false);
        return;
      }

      // para movimientos normales seguimos exigiendo rango
      if (!esPendientes && (!desde || !hasta)) {
        setPdfUrl(null);
        return;
      }

      setCargandoPdf(true);
      try {
        const baseQuery = `idtercero=${tercero.id}&tipoMovimiento=${tercero.tipo}`;

        let urlFetch;
        if (esPendientes) {
          const corte = hasta || hoyISO();
          urlFetch = `/api/cartera/estado-cuenta-pendiente/pdf?${baseQuery}&corte=${corte}`;
        } else {
          urlFetch = `/api/cartera/estado-cuenta/pdf?${baseQuery}&desde=${desde}&hasta=${hasta}`;
        }

        const res = await fetch(urlFetch);
        if (!res.ok) throw new Error('Error al generar PDF');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        currentUrl = url;
        setPdfUrl(url);
      } catch (err) {
        console.error('Error al cargar PDF:', err);
        alert('❌ Error al generar el estado de cuenta');
        setPdfUrl(null);
      } finally {
        setCargandoPdf(false);
      }
    };

    if (show) cargarPdf();

    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      setPdfUrl(null);
    };
  }, [show, tercero, tipoReporte, desde, hasta]);

  /* ====================== Cargar lista de Notas de crédito ====================== */
  useEffect(() => {
    const cargarNotasCredito = async () => {
      if (!show || !tercero?.id) return;
      if (tipoReporte !== 'notas_credito') return;

      setNcCargando(true);
      setNcLista([]);
      setNcSeleccionadas([]);
      setNcIdVista(null);
      setPdfUrl(null);

      try {
        const params = new URLSearchParams();
        params.set('tipoMovimiento', tercero.tipo); // 'C' o 'P'
        params.set('idtercero', tercero.id);

        if (desde) params.set('desde', desde);
        if (hasta) params.set('hasta', hasta);

        const res = await fetch(`/api/cartera/notas-credito?${params.toString()}`);
        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        // esperamos [{ idpago, fecha, nombre, correo, valor }]
        setNcLista(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error al cargar notas de crédito:', err);
        alert('❌ Error al cargar las notas de crédito');
      } finally {
        setNcCargando(false);
      }
    };

    cargarNotasCredito();
  }, [show, tipoReporte, tercero, desde, hasta]);

  /* ====================== Cargar lista de Comprobantes pago/cobro ====================== */
  useEffect(() => {
    const cargarComprobantes = async () => {
      if (!show || !tercero?.id) return;
      if (tipoReporte !== 'comprobantes_pago') return;

      setCpCargando(true);
      setCpLista([]);
      setCpSeleccionadas([]);
      setCpIdVista(null);
      setPdfUrl(null);

      try {
        const params = new URLSearchParams();
        params.set('tipoMovimiento', tercero.tipo); // 'C' o 'P'
        params.set('idtercero', tercero.id);
        if (desde) params.set('desde', desde);
        if (hasta) params.set('hasta', hasta);

        // 🔹 Ruta pensada para listar comprobantes de cobro/pago
        // Debe devolver algo tipo:
        // [{ idpago, fecha, numero_comprobante, nombre, correo, valor }]
        const res = await fetch(`/api/cartera/comprobantes-pago?${params.toString()}`);
        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        setCpLista(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error al cargar comprobantes:', err);
        alert('❌ Error al cargar los comprobantes de pago/cobro');
      } finally {
        setCpCargando(false);
      }
    };

    cargarComprobantes();
  }, [show, tipoReporte, tercero, desde, hasta]);

  /* ====================== Cargar PDF de una Nota de crédito ====================== */
  const verNotaCredito = async (idpagoNc) => {
    if (!idpagoNc) return;
    if (!tercero?.id) return;

    setNcIdVista(idpagoNc);
    setCargandoPdf(true);

    try {
      const params = new URLSearchParams();
      // lado para el reporte (C o P según desde dónde lo ves)
      params.set('lado', tercero.tipo || 'C');
      if (tercero.tipo === 'P') {
        // para proveedor filtramos ese proveedor en el reporte
        params.set('proveedor_id', tercero.id);
      }

      const res = await fetch(`/api/cartera/reporte-nc/${idpagoNc}?${params.toString()}`);
      if (!res.ok) throw new Error('Error al generar PDF de la nota de crédito');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err) {
      console.error('Error al ver nota de crédito:', err);
      alert('❌ Error al generar la nota de crédito');
      setPdfUrl(null);
    } finally {
      setCargandoPdf(false);
    }
  };

  /* ====================== Cargar PDF de un Comprobante pago/cobro ====================== */
  const verComprobantePago = async (idpago) => {
    if (!idpago) return;
    if (!tercero?.id) return;

    setCpIdVista(idpago);
    setCargandoPdf(true);

    try {
      const params = new URLSearchParams();
      // lado = C (cliente cobro) | P (proveedor pago)
      params.set('lado', tercero.tipo || 'C');

      const res = await fetch(`/api/cartera/reporte-comprobante/${idpago}?${params.toString()}`);
      if (!res.ok) throw new Error('Error al generar PDF del comprobante');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err) {
      console.error('Error al ver comprobante:', err);
      alert('❌ Error al generar el comprobante de pago/cobro');
      setPdfUrl(null);
    } finally {
      setCargandoPdf(false);
    }
  };

  /* ====================== Enviar por correo ====================== */
  const enviarPorCorreo = async () => {
    if (!tercero?.id) return;
    setEnviando(true);

    try {
      const esPendientes = tipoReporte === 'pendientes';
      const esNotasCredito = tipoReporte === 'notas_credito';
      const esComprobantes = tipoReporte === 'comprobantes_pago';

      // === Estados de cuenta (como antes) ===
      if (!esNotasCredito && !esComprobantes) {
        const url = esPendientes
          ? `/api/cartera/estado-cuenta-pendiente/enviar`
          : `/api/cartera/estado-cuenta/enviar`;

        const payload = esPendientes
          ? {
              idtercero: tercero.id,
              tipoMovimiento: tercero.tipo,
              corte: hasta || hoyISO()
            }
          : {
              idtercero: tercero.id,
              tipoMovimiento: tercero.tipo,
              desde,
              hasta
            };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const mensaje = await res.text();
        if (!res.ok) throw new Error(mensaje);
        alert('📩 Enviado correctamente por correo');
        return;
      }

      // === Notas de crédito ===
      if (esNotasCredito) {
        if (!ncSeleccionadas.length) {
          alert('Selecciona al menos una nota de crédito para enviar.');
          return;
        }

        const esCliente = String(tercero.tipo || '').toUpperCase() === 'C';
        const target = esCliente ? 'cliente' : 'proveedores';

        let ok = 0;
        let fail = 0;

        for (const idpago of ncSeleccionadas) {
          const params = new URLSearchParams();
          params.set('target', target);
          if (!esCliente) {
            // para proveedor se filtra a ese proveedor
            params.set('proveedor_id', tercero.id);
          }

          const res = await fetch(`/api/cartera/reporte-nc/${idpago}/enviar?${params.toString()}`, {
            method: 'POST'
          });

          if (res.ok) ok++;
          else fail++;
        }

        if (ok && !fail) {
          alert(`📩 Se enviaron correctamente ${ok} nota(s) de crédito.`);
        } else if (ok && fail) {
          alert(`📩 Se enviaron ${ok} nota(s) de crédito, ${fail} tuvieron error.`);
        } else {
          throw new Error('No se pudo enviar ninguna nota de crédito');
        }
        return;
      }

      // === Comprobantes de pago/cobro ===
      if (esComprobantes) {
        if (!cpSeleccionadas.length) {
          alert('Selecciona al menos un comprobante para enviar.');
          return;
        }

        const esCliente = String(tercero.tipo || '').toUpperCase() === 'C';
        const target = esCliente ? 'cliente' : 'proveedores';

        let ok = 0;
        let fail = 0;

        for (const idpago of cpSeleccionadas) {
          const params = new URLSearchParams();
          params.set('target', target);

          const res = await fetch(
            `/api/cartera/reporte-comprobante/${idpago}/enviar?${params.toString()}`,
            { method: 'POST' }
          );

          if (res.ok) ok++;
          else fail++;
        }

        if (ok && !fail) {
          alert(`📩 Se enviaron correctamente ${ok} comprobante(s).`);
        } else if (ok && fail) {
          alert(`📩 Se enviaron ${ok} comprobante(s), ${fail} tuvieron error.`);
        } else {
          throw new Error('No se pudo enviar ningún comprobante');
        }
      }
    } catch (err) {
      console.error(err);
      alert(err.message || '❌ Error al enviar por correo');
    } finally {
      setEnviando(false);
    }
  };

  if (!show || !tercero) return null;

  const esPendientes = tipoReporte === 'pendientes';
  const esNotasCredito = tipoReporte === 'notas_credito';
  const esComprobantes = tipoReporte === 'comprobantes_pago';
  const esEstadoCuenta = !esNotasCredito && !esComprobantes;

  let etiquetaRango = '';
  if (esPendientes) {
    etiquetaRango = `Pendientes al ${hasta || hoyISO()}`;
  } else if (esNotasCredito) {
    const base =
      String(tercero.tipo || '').toUpperCase() === 'C'
        ? 'Notas de crédito del cliente'
        : 'Notas de crédito del proveedor';
    etiquetaRango = desde && hasta ? `${base} • ${desde} a ${hasta}` : base;
  } else if (esComprobantes) {
    const base =
      String(tercero.tipo || '').toUpperCase() === 'C'
        ? 'Comprobantes de cobro'
        : 'Comprobantes de pago';
    etiquetaRango = desde && hasta ? `${base} • ${desde} a ${hasta}` : base;
  } else {
    etiquetaRango = `${desde} a ${hasta}`;
  }

  const labelNc =
    String(tercero.tipo || '').toUpperCase() === 'C'
      ? 'Notas de crédito cliente'
      : 'Notas de crédito proveedor';

  const labelComprobantes =
    String(tercero.tipo || '').toUpperCase() === 'C'
      ? 'Comprobantes de cobro'
      : 'Comprobantes de pago';

  const deshabilitarEnviar =
    enviando ||
    (esEstadoCuenta && !esPendientes && (!desde || !hasta)) ||
    (esNotasCredito && !ncSeleccionadas.length) ||
    (esComprobantes && !cpSeleccionadas.length);

  const toggleSeleccionNc = (idpago) => {
    setNcSeleccionadas((prev) =>
      prev.includes(idpago) ? prev.filter((x) => x !== idpago) : [...prev, idpago]
    );
  };

  const toggleSeleccionCp = (idpago) => {
    setCpSeleccionadas((prev) =>
      prev.includes(idpago) ? prev.filter((x) => x !== idpago) : [...prev, idpago]
    );
  };

  // ====== Render ======
  return (
    <Dialog
      open={show}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      PaperProps={{
        sx: {
          width: '95vw',
          height: '90vh',
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          overflow: 'hidden'
        }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          spacing={1.5}
        >
          <Box>
            <Typography variant="h6">
              {esNotasCredito
                ? '📄 Reporte de Notas de Crédito'
                : esPendientes
                  ? '📄 Estado de Cuenta - Pendientes'
                  : esComprobantes
                    ? '📄 Comprobantes de pago / cobro'
                    : '📄 Estado de Cuenta'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {tercero?.nombre || 'SIN NOMBRE'} • {etiquetaRango}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">Tipo de reporte:</Typography>
            <select
              id="tipo-reporte"
              value={tipoReporte}
              onChange={(e) => setTipoReporte(e.target.value)}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ccc',
                fontSize: 14
              }}
            >
              <option value="movimientos">Movimientos estado de cuenta</option>
              <option value="pendientes">Estado de cuenta pendientes</option>
              <option value="notas_credito">{labelNc}</option>
              <option value="comprobantes_pago">{labelComprobantes}</option>
            </select>
          </Stack>
        </Stack>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          py: 1,
          borderBottom: 1,
          borderColor: 'divider'
        }}
      >
        {cargandoPdf && <LinearProgress sx={{ mb: 1 }} />}

        {esNotasCredito || esComprobantes ? (
          // ==== Layout especial: lista izquierda + visor derecha ====
          <Box
            sx={{
              display: 'flex',
              height: '100%',
              minHeight: 0,
              gap: 2
            }}
          >
            {/* LISTA (NC o Comprobantes) */}
            <Box
              sx={{
                width: 350,
                flexShrink: 0,
                borderRight: '1px solid',
                borderColor: 'divider',
                pr: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0
              }}
            >
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {esNotasCredito
                  ? `Notas de crédito de este ${
                      String(tercero.tipo || '').toUpperCase() === 'C' ? 'cliente' : 'proveedor'
                    }`
                  : `Comprobantes de ${
                      String(tercero.tipo || '').toUpperCase() === 'C' ? 'cobro' : 'pago'
                    }`}
              </Typography>
              <Divider sx={{ mb: 1 }} />

              <Box sx={{ flex: 1, overflow: 'auto' }}>
                {esNotasCredito ? (
                  ncCargando ? (
                    <Box sx={{ p: 1, fontSize: 13 }}>Cargando notas de crédito...</Box>
                  ) : !ncLista.length ? (
                    <Box sx={{ p: 1, fontSize: 13, color: 'text.secondary' }}>
                      No hay notas de crédito registradas.
                    </Box>
                  ) : (
                    ncLista.map((nc) => {
                      const seleccionado = ncSeleccionadas.includes(nc.idpago);
                      const viendo = ncIdVista === nc.idpago;
                      return (
                        <Box
                          key={nc.idpago}
                          onClick={() => verNotaCredito(nc.idpago)}
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1,
                            p: 1,
                            mb: 0.5,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: viendo ? 'primary.main' : 'divider',
                            bgcolor: viendo ? 'action.hover' : 'background.paper',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'action.hover' }
                          }}
                        >
                          <Checkbox
                            size="small"
                            checked={seleccionado}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSeleccionNc(nc.idpago)}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="subtitle2" noWrap>
                              NC #{nc.idpago} • {nc.fecha}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" noWrap>
                              {nc.nombre || 'SIN NOMBRE'}
                            </Typography>
                            <Typography
                              variant="caption"
                              color={nc.correo ? 'text.secondary' : 'error.main'}
                              noWrap
                            >
                              {nc.correo || 'Sin correo registrado'}
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                              Valor:{' '}
                              {Number(nc.valor || 0).toLocaleString('es-EC', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    })
                  )
                ) : cpCargando ? (
                  <Box sx={{ p: 1, fontSize: 13 }}>Cargando comprobantes...</Box>
                ) : !cpLista.length ? (
                  <Box sx={{ p: 1, fontSize: 13, color: 'text.secondary' }}>
                    No hay comprobantes registrados.
                  </Box>
                ) : (
                  cpLista.map((cp) => {
                    const seleccionado = cpSeleccionadas.includes(cp.idpago);
                    const viendo = cpIdVista === cp.idpago;
                    return (
                      <Box
                        key={cp.idpago}
                        onClick={() => verComprobantePago(cp.idpago)}
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 1,
                          p: 1,
                          mb: 0.5,
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: viendo ? 'primary.main' : 'divider',
                          bgcolor: viendo ? 'action.hover' : 'background.paper',
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'action.hover' }
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={seleccionado}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSeleccionCp(cp.idpago)}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap>
                            {cp.numero_comprobante
                              ? `CH ${cp.numero_comprobante} • ${cp.fecha}`
                              : `Pago #${cp.idpago} • ${cp.fecha}`}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {cp.nombre || 'SIN NOMBRE'}
                          </Typography>
                          <Typography
                            variant="caption"
                            color={cp.correo ? 'text.secondary' : 'error.main'}
                            noWrap
                          >
                            {cp.correo || 'Sin correo registrado'}
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                            Valor:{' '}
                            {Number(cp.valor || 0).toLocaleString('es-EC', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  })
                )}
              </Box>
            </Box>

            {/* VISOR PDF */}
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {cargandoPdf ? (
                <Box sx={{ p: 2, fontSize: 14 }}>Generando PDF...</Box>
              ) : pdfUrl ? (
                <Box
                  component="iframe"
                  src={pdfUrl}
                  title={esNotasCredito ? 'PDF Nota de Crédito' : 'PDF Comprobante'}
                  sx={{
                    width: '100%',
                    height: '100%',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1
                  }}
                />
              ) : (
                <Box sx={{ p: 2, fontSize: 14, color: 'text.secondary' }}>
                  {esNotasCredito
                    ? 'Selecciona una nota de crédito de la lista para ver el PDF.'
                    : 'Selecciona un comprobante de la lista para ver el PDF.'}
                </Box>
              )}
            </Box>
          </Box>
        ) : (
          // ==== Layout original: solo visor PDF para estados de cuenta ====
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {cargandoPdf ? (
              <Box sx={{ p: 2, fontSize: 14 }}>Generando PDF...</Box>
            ) : pdfUrl ? (
              <Box
                component="iframe"
                src={pdfUrl}
                title="PDF Estado de Cuenta"
                sx={{
                  width: '100%',
                  height: '100%',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1
                }}
              />
            ) : (
              <Box sx={{ p: 2, fontSize: 14, color: 'text.secondary' }}>
                ⚠️ No hay vista previa disponible.
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1 }}>
        <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
          <Button variant="contained" onClick={enviarPorCorreo} disabled={deshabilitarEnviar}>
            📤 {enviando ? 'Enviando...' : 'Enviar por correo'}
          </Button>
          <Button variant="text" onClick={onClose} disabled={enviando}>
            Cerrar
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
};

export default ModalEstadoCuenta;
