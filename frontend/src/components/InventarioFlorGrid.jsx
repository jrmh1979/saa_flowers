import { useEffect, useState, useMemo } from 'react';
import { DataGridPremium } from '@mui/x-data-grid-premium';
import {
  Box,
  TextField,
  Typography,
  Button,
  MenuItem,
  FormControl,
  InputLabel,
  Select
} from '@mui/material';
import api from '../services/api';
import ModalMovimientoFlor from './ModalMovimientoFlor';
import ModalDetalleInventarioFlor from './ModalDetalleInventarioFlor';
import ModalRegistrarVentaFlor from './ModalRegistrarVentaFlor';
import { formatoFechaEcuador } from '../utils/fechaEcuador';

export default function InventarioFlorGrid() {
  const [reglas, setReglas] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [filas, setFilas] = useState([]);
  const [reglaSeleccionada, setReglaSeleccionada] = useState(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [proveedores, setProveedores] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState('');
  const [tipoMovimiento, setTipoMovimiento] = useState('');

  // 🔑 AHORA guardamos la fecha como STRING 'YYYY-MM-DD' (ya en horario ECU)
  const [fechaResumen, setFechaResumen] = useState(() => formatoFechaEcuador());

  const [modalDetalleAbierto, setModalDetalleAbierto] = useState(false);
  const [detalleFilaSeleccionada, setDetalleFilaSeleccionada] = useState(null);
  const [registrosDetalle, setRegistrosDetalle] = useState([]);
  const [modalVentaVisible, setModalVentaVisible] = useState(false);
  const [filaSeleccionadaParaVenta, setFilaSeleccionadaParaVenta] = useState(null);

  const fetchResumen = async () => {
    const fechaStr = fechaResumen; // ya es 'YYYY-MM-DD'
    const res = await api.get(`/api/inventario/resumen?fecha=${fechaStr}`);

    const raw = Array.isArray(res.data) ? res.data : res.data?.rows || [];
    const conIDs = raw.map((r, i) => {
      const saldo_inicial = Number(r?.saldo_inicial ?? 0);
      const compras = Number(r?.compras ?? 0);
      const ventas = Number(r?.ventas ?? 0);
      return {
        ...r,
        saldo_inicial,
        compras,
        proyeccion: Number(r?.proyeccion ?? 0),
        ventas,
        orden_fija: Number(r?.orden_fija ?? 0),
        preventa: Number(r?.preventa ?? 0),
        inv_post: Number(r?.inv_post ?? saldo_inicial + compras - ventas),
        id: r?.codagrupa || `${r?.producto}|${r?.variedad}|${r?.empaque}|${r?.longitud}|${i}`
      };
    });

    setFilas(conIDs);
  };

  // 🟦 Cargar resumen al cambiar la fecha (string estable, sin brincos de TZ)
  useEffect(() => {
    if (!fechaResumen) return;

    api
      .get(`/api/inventario/resumen?fecha=${fechaResumen}`)
      .then((res) => {
        if (!Array.isArray(res.data)) {
          console.error('❌ Respuesta inválida del backend (no es un arreglo):', res.data);
          alert('Error: respuesta del servidor no válida.');
          return;
        }

        const conIds = res.data.map((r, i) => ({
          ...r,
          id: r?.codagrupa || `${r.producto}|${r.variedad}|${r.empaque}|${r.longitud}|${i}`
        }));

        setFilas(conIds);
      })
      .catch((err) => {
        console.error('❌ Error al cargar resumen de inventario:', err);
        alert('Error al cargar resumen de inventario');
      });
  }, [fechaResumen]);

  // Reglas
  useEffect(() => {
    api
      .get('/api/inventario/reglas-ingreso')
      .then((res) => setReglas(res.data))
      .catch((err) => {
        console.error('❌ Error al cargar reglas:', err);
        alert('Error al cargar reglas');
      });
  }, []);

  // Proveedores
  useEffect(() => {
    api
      .get('/api/terceros?tipo=proveedor')
      .then((res) => setProveedores(res.data))
      .catch((err) => {
        console.error('❌ Error al cargar proveedores:', err);
        alert('Error al cargar proveedores');
      });
  }, []);

  const reglasFiltradas = useMemo(() => {
    if (!Array.isArray(reglas)) return [];
    return reglas.filter((r) => r.valor?.toLowerCase().includes(busqueda.toLowerCase()));
  }, [reglas, busqueda]);

  const abrirModalConRegla = (valor) => {
    if (!tipoMovimiento) {
      alert('❌ Debes seleccionar el tipo de movimiento antes de continuar');
      return;
    }

    if (tipoMovimiento === 'proyeccion' && !proveedorSeleccionado) {
      alert('❌ Debes seleccionar un proveedor para "Proyección"');
      return;
    }

    const reglaObj = reglas.find((r) => r.valor === valor);
    setReglaSeleccionada(reglaObj);
    setModalAbierto(true);
  };

  // Trae el detalle (por codagrupa) y filtra por tipo si se envía
  const verDetalle = async (fila, tipoFiltro = null) => {
    const fecha = fechaResumen; // string estable

    try {
      const res = await api.get('/api/inventario/detalle', {
        params: { fecha, codagrupa: fila.codagrupa }
      });

      let regs = res.data.map((r, i) => ({ ...r, id: r.idinventario || i }));
      if (tipoFiltro) {
        regs = regs.filter((r) => r.tipo_movimiento === tipoFiltro);
      }

      setRegistrosDetalle(regs);
      setDetalleFilaSeleccionada(fila);
      setModalDetalleAbierto(true);
    } catch (error) {
      console.error('❌ Error al obtener detalle:', error);
      alert('Error al obtener detalle');
    }
  };

  const columnas = [
    // sin columna "ver"
    {
      field: 'venta',
      headerName: 'Venta',
      width: 100,
      renderCell: (params) => (
        <Button
          size="small"
          variant="outlined"
          color="success"
          onClick={() => abrirModalVenta(params.row)}
        >
          💵
        </Button>
      )
    },

    { field: 'producto', headerName: 'Producto', width: 120 },
    { field: 'variedad', headerName: 'Variedad', width: 150 },
    { field: 'empaque', headerName: 'TxB', width: 50 },
    { field: 'longitud', headerName: 'Long.', width: 60 },
    { field: 'saldo_inicial', headerName: 'S.Inicial', type: 'number', width: 80 },
    {
      field: 'compras',
      headerName: 'Compras',
      type: 'number',
      width: 80,
      cellClassName: 'clicable'
    },
    {
      field: 'proyeccion',
      headerName: 'Proy.',
      type: 'number',
      width: 80,
      cellClassName: 'clicable'
    },
    {
      field: 'ventas',
      headerName: 'Ventas',
      type: 'number',
      width: 80,
      cellClassName: 'clicable'
    },
    {
      field: 'inv_post',
      headerName: 'Inv.Post',
      type: 'number',
      width: 90,
      renderCell: (params) => {
        const value = Number(params.value ?? 0);
        return <span style={{ color: value < 0 ? 'red' : 'inherit' }}>{value}</span>;
      }
    },
    { field: 'orden_fija', headerName: 'SO', type: 'number', width: 80 },
    { field: 'preventa', headerName: 'Preventa', type: 'number', width: 80 },
    {
      field: 'saldo_final',
      headerName: 'S.Final',
      type: 'number',
      width: 120,
      valueGetter: (params) => {
        try {
          const row = params?.row ?? {};
          return (
            Number(row.saldo_inicial || 0) +
            Number(row.compras || 0) +
            Number(row.proyeccion || 0) -
            Number(row.ventas || 0) -
            Number(row.orden_fija || 0) -
            Number(row.preventa || 0)
          );
        } catch {
          return 0;
        }
      }
    }
  ];

  const abrirModalVenta = (fila) => {
    setFilaSeleccionadaParaVenta(fila);
    setModalVentaVisible(true);
  };

  return (
    <Box sx={{ display: 'flex', gap: 4, mt: 2 }}>
      {/* 📋 Reglas */}
      <Box sx={{ width: 280 }}>
        <Typography variant="h6">📋 Reglas de Ingreso</Typography>

        <TextField
          fullWidth
          size="small"
          placeholder="Buscar regla..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          sx={{ mb: 1 }}
        />

        <FormControl fullWidth size="small" sx={{ mb: 1 }}>
          <InputLabel>Tipo de Movimiento</InputLabel>
          <Select
            value={tipoMovimiento}
            label="Tipo de Movimiento"
            onChange={(e) => setTipoMovimiento(e.target.value)}
          >
            <MenuItem value="">-- Selecciona tipo --</MenuItem>
            <MenuItem value="saldo_inicial">Saldo Inicial</MenuItem>
            <MenuItem value="proyeccion">Proyección</MenuItem>
          </Select>
        </FormControl>

        <FormControl fullWidth size="small" sx={{ mb: 1 }}>
          <InputLabel>Proveedor</InputLabel>
          <Select
            value={proveedorSeleccionado}
            label="Proveedor"
            onChange={(e) => setProveedorSeleccionado(e.target.value)}
          >
            <MenuItem value="">-- Selecciona proveedor --</MenuItem>
            {proveedores.map((p) => (
              <MenuItem key={p.idtercero} value={String(p.idtercero)}>
                {p.nombre}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box
          sx={{
            maxHeight: 400,
            overflow: 'auto',
            border: '1px solid #ccc',
            borderRadius: 1,
            p: 1,
            fontFamily: 'monospace',
            fontSize: 14
          }}
        >
          {reglasFiltradas.map((r, idx) => (
            <Box
              key={idx}
              sx={{
                p: 1,
                borderBottom: '1px solid #eee',
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5' }
              }}
              onDoubleClick={() => abrirModalConRegla(r.valor)}
            >
              {r.valor}
            </Box>
          ))}
        </Box>
      </Box>

      {/* 📦 Inventario Diario */}
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">📦 Inventario Diario</Typography>
          <TextField
            type="date"
            size="small"
            value={fechaResumen}
            onChange={(e) => setFechaResumen(e.target.value)} // ← guarda string directo
          />
        </Box>

        <DataGridPremium
          rows={filas}
          columns={columnas}
          editMode="cell"
          autoHeight
          density="compact"
          onCellDoubleClick={async ({ field, row }) => {
            const map = { compras: 'compras', proyeccion: 'proyeccion', ventas: 'ventas' };
            const tipo = map[field];
            if (!tipo) return;
            await verDetalle(row, tipo);
          }}
          sx={{
            '& .MuiDataGrid-cell.clicable': { cursor: 'pointer' }
          }}
        />
      </Box>

      <ModalMovimientoFlor
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        tipo={tipoMovimiento}
        proveedor={proveedorSeleccionado}
        regla={reglaSeleccionada}
        onGuardadoOk={() => {
          api.get(`/api/inventario/resumen?fecha=${fechaResumen}`).then((res) => {
            const conIds = res.data.map((r, i) => ({
              ...r,
              id: r?.codagrupa || `${r.producto}|${r.variedad}|${r.empaque}|${r.longitud}|${i}`
            }));
            setFilas(conIds);
          });
        }}
      />

      <ModalDetalleInventarioFlor
        open={modalDetalleAbierto}
        onClose={() => setModalDetalleAbierto(false)}
        registros={registrosDetalle}
        fila={detalleFilaSeleccionada}
        onGuardadoOk={() => {
          api.get(`/api/inventario/resumen?fecha=${fechaResumen}`).then((res) => {
            const conIds = res.data.map((r, i) => ({
              ...r,
              id: r?.codagrupa || `${r.producto}|${r.variedad}|${r.empaque}|${r.longitud}|${i}`
            }));
            setFilas(conIds);
          });
        }}
      />

      <ModalRegistrarVentaFlor
        visible={modalVentaVisible}
        onClose={() => setModalVentaVisible(false)}
        filaResumen={filaSeleccionadaParaVenta}
        refrescar={fetchResumen}
      />
    </Box>
  );
}
