import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField
} from '@mui/material';
import api from '../services/api';
import { useSession } from '../context/SessionContext';
import { formatoFechaEcuador } from '../utils/fechaEcuador';

export default function ModalMovimientoFlor({
  open,
  onClose,
  proveedor,
  tipo,
  regla,
  onGuardadoOk
}) {
  const { user } = useSession();
  const [cantidad, setCantidad] = useState('');
  const [guardando, setGuardando] = useState(false);

  const limpiarCampos = () => {
    setCantidad('');
    setGuardando(false);
  };

  const handleGuardar = async () => {
    if (!tipo || !regla?.valor) {
      alert('❌ Debes seleccionar un tipo y una regla válidos.');
      return;
    }

    const cantNum = Number(cantidad);
    if (!Number.isFinite(cantNum) || cantNum <= 0) {
      alert('❌ La cantidad debe ser un número mayor a 0.');
      return;
    }

    if ((tipo === 'proyeccion' || tipo === 'compras') && !proveedor) {
      alert('❌ Debes seleccionar un proveedor.');
      return;
    }

    const [producto, variedad, empaque, longitud] = String(regla.valor)
      .split('|')
      .map((s) => String(s).trim());

    const fechaHoy = formatoFechaEcuador(new Date());

    const movimiento = {
      fecha: fechaHoy,
      tipo_movimiento: tipo,
      origen: tipo === 'proyeccion' || tipo === 'compras' ? 'proveedor' : 'propia',
      // Enviar textos/valor; el backend los convierte a IDs
      producto,
      variedad,
      idempaque: empaque,
      longitud,
      cantidad: cantNum,
      idproveedor: tipo === 'proyeccion' || tipo === 'compras' ? Number(proveedor) || null : null,
      idusuario: user?.id ?? 0
    };

    try {
      setGuardando(true);
      await api.post('/api/inventario/guardar-movimientos', [movimiento]);
      alert('✅ Movimiento guardado correctamente');
      onClose?.();
      limpiarCampos();
      onGuardadoOk?.();
    } catch (err) {
      console.error('❌ Error al guardar movimiento:', err);
      alert('❌ Error al guardar movimiento');
      setGuardando(false);
    }
  };

  const handleCancelar = () => {
    limpiarCampos();
    onClose?.();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !guardando) {
      handleGuardar();
    }
  };

  return (
    <Dialog open={open} onClose={handleCancelar}>
      <DialogTitle>➕ Agregar Movimiento</DialogTitle>
      <DialogContent sx={{ minWidth: 300, pt: 1 }}>
        <TextField
          label="Cantidad de Tallos"
          type="number"
          fullWidth
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          onKeyPress={handleKeyPress}
          autoFocus
          disabled={guardando}
          sx={{ mt: 2 }}
          inputProps={{ min: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button onClick={handleGuardar} variant="contained" color="primary" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
