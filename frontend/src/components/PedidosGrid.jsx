import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { DataGridPremium, useGridApiRef } from '@mui/x-data-grid-premium';
import { useSession } from '../context/SessionContext';
import socket from '../socket/socket';
import {
  getGridStringOperators,
  getGridNumericOperators,
  getGridSingleSelectOperators
} from '@mui/x-data-grid-premium';
import { Box } from '@mui/material';

import { agregarOpcionVaciosCustom } from '../utils/filtrosCustom';

const PedidosGrid = ({
  catalogo = [],
  clientes = [],
  proveedores = [],
  rows,
  setRows,
  apiRefExtern,
  forzarSeleccionados
}) => {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      socket.emit('identificarse', { idusuario: user.id });
    }
  }, [user]);

  const apiRef = useGridApiRef();
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);

  /**
   * ✅ Exponer apiRef al padre
   */
  useEffect(() => {
    if (apiRefExtern) {
      apiRefExtern.current = apiRef.current;
    }
  }, [apiRef, apiRefExtern]);

  /**
   * ✅ Obtener pedidos iniciales
   */
  const fetchPedidos = useCallback(() => {
    setLoading(true);
    axios
      .get('/api/pedidos')
      .then((res) => {
        const mapped = res.data.map((item) => ({
          ...item,
          id: Number(item.idpedido),
          idproveedor: item.idproveedor === null ? '' : item.idproveedor,
          idproducto: item.idproducto === null ? '' : item.idproducto,
          idvariedad: item.idvariedad === null ? '' : item.idvariedad,
          idlongitud: item.idlongitud === null ? '' : item.idlongitud,
          idempaque: item.idempaque === null ? '' : item.idempaque,
          idtipocaja: item.idtipocaja === null ? '' : item.idtipocaja,
          idOrder: item.idOrder === null ? '' : item.idOrder
        }));
        setRows(mapped);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [setRows]);

  useEffect(() => {
    fetchPedidos();
  }, [fetchPedidos]);

  /**
   * ✅ Escuchar eventos de bloqueo por socket
   */
  useEffect(() => {
    const handler = (bloqueos) => {
      setRows((prev) =>
        prev.map((p) =>
          bloqueos[p.id] ? { ...p, editando_por: bloqueos[p.id] } : { ...p, editando_por: null }
        )
      );
    };

    socket.on('bloqueo:pedido:update', handler);
    return () => socket.off('bloqueo:pedido:update', handler);
  }, [setRows]);

  /**
   * ✅ Manejar selección de filas y actualizar pedidoSeleccionado
   */
  const handleSelectionChange = async (newSelectionRaw) => {
    let ids = [];

    if (Array.isArray(newSelectionRaw)) {
      ids = newSelectionRaw.map(Number);
    } else if (newSelectionRaw && typeof newSelectionRaw === 'object') {
      if (newSelectionRaw.ids && typeof newSelectionRaw.ids.forEach === 'function') {
        newSelectionRaw.ids.forEach((id) => {
          if (id !== undefined && id !== null) ids.push(Number(id));
        });
      } else if (newSelectionRaw.ids && newSelectionRaw.ids instanceof Set) {
        ids = Array.from(newSelectionRaw.ids).map(Number);
      } else if (newSelectionRaw.added || newSelectionRaw.removed) {
        ids = [...(newSelectionRaw.added || []), ...(newSelectionRaw.removed || [])].map(Number);
      }
    }

    // ✅ Actualizar el pedido seleccionado automáticamente
    if (ids.length === 1) {
      const pedido = rows.find((r) => r.id === ids[0]);
      setPedidoSeleccionado(pedido || null);
    } else {
      setPedidoSeleccionado(null);
    }

    try {
      await forzarSeleccionados(ids, ids.length > 0);
    } catch (err) {
      console.error('❌ Error al forzar seleccionados:', err);
    }
  };

  /**
   * ✅ Opciones para selects
   */
  const opcionesReactSelect = useMemo(() => {
    const convertir = (lista = []) =>
      lista
        .map((v) => ({ value: v.id, label: v.valor }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const ordenarPorNombre = (lista = []) =>
      lista
        .map((v) => ({ value: v.idtercero, label: v.nombre }))
        .sort((a, b) => a.label.localeCompare(b.label));

    return {
      proveedor: ordenarPorNombre(proveedores),
      cliente: ordenarPorNombre(clientes),
      producto: convertir(catalogo.filter((c) => c.categoria === 'producto')),
      variedad: convertir(catalogo.filter((c) => c.categoria === 'variedad')),
      longitud: convertir(catalogo.filter((c) => c.categoria === 'longitud')),
      empaque: convertir(catalogo.filter((c) => c.categoria === 'empaque')),
      tipocaja: convertir(catalogo.filter((c) => c.categoria === 'tipocaja')),
      tipopedido: convertir(catalogo.filter((c) => c.categoria === 'tipopedido'))
    };
  }, [catalogo, clientes, proveedores]);

  /**
   * ✅ Columnas definidas
   */

  const esVacio = (params) => (!params.value && params.value !== 0 ? 'celda-vacia' : '');

  const columns = useMemo(() => {
    return [
      { field: 'idpedido', headerName: 'ID', width: 50 },
      { field: 'idfactura', headerName: 'Pedido', width: 60 },

      {
        field: 'codigo',
        headerName: 'Código',
        width: 90,
        editable: true,
        cellClassName: esVacio,
        filterOperators: [...getGridStringOperators()]
      },
      {
        field: 'observaciones',
        headerName: 'Obs.',
        width: 200,
        editable: true,
        cellClassName: esVacio,
        filterOperators: [...getGridStringOperators()]
      },

      {
        field: 'idproveedor',
        headerName: 'Proveedor',
        width: 110,
        type: 'singleSelect',
        editable: true,
        valueOptions: agregarOpcionVaciosCustom(opcionesReactSelect.proveedor),
        filterOperators: [...getGridSingleSelectOperators()],
        cellClassName: esVacio
      },
      {
        field: 'idproducto',
        headerName: 'Prod.',
        width: 100,
        type: 'singleSelect',
        editable: true,
        valueOptions: agregarOpcionVaciosCustom(opcionesReactSelect.producto),
        filterOperators: [...getGridSingleSelectOperators()],
        cellClassName: esVacio
      },
      {
        field: 'idvariedad',
        headerName: 'Var.',
        width: 100,
        type: 'singleSelect',
        editable: true,
        valueOptions: agregarOpcionVaciosCustom(opcionesReactSelect.variedad),
        filterOperators: [...getGridSingleSelectOperators()],
        cellClassName: esVacio
      },
      {
        field: 'idlongitud',
        headerName: 'Long.',
        width: 60,
        type: 'singleSelect',
        editable: true,
        valueOptions: agregarOpcionVaciosCustom(opcionesReactSelect.longitud),
        filterOperators: [...getGridSingleSelectOperators()],
        cellClassName: esVacio
      },
      {
        field: 'idempaque',
        headerName: 'Emp.',
        width: 60,
        type: 'singleSelect',
        editable: true,
        valueOptions: agregarOpcionVaciosCustom(opcionesReactSelect.empaque),
        filterOperators: [...getGridSingleSelectOperators()],
        cellClassName: esVacio
      },
      {
        field: 'gramaje',
        headerName: 'Gram',
        width: 60,
        type: 'number',
        editable: true,
        cellClassName: esVacio,
        filterOperators: [...getGridNumericOperators()]
      },

      {
        field: 'idtipocaja',
        headerName: 'Caja',
        width: 60,
        type: 'singleSelect',
        editable: true,
        valueOptions: agregarOpcionVaciosCustom(opcionesReactSelect.tipocaja),
        filterOperators: [...getGridSingleSelectOperators()],
        cellClassName: esVacio
      },
      {
        field: 'idOrder',
        headerName: 'Tipo',
        width: 80,
        type: 'singleSelect',
        editable: true,
        valueOptions: agregarOpcionVaciosCustom(opcionesReactSelect.tipopedido),
        filterOperators: [...getGridSingleSelectOperators()],
        cellClassName: esVacio
      },

      {
        field: 'cantidad',
        headerName: 'Cant.',
        width: 60,
        editable: true,
        type: 'number',
        aggregable: true,
        aggregationFunction: 'sum'
      },
      {
        field: 'tallos',
        headerName: 'Tallos',
        width: 60,
        type: 'number',
        editable: true,
        aggregable: true,
        aggregationFunction: 'sum'
      },
      {
        field: 'totaltallos',
        headerName: 'Total',
        width: 80,
        type: 'number',
        aggregable: true,
        aggregationFunction: 'sum'
      },
      {
        field: 'precio_unitario',
        headerName: 'Precio',
        width: 70,
        type: 'number',
        editable: true,
        cellClassName: esVacio,
        filterOperators: [...getGridNumericOperators()]
      },
      {
        field: 'peso',
        headerName: 'Peso',
        width: 60,
        type: 'number',
        aggregable: true,
        aggregationFunction: 'sum'
      }
    ];
  }, [opcionesReactSelect]);

  /**
   * ✅ Guardar cambios en fila
   */
  const handleProcessRowUpdate = (newRow) => {
    // Tomar los valores nuevos (o anteriores si no cambian)
    const cantidad = Number(newRow.cantidad) || 0;
    const tallos = Number(newRow.tallos) || 0;

    // Recalcular el campo totaltallos
    const totaltallos = cantidad * tallos;

    // Crear nuevo objeto con el valor actualizado
    const updatedRow = {
      ...newRow,
      totaltallos
    };

    // Limpiar campos undefined/null antes de enviar
    const cleaned = Object.fromEntries(
      Object.entries(updatedRow).filter(([_, v]) => v !== undefined && v !== null)
    );

    // Actualizar en el frontend
    setRows((prev) => prev.map((row) => (row.id === newRow.id ? updatedRow : row)));

    // Enviar al backend
    axios.put(`/api/pedidos/${newRow.id}`, { campo: 'ALL', valor: cleaned }).catch(console.error);

    return updatedRow;
  };

  const clienteActual = clientes.find((c) => c.idtercero === pedidoSeleccionado?.idcliente);

  return (
    <Box sx={{ height: 'calc(100vh - 150px)', width: '100%' }}>
      <DataGridPremium
        apiRef={apiRef}
        rows={rows}
        columns={columns}
        loading={loading}
        checkboxSelection
        disableRowSelectionOnClick
        processRowUpdate={handleProcessRowUpdate}
        onRowSelectionModelChange={handleSelectionChange}
        experimentalFeatures={{ newEditingApi: true }}
        density="compact"
        headerHeight={38}
        rowHeight={38}
        rowBuffer={1}
        virtualization
        showToolbar
        disableAggregation={false}
        isRowSelectable={(params) =>
          !params.row.editando_por || params.row.editando_por === user?.id
        }
        initialState={{
          aggregation: {
            model: {
              cantidad: 'sum',
              tallos: 'sum',
              totaltallos: 'sum',
              peso: 'sum'
            }
          }
        }}
        sx={{
          '& .MuiDataGrid-cell': {
            borderRight: '1px solid #ccc'
          },
          '& .MuiDataGrid-footerContainer': {
            fontWeight: 'bold'
          }
        }}
      />

      {clienteActual && (
        <span style={{ marginRight: '20px' }}>
          👤 Cliente: <strong>{clienteActual.nombre}</strong>
        </span>
      )}
    </Box>
  );
};

export default PedidosGrid;
