import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../services/api';
import ImportadorExcel from './ImportadorExcel';
import { useSession } from '../context/SessionContext';
import socket from '../socket/socket';
import ModalOrdenCompra from './ModalOrdenCompra';
import { Button, TextField } from '@mui/material';
import { DataGridPremium } from '@mui/x-data-grid-premium';
import { esES } from '@mui/x-data-grid/locales';

function FacturaForm() {
  const { user } = useSession();

  const [clientes, setClientes] = useState([]);
  const [form, setForm] = useState({
    numero_factura: '',
    idcliente: '',
    fecha: '',
    fecha_vuelo: '',
    fecha_entrega: '',
    observaciones: '',
    idcarguera: ''
  });
  const [idFacturaCreada, setIdFacturaCreada] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [confirmText, setConfirmText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterModel, setFilterModel] = useState({ items: [], quickFilterValues: [] });

  const [loadingGuardar, setLoadingGuardar] = useState(false);
  const [loadingMigrar, setLoadingMigrar] = useState(false);
  const [facturasBloqueadas, setFacturasBloqueadas] = useState({});
  const [ocOpen, setOcOpen] = useState(false);
  const [ocFacturaId, setOcFacturaId] = useState(null);

  // ✅ selección estilo “ejemplo”: usamos Set y NO controlamos rowSelectionModel
  const [selectedIds, setSelectedIds] = useState(new Set());

  const abrirModalOC = (id) => {
    setOcFacturaId(Number(id));
    setOcOpen(true);
  };
  const cerrarModalOC = () => setOcOpen(false);

  const desdeRef = useRef();
  const hastaRef = useRef();
  const hoy = new Date().toISOString().split('T')[0];

  // Clientes
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/terceros?tipo=cliente');
        const clientesConId = (res.data || []).map((c) => ({
          ...c,
          idtercero: c.idtercero || c.id
        }));
        setClientes(clientesConId);
      } catch (err) {
        console.error('❌ Error al cargar clientes:', err);
      }
    })();
  }, []);

  // Sockets
  useEffect(() => {
    socket.on('bloqueo:factura:update', setFacturasBloqueadas);
    return () => socket.off('bloqueo:factura:update');
  }, []);

  // Carga inicial: hoy–hoy
  useEffect(() => {
    buscarFacturas(hoy, hoy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quick filter externo
  useEffect(() => {
    const values = searchText
      .split(' ')
      .map((v) => v.trim())
      .filter(Boolean);
    setFilterModel((prev) => ({ ...prev, quickFilterValues: values }));
  }, [searchText]);

  // Solo clientes MARCACION
  const clientesMarcacion = useMemo(
    () =>
      (clientes || []).filter((c) => String(c.clasifcliente || '').toUpperCase() === 'MARCACION'),
    [clientes]
  );

  // Form handlers
  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'idcliente') {
      // buscar el cliente completo en lista de clientes
      const cli = clientes.find((c) => String(c.idtercero) === String(value));

      setForm((prev) => ({
        ...prev,
        idcliente: value,
        // si el cliente tiene carguera por defecto, la usamos
        idcarguera: cli?.idcarguera ?? '' // 👈 aquí se precarga
      }));
    } else if (name === 'fecha') {
      setForm((prev) => ({
        ...prev,
        fecha: value,
        fecha_vuelo: value || '',
        fecha_entrega: value || ''
      }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoadingGuardar(true);

    // Helpers locales de normalización
    const toInt = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const toDate = (v) => (v ? String(v).slice(0, 10) : null);
    const trimOrNull = (v) => {
      const s = (v ?? '').toString().trim();
      return s === '' ? null : s;
    };
    const cleanPayload = (obj) =>
      Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v !== '' && v !== undefined && v !== null)
      );

    // Construye payload seguro (sin strings vacíos y con tipos correctos)
    const payloadBase = {
      idcliente: toInt(form.idcliente),
      idcarguera: toInt(form.idcarguera),

      fecha: toDate(form.fecha),
      fecha_vuelo: toDate(form.fecha_vuelo),
      fecha_entrega: toDate(form.fecha_entrega),

      awb: trimOrNull(form.awb),
      hawb: trimOrNull(form.hawb),
      observaciones: trimOrNull(form.observaciones),

      estado: 'proceso'
    };

    const payload = cleanPayload(payloadBase);

    try {
      if (idFacturaCreada) {
        const res = await api.put(`/api/facturas/${idFacturaCreada}`, payload);
        alert(res.data?.message || '✅ Factura actualizada');
      } else {
        // Solo valida duplicado si el usuario ingresó número
        if (payload.numero_factura) {
          const yaExiste = facturas.some(
            (f) => String(f.numero_factura) === String(payload.numero_factura)
          );
          if (yaExiste) {
            alert('❌ Ya existe una factura con ese número.');
            setLoadingGuardar(false);
            return;
          }
        }

        const res = await api.post('/api/facturas', payload);
        alert(res.data?.message || '✅ Factura creada');
        // el back puede devolver idFactura o idfactura
        setIdFacturaCreada(res.data?.idFactura ?? res.data?.idfactura ?? null);
      }

      await buscarFacturas(); // refresca
    } catch (err) {
      const msg =
        err?.response?.data?.error || err?.response?.data?.message || err.message || 'Error';
      console.error('❌ Error al guardar factura:', err);
      alert(`❌ Error al guardar:\n${msg}`);
    } finally {
      setLoadingGuardar(false);
    }
  };

  const handleFinalizarImportacion = () => {
    setForm({
      numero_factura: '',
      idcliente: '',
      fecha: '',
      fecha_vuelo: '',
      fecha_entrega: '',
      observaciones: '',
      idcarguera: ''
    });
    setIdFacturaCreada(null);
  };

  // Listado
  const buscarFacturas = async (desdeOverride, hastaOverride) => {
    const desde = desdeOverride ?? desdeRef.current?.value;
    const hasta = hastaOverride ?? hastaRef.current?.value;
    if (!desde || !hasta) return alert('Selecciona un rango de fechas');

    try {
      const res = await api.get(`/api/facturas/listar?desde=${desde}&hasta=${hasta}`);
      setFacturas(res.data || []);
      setSelectedIds(new Set()); // limpiar selección
    } catch (err) {
      console.error('❌ Error al buscar facturas:', err);
      alert('Error al obtener facturas');
    }
  };

  // CRUD
  const eliminarFactura = async (id) => {
    if (confirmText !== 'YO CONFIRMO ELIMINAR') {
      return alert('❌ Debes escribir exactamente: YO CONFIRMO ELIMINAR');
    }
    try {
      const res = await api.delete(`/api/facturas/eliminar/${id}`);
      alert(res.data?.mensaje || '✅ Eliminada');
      setFacturas((prev) => prev.filter((f) => Number(f.idfactura) !== Number(id)));
      if (Number(idFacturaCreada) === Number(id)) handleFinalizarImportacion();
    } catch (err) {
      const status = err.response?.status;
      const mensaje =
        err.response?.data?.mensaje || err.response?.data?.error || '❌ Error al eliminar factura';
      alert(status === 409 ? mensaje : `❌ ${mensaje}`);
    }
  };

  // 🔓 Liberar sin restricciones ni confirm de admin
  const liberarFactura = async (id) => {
    try {
      const res = await api.put(`/api/facturas/liberar/${id}`);
      alert(res.data?.message || '✅ Factura liberada');
      await buscarFacturas();
    } catch (err) {
      console.error('❌ Error al liberar factura:', err);
      alert(err.response?.data?.error || '❌ Error al liberar factura');
    }
  };

  const editarFactura = (factura) => {
    if (
      facturasBloqueadas[factura.idfactura] &&
      facturasBloqueadas[factura.idfactura] !== user.id
    ) {
      return alert('Esta factura está siendo editada por otro usuario');
    }
    socket.emit('bloqueo:factura', {
      idfactura: factura.idfactura,
      idusuario: user.id,
      bloqueado: true
    });
    setIdFacturaCreada(factura.idfactura);

    const fechaBase = factura.fecha ? factura.fecha.substring(0, 10) : '';
    setForm({
      numero_factura: factura.numero_factura || '',
      idcliente: factura.idcliente || '',
      fecha: fechaBase,
      fecha_vuelo: fechaBase,
      fecha_entrega: fechaBase
    });
  };

  // ===== Acciones por selección (top bar) =====
  const handleEditarSeleccion = () => {
    if (selectedIds.size !== 1) return alert('Selecciona exactamente 1 factura para editar.');
    const id = Array.from(selectedIds)[0];
    const f = facturas.find((x) => Number(x.idfactura) === Number(id));
    if (f) editarFactura(f);
  };

  const handleEliminarSeleccion = async () => {
    if (selectedIds.size === 0) return;
    if (confirmText !== 'YO CONFIRMO ELIMINAR') {
      return alert('❌ Debes escribir exactamente: YO CONFIRMO ELIMINAR');
    }
    for (const id of selectedIds) {
      // eslint-disable-next-line no-await-in-loop
      await eliminarFactura(id);
    }
    setConfirmText('');
    await buscarFacturas();
  };

  const handleVerSeleccion = () => {
    if (selectedIds.size !== 1) return alert('Selecciona exactamente 1 factura para ver.');
    const id = Array.from(selectedIds)[0];
    abrirModalOC(id);
  };

  const handleLiberarSeleccion = async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      // eslint-disable-next-line no-await-in-loop
      await liberarFactura(id);
    }
    await buscarFacturas();
  };

  // ===== GRID =====
  const fmtEC = (v) => {
    if (!v) return '-';
    const d = new Date(v);
    return isNaN(d) ? '-' : d.toLocaleDateString('es-EC');
  };

  // Filas con id = idfactura (como en tu ejemplo)
  const rows = useMemo(
    () =>
      (facturas || []).map((f) => ({ id: Number(f.idfactura), ...f, awb: f?.awb ?? f?.AWB ?? '' })),
    [facturas]
  );

  const columns = useMemo(
    () => [
      { field: 'numero_factura', headerName: 'Factura', minWidth: 110, flex: 0.8 },
      { field: 'idfactura', headerName: 'Pedido', minWidth: 110, flex: 0.7 },
      { field: 'cliente', headerName: 'Cliente', minWidth: 180, flex: 1.3 },
      { field: 'awb', headerName: 'AWB', minWidth: 150, flex: 0.9 },
      { field: 'observaciones', headerName: 'Observaciones', minWidth: 200, flex: 0.9 },
      {
        field: 'fecha',
        headerName: 'Fecha',
        minWidth: 120,
        flex: 0.9,
        renderCell: (p) => <span>{fmtEC(p.row?.fecha)}</span>,
        sortComparator: (v1, v2, p1, p2) => {
          const t1 = new Date(p1?.row?.fecha || 0).getTime();
          const t2 = new Date(p2?.row?.fecha || 0).getTime();
          return t1 - t2;
        },
        sortable: true,
        filterable: true
      },
      { field: 'estado', headerName: 'Estado', minWidth: 110, flex: 0.8 }
    ],
    []
  );

  // ✅ handler de selección robusto (igual al ejemplo)
  const handleRowSelectionChange = useCallback(
    (next) => {
      if (Array.isArray(next)) {
        setSelectedIds(new Set(next.map((n) => Number(n))));
        return;
      }
      if (next && typeof next === 'object' && next.ids) {
        const ids = next.ids instanceof Set ? Array.from(next.ids) : next.ids;
        setSelectedIds(new Set(ids.map((n) => Number(n))));
        return;
      }
      if (next && typeof next === 'object' && (next.added || next.removed)) {
        const cur = new Set(selectedIds);
        (next.added || []).forEach((id) => cur.add(Number(id)));
        (next.removed || []).forEach((id) => cur.delete(Number(id)));
        setSelectedIds(cur);
        return;
      }
      setSelectedIds(new Set());
    },
    [selectedIds]
  );

  return (
    <>
      <form className="form-card" onSubmit={handleSubmit}>
        <h2>Crear Solicitud de Pedido</h2>

        {idFacturaCreada && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              paddingBottom: '0.5rem',
              alignItems: 'center'
            }}
          >
            <label>Pedido (ID):</label>
            <input
              type="text"
              value={idFacturaCreada}
              disabled
              style={{ fontWeight: 'bold', color: 'green' }}
            />
          </div>
        )}

        <div
          className="form-toolbar"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0'
          }}
        >
          <select name="idcliente" value={form.idcliente} onChange={handleChange} required>
            <option value="">-- Selecciona Cliente --</option>
            {clientesMarcacion
              .sort((a, b) => a.nombre.localeCompare(b.nombre))
              .map((c) => (
                <option key={`cliente-${c.idtercero}`} value={c.idtercero}>
                  {c.nombre}
                </option>
              ))}
          </select>

          <TextField
            label="Fecha"
            type="date"
            name="fecha"
            value={form.fecha || ''}
            onChange={handleChange}
            required
            size="small"
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            label="Fecha vuelo"
            type="date"
            name="fecha_vuelo"
            value={form.fecha_vuelo || ''} // 👈 mejor que form.fecha
            onChange={handleChange}
            required
            size="small"
            InputLabelProps={{ shrink: true }}
          />

          <input type="hidden" name="fecha_entrega" value={form.fecha || ''} readOnly />
          <input
            type="text"
            placeholder="Observaciones (opcional)"
            value={form.observaciones || ''}
            onChange={(e) => setForm((p) => ({ ...p, observaciones: e.target.value }))}
            style={{ minWidth: 260 }} // quítalo o ajusta si no quieres ancho mínimo
          />

          <Button type="submit" disabled={loadingGuardar}>
            {idFacturaCreada ? 'Actualizar' : 'Guardar'}
          </Button>
        </div>
      </form>

      {idFacturaCreada && (
        <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem' }}>
          <div style={{ flex: 1 }}>
            <ImportadorExcel
              idfactura={idFacturaCreada}
              onImportacionFinalizada={handleFinalizarImportacion}
              setLoadingMigrar={setLoadingMigrar}
              loadingMigrar={loadingMigrar}
            />
          </div>
        </div>
      )}

      <div className="form-card" style={{ marginTop: '2rem', overflow: 'hidden' }}>
        <h3>📅 Buscar Pedidos por Rango de Fechas</h3>

        <div
          className="form-toolbar"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0'
          }}
        >
          <input type="date" ref={desdeRef} defaultValue={hoy} onChange={() => buscarFacturas()} />
          <input type="date" ref={hastaRef} defaultValue={hoy} onChange={() => buscarFacturas()} />
          {/* Botón Buscar eliminado: ahora el filtro se aplica automáticamente al cambiar las fechas */}

          {/* 🔝 Acciones por selección */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              onClick={handleEditarSeleccion}
              disabled={selectedIds.size !== 1}
            >
              ✏️ Editar (1)
            </Button>
            <Button
              variant="outlined"
              onClick={handleVerSeleccion}
              disabled={selectedIds.size !== 1}
            >
              🧾 Ver (1)
            </Button>
            <Button
              variant="outlined"
              onClick={handleEliminarSeleccion}
              disabled={selectedIds.size === 0 || confirmText !== 'YO CONFIRMO ELIMINAR'}
              title={confirmText !== 'YO CONFIRMO ELIMINAR' ? 'Escribe la confirmación abajo' : ''}
            >
              ❌ Eliminar ({selectedIds.size})
            </Button>
            <Button
              variant="outlined"
              onClick={handleLiberarSeleccion}
              disabled={selectedIds.size === 0}
            >
              🔓 Liberar ({selectedIds.size})
            </Button>
          </div>
        </div>

        {facturas.length > 0 && (
          <>
            {/* Confirmación + Quick Filter */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginTop: '0.25rem'
              }}
            >
              <label style={{ whiteSpace: 'nowrap' }}>
                Confirmación: escribe <b>YO CONFIRMO ELIMINAR</b>
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Texto de confirmación"
                style={{ flex: 1, minWidth: 220 }}
              />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="🔎 Buscar en la grilla…"
                style={{ width: 280 }}
              />
            </div>

            {/* GRID: sin controlar rowSelectionModel (como tu ejemplo) */}
            <div style={{ width: '100%', height: '62vh', marginTop: '0.5rem' }}>
              <DataGridPremium
                rows={rows}
                columns={columns}
                getRowId={(row) => row.id}
                checkboxSelection
                disableRowSelectionOnClick={false}
                density="compact"
                localeText={esES.components.MuiDataGrid.defaultProps.localeText}
                filterModel={filterModel}
                onFilterModelChange={setFilterModel}
                initialState={{
                  sorting: { sortModel: [{ field: 'numero_factura', sort: 'desc' }] }
                }}
                onRowSelectionModelChange={handleRowSelectionChange}
              />
            </div>
          </>
        )}

        {ocOpen && (
          <div className="modal-overlay">
            <div className="modal orden-compra">
              <ModalOrdenCompra idfactura={ocFacturaId} onClose={cerrarModalOC} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default FacturaForm;
