// frontend/src/components/ModalOrdenCompra.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Stack,
  Button,
  Typography,
  LinearProgress
} from '@mui/material';
import { DataGridPremium, useGridApiRef } from '@mui/x-data-grid-premium';
import api from '../services/api';

function ModalOrdenCompra({ idfactura, onClose }) {
  const gridApiRef = useGridApiRef();

  const [proveedores, setProveedores] = useState([]);
  const [seleccionados, setSeleccionados] = useState([]); // solo para UI (no controlamos el grid)
  const [vistaPrevia, setVistaPrevia] = useState({}); // Orden: idproveedor -> base64
  const [vistaPacking, setVistaPacking] = useState(''); // Packing / Invoice: base64 único
  const [loading, setLoading] = useState(false);
  const [accionCargando, setAccionCargando] = useState(false);
  const [tipoReporte, setTipoReporte] = useState('orden'); // 'orden' | 'packing' | 'invoice'

  // Cargar proveedores de la factura
  useEffect(() => {
    if (!idfactura) return;

    const cargarProveedores = async () => {
      try {
        setLoading(true);
        const res = await api.get(`/api/facturas/${idfactura}/proveedores`);
        setProveedores(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        console.error('❌ Error al cargar proveedores:', err);
        setProveedores([]);
      } finally {
        setLoading(false);
      }
    };

    cargarProveedores();
  }, [idfactura]);

  // Filas para el grid
  const rows = useMemo(
    () =>
      (proveedores || []).map((p) => ({
        id: p.idproveedor,
        nombre: p.nombre,
        correo: p.correo
      })),
    [proveedores]
  );

  // Columnas para el grid
  const columns = useMemo(
    () => [
      {
        field: 'nombre',
        headerName: 'Proveedor',
        flex: 1,
        minWidth: 220
      },
      {
        field: 'correo',
        headerName: 'Correo',
        flex: 1,
        minWidth: 230,
        renderCell: (params) => params.value || '— sin correo —'
      }
    ],
    []
  );

  // Cada vez que cambia la selección, actualizamos el array local (solo para contadores / botones)
  const handleRowSelectionChange = useCallback((newModel) => {
    if (Array.isArray(newModel)) {
      setSeleccionados(newModel.map((id) => Number(id)));
    } else {
      setSeleccionados([]);
    }
  }, []);

  // Función helper: obtener IDs seleccionados (estado + fallback al grid)
  const obtenerIdsSeleccionados = useCallback(() => {
    let ids = Array.isArray(seleccionados) ? seleccionados.map(Number) : [];

    // Fallback por si algo se des-sincroniza
    if (!ids.length && gridApiRef.current && gridApiRef.current.getSelectedRows) {
      ids = Array.from(gridApiRef.current.getSelectedRows().keys()).map(Number);
    }

    return ids;
  }, [seleccionados, gridApiRef]);

  // Seleccionar / deseleccionar todos usando el apiRef (sin controlar el grid)
  const handleSeleccionarTodos = useCallback(() => {
    const grid = gridApiRef.current;
    if (!grid) return;
    const total = rows.length;
    if (!total) return;

    let seleccionActual = 0;
    if (grid.getSelectedRows) {
      const sel = grid.getSelectedRows();
      seleccionActual = sel ? sel.size : 0;
    }

    const allSelected = seleccionActual === total;

    if (allSelected) {
      // Deseleccionar todo
      if (grid.setRowSelectionModel) {
        grid.setRowSelectionModel([]);
      }
      setSeleccionados([]);
    } else {
      // Seleccionar todos
      const allIds = rows.map((r) => r.id);
      if (grid.setRowSelectionModel) {
        grid.setRowSelectionModel(allIds);
      }
      setSeleccionados(allIds.map(Number));
    }
  }, [gridApiRef, rows]);

  const haySeleccion = obtenerIdsSeleccionados().length > 0;
  const requiereSeleccion = tipoReporte === 'orden';
  const hayVistaOrden = Object.keys(vistaPrevia || {}).length > 0;
  const hayVistaPacking = !!vistaPacking;
  const hayVista = hayVistaOrden || hayVistaPacking;

  // Ver PDF
  const handleVer = useCallback(async () => {
    if (!idfactura) return;

    let proveedoresIds = [];
    if (tipoReporte === 'invoice') {
      proveedoresIds = []; // no necesita proveedores
    } else {
      proveedoresIds = obtenerIdsSeleccionados();
    }

    if (tipoReporte === 'orden' && proveedoresIds.length === 0) {
      alert('Selecciona al menos un proveedor para ver la Orden de compra.');
      return;
    }

    setAccionCargando(true);
    try {
      const body = { proveedores: proveedoresIds, formato: tipoReporte };

      if (tipoReporte === 'orden') {
        const res = await api.post(`/api/facturas/${idfactura}/orden/ver`, body);
        setVistaPrevia(res.data || {});
        setVistaPacking('');
      } else {
        const res = await api.post(
          `/api/facturas/${idfactura}/packing/ver?formato=${encodeURIComponent(tipoReporte)}`,
          body
        );
        setVistaPacking(res.data?.base64 || '');
        setVistaPrevia({});
      }
    } catch (err) {
      console.error('❌ Error en ver():', err);
      alert('❌ Error al generar vista previa');
    } finally {
      setAccionCargando(false);
    }
  }, [idfactura, tipoReporte, obtenerIdsSeleccionados]);

  // Enviar PDF por correo
  const handleEnviar = useCallback(async () => {
    if (!idfactura) return;

    let proveedoresIds = [];
    if (tipoReporte === 'invoice') {
      proveedoresIds = [];
    } else {
      proveedoresIds = obtenerIdsSeleccionados();
    }

    if (tipoReporte === 'orden' && proveedoresIds.length === 0) {
      alert('Selecciona al menos un proveedor para enviar la Orden de compra.');
      return;
    }

    setAccionCargando(true);
    try {
      const body = { proveedores: proveedoresIds, formato: tipoReporte };

      if (tipoReporte === 'orden') {
        await api.post(`/api/facturas/${idfactura}/orden/enviar`, body);
      } else {
        await api.post(
          `/api/facturas/${idfactura}/packing/enviar?formato=${encodeURIComponent(tipoReporte)}`,
          body
        );
      }

      alert('📤 Enviado con éxito');
      onClose?.();
    } catch (err) {
      console.error('❌ Error en enviar():', err);
      alert('❌ Error al enviar');
    } finally {
      setAccionCargando(false);
    }
  }, [idfactura, tipoReporte, obtenerIdsSeleccionados, onClose]);

  const deshabilitarAcciones = accionCargando || (requiereSeleccion && !haySeleccion);

  return (
    <Dialog
      open
      onClose={() => onClose?.()}
      fullWidth
      maxWidth="lg"
      PaperProps={{
        sx: {
          width: '90vw',
          height: '90vh',
          maxWidth: '90vw',
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
            <Typography variant="h6">📦 Reportes de Factura</Typography>
            <Typography variant="body2" color="text.secondary">
              Factura #{idfactura}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">Tipo de reporte:</Typography>
            <select
              value={tipoReporte}
              onChange={(e) => {
                const v = e.target.value;
                setTipoReporte(v);
                setVistaPrevia({});
                setVistaPacking('');
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ccc',
                fontSize: 14
              }}
            >
              <option value="orden">Orden de Compra (por proveedor)</option>
              <option value="packing">Packing (consolidado por proveedor)</option>
              <option value="invoice">Comercial Invoice (cliente)</option>
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
        {(loading || accionCargando) && <LinearProgress sx={{ mb: 1 }} />}

        {tipoReporte === 'invoice' && (
          <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
            Comercial Invoice no requiere seleccionar proveedores.
          </Typography>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md:
                tipoReporte === 'invoice'
                  ? '1fr'
                  : hayVista
                    ? 'minmax(0, 1.1fr) minmax(0, 1fr)'
                    : '1fr'
            },
            columnGap: 2,
            rowGap: 2,
            height: '100%',
            minHeight: 0
          }}
        >
          {/* Columna izquierda: grid de proveedores (solo orden/packing) */}
          {tipoReporte !== 'invoice' && (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minHeight: 0
              }}
            >
              <Box
                sx={{
                  p: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  flexWrap: 'wrap'
                }}
              >
                <Typography variant="subtitle2">
                  Proveedores de la factura ({rows.length})
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleSeleccionarTodos}
                  disabled={rows.length === 0}
                >
                  {/* Texto lo calculamos en el click, aquí mostramos algo genérico */}
                  Seleccionar / deseleccionar todos
                </Button>
              </Box>

              <Box sx={{ flex: 1, minHeight: 0 }}>
                {rows.length === 0 ? (
                  <Box
                    sx={{
                      p: 2,
                      textAlign: 'center',
                      color: 'text.secondary',
                      fontSize: 14
                    }}
                  >
                    No hay proveedores registrados en esta factura.
                  </Box>
                ) : (
                  <DataGridPremium
                    apiRef={gridApiRef}
                    rows={rows}
                    columns={columns}
                    getRowId={(r) => r.id}
                    checkboxSelection
                    disableColumnMenu
                    density="compact"
                    loading={loading}
                    onRowSelectionModelChange={handleRowSelectionChange}
                    sx={{
                      height: '100%',
                      '& .MuiDataGrid-main': { height: '100%' },
                      '& .MuiDataGrid-virtualScroller': {
                        overflowY: 'auto',
                        overflowX: 'auto',
                        scrollbarGutter: 'stable both-edges',
                        overscrollBehavior: 'contain'
                      }
                    }}
                  />
                )}
              </Box>

              <Box
                sx={{
                  px: 1.5,
                  py: 0.75,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  fontSize: 12,
                  color: 'text.secondary'
                }}
              >
                {tipoReporte === 'packing' ? (
                  <>
                    Si dejas sin selección, el packing incluirá <strong>todos</strong> los
                    proveedores.
                  </>
                ) : (
                  <>Se generará una Orden de compra por cada proveedor seleccionado.</>
                )}
              </Box>
            </Box>
          )}

          {/* Columna derecha: vista previa PDF */}
          {hayVista && (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minHeight: 0
              }}
            >
              <Box
                sx={{
                  p: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <Typography variant="subtitle2">Vista previa PDF</Typography>
                <Typography variant="caption" color="text.secondary">
                  {tipoReporte === 'orden'
                    ? 'Se muestran las órdenes generadas por proveedor.'
                    : 'Se muestra el documento consolidado generado.'}
                </Typography>
              </Box>

              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  p: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  overflowY: 'auto'
                }}
              >
                {tipoReporte === 'orden' &&
                  Object.entries(vistaPrevia).map(([id, base64]) => (
                    <Box
                      key={id}
                      sx={{
                        mb: 1,
                        height: { xs: 420, md: 'calc(80vh - 220px)' },
                        display: 'flex',
                        flexDirection: 'column'
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ mb: 0.5, display: 'block', color: 'text.secondary' }}
                      >
                        Proveedor #{id}
                      </Typography>
                      <Box
                        component="iframe"
                        src={`data:application/pdf;base64,${base64}`}
                        title={`Orden proveedor ${id}`}
                        sx={{
                          width: '100%',
                          flex: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1
                        }}
                      />
                    </Box>
                  ))}

                {(tipoReporte === 'packing' || tipoReporte === 'invoice') && vistaPacking && (
                  <Box
                    sx={{
                      height: { xs: 480, md: 'calc(80vh - 220px)' },
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    <Box
                      component="iframe"
                      src={`data:application/pdf;base64,${vistaPacking}`}
                      title={`${tipoReporte === 'packing' ? 'Packing' : 'Invoice'} ${idfactura}`}
                      sx={{
                        width: '100%',
                        flex: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1
                      }}
                    />
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1 }}>
        <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
          <Button variant="outlined" onClick={handleVer} disabled={deshabilitarAcciones}>
            {tipoReporte === 'orden'
              ? '👁 Ver Orden'
              : tipoReporte === 'packing'
                ? '👁 Ver Packing'
                : '👁 Ver Invoice'}
          </Button>

          <Button variant="contained" onClick={handleEnviar} disabled={deshabilitarAcciones}>
            {tipoReporte === 'orden'
              ? '📤 Enviar Orden'
              : tipoReporte === 'packing'
                ? '📤 Enviar Packing'
                : '📤 Enviar Invoice'}
          </Button>

          <Button variant="text" onClick={() => onClose?.()} disabled={accionCargando}>
            Cerrar
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

export default ModalOrdenCompra;
