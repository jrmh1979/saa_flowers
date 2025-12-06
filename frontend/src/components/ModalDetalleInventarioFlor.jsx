import { useMemo, useState } from 'react';
import {
  Modal,
  Box,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Checkbox,
  TextField,
  Button
} from '@mui/material';
import api from '../services/api';

export default function ModalDetalleInventarioFlor({
  open,
  onClose,
  registros,
  fila,
  filtro, // 'compras' | 'proyeccion' | 'ventas'
  onGuardadoOk
}) {
  const [seleccionados, setSeleccionados] = useState({});

  // ⚠️ Hooks siempre arriba, sin returns antes
  const registrosFiltrados = useMemo(() => {
    const lista = Array.isArray(registros) ? registros : [];
    if (!filtro) return lista;
    return lista.filter((r) => r.tipo_movimiento === filtro);
  }, [registros, filtro]);

  const hayProyecciones = useMemo(
    () => registrosFiltrados.some((r) => r.tipo_movimiento === 'proyeccion'),
    [registrosFiltrados]
  );

  // Si no hay fila, no renderizamos (pero hooks ya corrieron)
  if (!fila) return null;

  const handleCheckboxChange = (id, checked, cantidadOriginal) => {
    setSeleccionados((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        confirmado: checked,
        cantidad: checked ? cantidadOriginal : ''
      }
    }));
  };

  const handleCantidadChange = (id, value) => {
    setSeleccionados((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), cantidad: Number(value) }
    }));
  };

  const guardarConfirmaciones = async () => {
    const confirmados = registrosFiltrados
      .filter((r) => r.tipo_movimiento === 'proyeccion')
      .filter(
        (r) =>
          seleccionados[r.idinventario]?.confirmado && seleccionados[r.idinventario]?.cantidad > 0
      );

    if (confirmados.length === 0) {
      alert('⚠️ No hay proyecciones seleccionadas con cantidad válida.');
      return;
    }

    // Enviar IDs + codagrupa
    const movimientos = confirmados.map((r) => ({
      fecha: String(r.fecha).slice(0, 10),
      tipo_movimiento: 'compras',
      origen: 'proveedor',
      idproducto: parseInt(fila.idproducto) || null,
      idvariedad: parseInt(fila.idvariedad) || null,
      idempaque: parseInt(fila.idempaque) || null,
      idlongitud: parseInt(fila.idlongitud) || null,
      cantidad: Number(seleccionados[r.idinventario].cantidad),
      idproveedor: parseInt(r.idproveedor) || null,
      codagrupa: fila.codagrupa
    }));

    try {
      await api.post('/api/inventario/guardar-movimientos', movimientos);
      alert('✅ Compras confirmadas correctamente');
      onGuardadoOk?.();
      onClose();
    } catch (err) {
      console.error(err);
      alert('❌ Error al guardar compras confirmadas');
    }
  };

  const mostrarCliente = filtro === 'ventas';
  const mostrarProveedor = !mostrarCliente; // compras/proyección

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: 900,
          maxHeight: '90vh',
          overflow: 'auto',
          bgcolor: 'background.paper',
          boxShadow: 24,
          p: 3,
          borderRadius: 2
        }}
      >
        {/* Encabezado: Producto | Variedad | TxB | Longitud */}
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          📋 {fila.producto} | {fila.variedad} | {fila.empaque} | {fila.longitud}
        </Typography>
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          Codagrupa: {fila.codagrupa || '-'}
        </Typography>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>✔</TableCell>
              {/* Fecha y Origen ocultos */}
              <TableCell>Tipo</TableCell>
              <TableCell>Cantidad</TableCell>
              {mostrarCliente && <TableCell>Cliente</TableCell>}
              {mostrarProveedor && <TableCell>Proveedor</TableCell>}
              <TableCell>Compra</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {registrosFiltrados.map((r) => {
              const cantidadMostrar =
                r.tipo_movimiento === 'ventas' ? (r.totalRamos ?? r.cantidad) : r.cantidad;

              return (
                <TableRow key={r.idinventario}>
                  <TableCell>
                    {r.tipo_movimiento === 'proyeccion' && (
                      <Checkbox
                        checked={seleccionados[r.idinventario]?.confirmado || false}
                        onChange={(e) =>
                          handleCheckboxChange(r.idinventario, e.target.checked, r.cantidad)
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>{r.tipo_movimiento}</TableCell>
                  <TableCell>{cantidadMostrar}</TableCell>
                  {mostrarCliente && <TableCell>{r.nombre_cliente || '–'}</TableCell>}
                  {mostrarProveedor && <TableCell>{r.nombre_proveedor || '-'}</TableCell>}
                  <TableCell>
                    {r.tipo_movimiento === 'proyeccion' &&
                      seleccionados[r.idinventario]?.confirmado && (
                        <TextField
                          type="number"
                          size="small"
                          value={seleccionados[r.idinventario]?.cantidad || ''}
                          onChange={(e) => handleCantidadChange(r.idinventario, e.target.value)}
                          inputProps={{ min: 1, max: r.cantidad }}
                          sx={{ width: 80 }}
                        />
                      )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, gap: 2 }}>
          <Button variant="outlined" onClick={onClose}>
            Cancelar
          </Button>
          {hayProyecciones && (
            <Button variant="contained" onClick={guardarConfirmaciones}>
              Confirmar compras
            </Button>
          )}
        </Box>
      </Box>
    </Modal>
  );
}
