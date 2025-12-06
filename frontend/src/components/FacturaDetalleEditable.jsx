import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import api from '../services/api';
import ModalCajaMixta from './ModalCajaMixta';
import ModalOrdenCompra from './ModalOrdenCompra';
import ModalAsignarEtiqueta from './ModalAsignarEtiqueta';
import ModalReporteCodigo from './ModalReporteCodigo';
import ModalCoordinaciones from './ModalCoordinaciones';
import { useSession } from '../context/SessionContext';
import {
  DataGridPremium,
  useGridApiRef,
  gridFilteredSortedRowIdsSelector
} from '@mui/x-data-grid-premium';
import {
  Box,
  TextField,
  Typography,
  Tooltip,
  IconButton,
  CircularProgress,
  Checkbox
} from '@mui/material';
import { esES } from '@mui/x-data-grid-premium/locales';
import OrdenesFijasHubModal from './OrdenesFijasHubModal';

function FacturaDetalleEditable() {
  const [facturas, setFacturas] = useState([]);
  const [facturaSeleccionada, setFacturaSeleccionada] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [detalles, setDetalles] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [detalleSeleccionado, setDetalleSeleccionado] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const gridApiRef = useGridApiRef();
  const provMap = useMemo(() => {
    const m = new Map();
    (proveedores || []).forEach((p) => m.set(String(p.idtercero), p.nombre));
    return m;
  }, [proveedores]);
  const [modalOrdenVisible, setModalOrdenVisible] = useState(false);
  const [modoEdicionMix, setModoEdicionMix] = useState(false);
  const [idmixEditar, setIdmixEditar] = useState(null);
  const [modalEtiquetaAbierto, setModalEtiquetaAbierto] = useState(false);
  const [seleccionados, setSeleccionados] = useState([]);
  const [modalDividirVisible, setModalDividirVisible] = useState(false);
  const [registroADividir, setRegistroADividir] = useState(null);
  const [cantidadDividir, setCantidadDividir] = useState(1);
  const [guardandoFactura, setGuardandoFactura] = useState(false);
  const [modalDocumentoProveedorVisible, setModalDocumentoProveedorVisible] = useState(false);
  const [nuevoDocumentoProveedor, setNuevoDocumentoProveedor] = useState('');
  const [nuevaFechaCompra, setNuevaFechaCompra] = useState(''); // YYYY-MM-DD -> fechacompra
  const [filterModel, setFilterModel] = useState({ items: [] });
  const [modalReporteCodigoVisible, setModalReporteCodigoVisible] = useState(false);
  const [modalTrasladarVisible, setModalTrasladarVisible] = useState(false);
  const [pedidoDestino, setPedidoDestino] = useState('');
  const [cargandoTraslado, setCargandoTraslado] = useState(false);
  const [mostrarCoordinaciones, setMostrarCoordinaciones] = useState(false);
  const [busquedaPedido, setBusquedaPedido] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);
  const [openOrdenesFijas, setOpenOrdenesFijas] = useState(false);
  const idfacturaActual = facturaSeleccionada?.idfactura ?? null;
  const [reloadingDetalle, setReloadingDetalle] = useState(false);
  // 🔢 Modal para asignar número de factura al finalizar
  const [modalNumeroFacturaVisible, setModalNumeroFacturaVisible] = useState(false);
  const [numeroFacturaInput, setNumeroFacturaInput] = useState('');
  const [numeroFacturaError, setNumeroFacturaError] = useState('');
  const [cargandoNumeroFactura, setCargandoNumeroFactura] = useState(false);

  const recargarDetalle = async () => {
    try {
      setReloadingDetalle(true);
      await refrescarDetalleFactura(); // <-- tu función actual
    } finally {
      setReloadingDetalle(false);
    }
  };

  const { user } = useSession();

  const [form, setForm] = useState({
    numero_factura: '',
    fecha: '',
    fecha_vuelo: '',
    awb: '',
    hawb: '',
    idcarguera: '',
    observaciones: ''
  });

  // Normalizar a número
  const toNum = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  const recalcSubtotalesPorFlag = (row) => {
    const toNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const cantidadTallos = toNum(row.cantidadTallos);
    const totalRamos = toNum(row.totalRamos); // 👈 ahora usamos totalRamos
    const precio_unitario = toNum(row.precio_unitario);
    const precio_venta = toNum(row.precio_venta);
    const esRamoFlag = row.esramo === 1 || row.esramo === '1' || row.esramo === true;

    const baseCompra = esRamoFlag ? totalRamos : cantidadTallos; // 👈 cambio clave

    const subtotal = Number((baseCompra * precio_unitario).toFixed(2));
    const subtotalVenta = Number((baseCompra * precio_venta).toFixed(2));
    return { subtotal, subtotalVenta };
  };

  // Campos donde quieres auto-entrar a edición al tabular
  const AUTO_EDIT_FIELDS = useMemo(
    () => new Set(['precio_unitario', 'precio_venta', 'piezas', 'cantidadRamos']),
    []
  );

  // ¿La tecla inicia edición de números?
  const isNumericStarterKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    return (
      (k >= '0' && k <= '9') ||
      k === '.' ||
      k === ',' ||
      k === '-' ||
      k === 'Backspace' ||
      k === 'Delete'
    );
  };

  // --- AWB helper ---
  const formatAWB = (v) => {
    const d = String(v || '')
      .replace(/\D/g, '')
      .slice(0, 11); // solo dígitos, máx 11
    const p1 = d.slice(0, 3);
    const p2 = d.slice(3, 7);
    const p3 = d.slice(7, 11);
    return [p1, p2, p3].filter(Boolean).join('-'); // 000-0000-0000
  };

  // Normaliza coma decimal a punto
  const normalizeFirstKey = (k) => (k === ',' ? '.' : k);

  // 🔐 Helper: evitar F2 cuando el foco está escribiendo en inputs/textareas/selects/contenteditable
  const isTypingContext = (el) => {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    const editable = el.getAttribute?.('contenteditable');
    return tag === 'input' || tag === 'textarea' || tag === 'select' || editable === 'true';
  };

  //para doble click agregar registro
  const detallesRef = useRef(detalles);
  useEffect(() => {
    detallesRef.current = detalles;
  }, [detalles]);

  // Modal Mix (memoizado para deps estables) — poner ANTES de handleTabInsideGrid
  const handleCrearMix = useCallback((fila) => {
    if (fila.idmix) {
      setModoEdicionMix(true);
      setIdmixEditar(fila.idmix);
      setDetalleSeleccionado(fila);
    } else {
      setModoEdicionMix(false);
      setDetalleSeleccionado(fila);
    }
    setModalVisible(true);
  }, []);

  const handleTabInsideGrid = useCallback(
    (params, event) => {
      const api = gridApiRef.current;
      if (!api) return;

      setSelectedRow(params?.row || null);

      // 👉 Si el usuario empieza a tipear en una celda en "view", entra en edición y siembra el primer caracter
      if (isNumericStarterKey(event)) {
        const editable =
          params.colDef?.editable === true || typeof params.colDef?.editable === 'function';
        const isEditable = typeof editable === 'function' ? editable(params) : editable;

        if (isEditable && api.getCellMode?.(params.id, params.field) !== 'edit') {
          event.preventDefault();
          const first = normalizeFirstKey(event.key);
          api.startCellEditMode?.({ id: params.id, field: params.field });
          // Sembrar el primer carácter (solo en campos numéricos que definimos)
          if (AUTO_EDIT_FIELDS.has(params.field)) {
            api.setEditCellValue?.({
              id: params.id,
              field: params.field,
              value: first,
              debounceMs: 0
            });
          }
          return;
        }
      }

      // 👉 F2 abre Mix (como ya lo tenías)
      if (event.key === 'F2') {
        const mode = api.getCellMode ? api.getCellMode(params.id, params.field) : 'view';
        if (mode !== 'edit') {
          event.preventDefault();
          handleCrearMix(params.row);
        }
        return;
      }

      // Helper: orden de campos permitidos (como ya lo tenías)
      const TAB_SKIP_FIELDS = new Set(['totalRamos', 'subtotal', 'subtotalVenta', 'gram']);
      const getAllowedFields = () => {
        const cols = (api.getVisibleColumns?.() ?? api.getAllColumns?.() ?? []).filter(Boolean);
        const allowedCols = cols.filter(
          (c) => c.tabbable !== false && !TAB_SKIP_FIELDS.has(c.field)
        );
        const editableFields = allowedCols.filter((c) => c.editable).map((c) => c.field);
        return editableFields.length ? editableFields : allowedCols.map((c) => c.field);
      };

      // ENTER en view → moverse a la derecha y **auto-entrar en edición** si aplica
      if (event.key === 'Enter') {
        const mode = api.getCellMode ? api.getCellMode(params.id, params.field) : 'view';
        if (mode !== 'edit') {
          event.preventDefault();
          const fields = getAllowedFields();
          const idx = fields.indexOf(params.field);
          if (idx === -1) return;
          const nextField = fields[(idx + 1) % fields.length];
          requestAnimationFrame(() => {
            api.setCellFocus?.(params.id, nextField);
            if (AUTO_EDIT_FIELDS.has(nextField)) {
              api.startCellEditMode?.({ id: params.id, field: nextField });
            }
          });
          return;
        }
      }

      // --- TAB / SHIFT+TAB dentro de la grid ---
      if (event.key !== 'Tab') return;
      event.preventDefault();

      const rowIds = api.getVisibleRowModels
        ? Array.from(api.getVisibleRowModels().keys())
        : api.getSortedRowIds
          ? api.getSortedRowIds()
          : [];

      const fields = getAllowedFields();

      const rIdx = rowIds.indexOf(params.id);
      const cIdx = fields.indexOf(params.field);
      if (rIdx < 0 || cIdx < 0) return;

      const forward = !event.shiftKey;
      let i = rIdx,
        j = cIdx;

      while (true) {
        if (forward) {
          j++;
          if (j >= fields.length) {
            j = 0;
            i++;
          }
        } else {
          j--;
          if (j < 0) {
            j = fields.length - 1;
            i--;
          }
        }
        if (i < 0 || i >= rowIds.length) return;

        const nextId = rowIds[i];
        const nextField = fields[j];

        api.setCellFocus?.(nextId, nextField);

        // 👇 Auto-entrar en edición para campos numéricos clave
        if (AUTO_EDIT_FIELDS.has(nextField)) {
          requestAnimationFrame(() => {
            api.startCellEditMode?.({ id: nextId, field: nextField });
          });
        }
        return;
      }
    },
    [gridApiRef, handleCrearMix, AUTO_EDIT_FIELDS]
  );

  // Mover foco/edición a la celda de la derecha en la MISMA fila
  const moveRightSameRow = useCallback(
    (id, field) => {
      const api = gridApiRef.current;
      if (!api) return;

      // Columnas visibles (preferimos solo las editables)
      const cols = (api.getVisibleColumns?.() ?? api.getAllColumns?.() ?? []).filter(Boolean);
      const editableFields = cols.filter((c) => c.editable).map((c) => c.field);
      const fields = editableFields.length ? editableFields : cols.map((c) => c.field);

      const idx = fields.indexOf(field);
      if (idx < 0) return;

      const nextField = fields[(idx + 1) % fields.length]; // wrap dentro de la misma fila

      requestAnimationFrame(() => {
        api.setCellFocus?.(id, nextField);
        // Opcional: entrar en edición de inmediato
        if (api.startCellEditMode) {
          api.startCellEditMode({ id, field: nextField });
        } else if (api.setCellMode) {
          api.setCellMode(id, nextField, 'edit');
        }
      });
    },
    [gridApiRef]
  );

  const handleEditStopEnterMoveRight = useCallback(
    (params, event) => {
      const reason = params?.reason;
      // Dispara tanto con Enter como con Tab
      if (reason !== 'enterKeyDown' && reason !== 'tabKeyDown') return;

      // Evita el comportamiento por defecto (p. ej. bajar a la siguiente fila)
      if (event) event.defaultMuiPrevented = true;

      // Muévete a la derecha en la misma fila y abre edición en la nueva celda
      moveRightSameRow(params.id, params.field);
    },
    [moveRightSameRow]
  );

  // Tallos por ramo desde catálogo (ajusta si tu catálogo es otro)
  const obtenerTallosPorRamo = (idempaque, catalogo) => {
    if (!idempaque) return 0;
    const emp = (catalogo || []).find(
      (c) => c.categoria === 'empaque' && Number(c.id) === Number(idempaque)
    );
    const match = emp?.valor?.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  // Recalcula derivados con una "cantidad" común (cajas)
  const buildDerivadosConCantidad = (rowBase, cantidadComun, catalogoRef) => {
    const cantidad = toNum(cantidadComun);
    const cantidadRamos = toNum(rowBase.cantidadRamos);
    const idempaque = toNum(rowBase.idempaque);
    const precio_unitario = toNum(rowBase.precio_unitario);
    const precio_venta = toNum(rowBase.precio_venta);
    const esramo = rowBase.esramo ?? 0;

    const tallosPorRamo = obtenerTallosPorRamo(idempaque, catalogoRef);
    const cantidadTallos = cantidad * cantidadRamos * tallosPorRamo;
    const tallos = cantidad > 0 ? Math.round(cantidadTallos / cantidad) : 0;
    const totalRamos = cantidad * cantidadRamos;

    // 🧮 Subtotales dependen del flag esramo:
    // - esramo = 0 → calcula por tallo
    // - esramo = 1 → calcula por ramo
    const { subtotal, subtotalVenta } = recalcSubtotalesPorFlag({
      cantidadTallos,
      totalRamos,
      precio_unitario,
      precio_venta,
      esramo
    });

    return { cantidadTallos, tallos, subtotal, subtotalVenta, totalRamos };
  };

  useEffect(() => {
    (async () => {
      try {
        const [facturasRes, catalogoRes, proveedoresRes] = await Promise.all([
          api.get('/api/facturas/facturas-con-clientes'),
          api.get('/api/catalogo/todo'),
          api.get('/api/terceros/proveedores')
        ]);
        setFacturas(facturasRes.data);
        const proveedoresFormateados = proveedoresRes.data.map((p) => ({
          id: p.idtercero,
          valor: p.nombre,
          categoria: 'proveedor'
        }));
        setCatalogo([...catalogoRes.data, ...proveedoresFormateados]);
      } catch (err) {
        console.error('❌ Error al cargar datos:', err);
      }
    })();
  }, []);

  useEffect(() => {
    const fetchProveedores = async () => {
      try {
        const res = await api.get('/api/terceros?tipo=proveedor');
        setProveedores(res.data);
      } catch (err) {
        console.error('Error al cargar proveedores', err);
      }
    };
    fetchProveedores();
  }, []);

  const idMinPorMix = {};
  detalles.forEach((d) => {
    if (d.idmix && (!idMinPorMix[d.idmix] || d.iddetalle < idMinPorMix[d.idmix])) {
      idMinPorMix[d.idmix] = d.iddetalle;
    }
  });

  // F2 abre el modal de Mix usando la fila seleccionada
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'F2') {
        if (isTypingContext(document.activeElement)) return;
        if (selectedRow) {
          e.preventDefault();
          try {
            handleCrearMix(selectedRow);
          } catch (err) {
            console.error('Error al abrir modal con F2:', err);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedRow, handleCrearMix]); // ← añadido handleCrearMix

  // 🔎 construir título/subtítulo compactos: "P.2 · F.1 · <obs>"
  const mapPedido = useCallback((f) => {
    const fecha = f.fecha?.substring(0, 10) || '';
    const p = Number(f.idfactura);
    const fac =
      f.numero_factura !== null && f.numero_factura !== undefined && f.numero_factura !== ''
        ? Number(f.numero_factura)
        : null;

    const title = f.cliente || '—';

    // 👇 Nuevo: observaciones (opcional) + recorte para no romper el layout
    const obs = String(f.observaciones || '').trim();
    const obsShort = obs ? ` · ${obs.length > 35 ? obs.slice(0, 35) + '…' : obs}` : '';

    const subtitle = `${fecha} · P.${isNaN(p) ? '-' : p} · F.${fac ?? '-'}${obsShort}`;
    const search = `${title} ${subtitle} ${obs.toLowerCase()}`;

    // devolvemos obs para usarla como tooltip en el render
    return { id: f.idfactura, title, subtitle, search, obs };
  }, []);

  // Estado de carga para COPIAR
  const [cargandoCopiado, setCargandoCopiado] = useState(false);

  // Handler para COPIAR los seleccionados al pedido destino
  const confirmarCopiado = async () => {
    if (!pedidoDestino || seleccionados.length === 0) return;
    try {
      setCargandoCopiado(true);
      await api.post('/api/facturas/copiar-detalles', {
        ids: seleccionados, // [iddetalle, ...]
        idfacturaDestino: Number(pedidoDestino),
        idusuario: user?.id || user?.idusuario // opcional para auditoría
      });
      alert('✅ Registros copiados con éxito');
      setModalTrasladarVisible(false);
    } catch (err) {
      console.error('❌ Error al copiar:', err);
      alert(err?.response?.data?.error || '❌ Error al copiar');
    } finally {
      setCargandoCopiado(false);
    }
  };

  const recargarFacturas = useCallback(async () => {
    const res = await api.get('/api/facturas/facturas-con-clientes');
    setFacturas(res.data);
  }, []);

  const abrirFacturaDesdeOF = async (idfactura) => {
    await recargarFacturas();
    await cargarFacturaPorId(idfactura);
    setOpenOrdenesFijas(false);
  };

  // 🆕 Memoizada: solo se recrea si cambian `facturas` o `defaultEmpaqueId`
  const cargarFacturaPorId = useCallback(
    async (idfactura) => {
      if (!idfactura) return;

      const factura = facturas.find((f) => f.idfactura === Number(idfactura));
      if (!factura) return;

      setFacturaSeleccionada(factura);
      setForm({
        numero_factura: factura.numero_factura || '',
        fecha: factura.fecha?.substring(0, 10) || '',
        fecha_vuelo: factura.fecha_vuelo?.substring(0, 10) || '',
        awb: factura.awb || '',
        hawb: factura.hawb || '',
        idcarguera: factura.idcarguera || '',
        observaciones: factura.observaciones || ''
      });

      try {
        const { data } = await api.get(`/api/facturas/factura-detalle/${idfactura}`);

        // dentro de cargarFacturaPorId, en el map:
        const detallesConResaltado = data.map((item) => {
          const idRes = localStorage.getItem('resaltarMix');
          return {
            ...item,
            // ✅ si viene null/'' lo dejamos en null; si viene "25" lo pasamos a Number
            idempaque:
              item.idempaque == null || item.idempaque === '' ? null : Number(item.idempaque),
            resaltado: idRes ? Number(item.idmix) === Number(idRes) : false
          };
        });

        setDetalles(detallesConResaltado);

        setTimeout(() => {
          const fila = document.querySelector('.fila-mix-resaltada');
          if (fila) fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
          localStorage.removeItem('resaltarMix');
        }, 300);
      } catch (err) {
        console.error('❌ Error al cargar detalle de factura:', err);
      }
    },
    [facturas]
  );

  const handleActualizarCampoEncabezado = useCallback(
    async (campo, valor) => {
      setForm((prev) => ({ ...prev, [campo]: valor }));
      if (!facturaSeleccionada) return;

      try {
        await api.put(`/api/facturas/factura/${facturaSeleccionada.idfactura}`, { campo, valor });

        const res = await api.get(`/api/facturas/facturas-con-clientes`);
        const nuevasFacturas = res.data;
        setFacturas(nuevasFacturas);

        const facturaActualizada = nuevasFacturas.find(
          (f) => f.idfactura === facturaSeleccionada.idfactura
        );
        setFacturaSeleccionada(facturaActualizada);
      } catch (err) {
        console.error(`❌ Error al actualizar ${campo}:`, err);
      }
    },
    [facturaSeleccionada]
  );

  const handleCambioCampo = async (iddetalle, campos) => {
    try {
      await api.put(`/api/facturas/factura-detalle/${iddetalle}`, { campos });
      setDetalles((prev) => prev.map((d) => (d.iddetalle === iddetalle ? { ...d, ...campos } : d)));
    } catch (err) {
      console.error('❌ Error al actualizar campos:', err);
    }
  };

  const handleProcessRowUpdate = async (newRow, oldRow) => {
    // 1) limpiar valores vacíos
    const cleanedRow = Object.fromEntries(
      Object.entries(newRow).filter(([_, v]) => v !== undefined && v !== null && v !== '')
    );

    // 2) detectar cambios directos
    const directChanges = Object.entries(cleanedRow).filter(
      ([k, v]) => String(oldRow[k]) !== String(v)
    );
    const directChangeMap = Object.fromEntries(directChanges);
    const updates = { ...directChangeMap };

    const changedKeys = Object.keys(directChangeMap);

    // 🔑 Campos que SÍ disparan recálculos
    const driverKeys = [
      'piezas',
      'cantidad',
      'cantidadRamos',
      'idempaque',
      'precio_unitario',
      'precio_venta',
      'esramo'
    ];

    const algunDriverCambio = changedKeys.some((k) => driverKeys.includes(k));

    // ⛔ Si NO cambió ningún driver (ej: solo doc_prov, guia_master, etc.):
    // NO recalculamos nada, solo guardamos esos campos.
    if (!algunDriverCambio) {
      if (changedKeys.length > 0 && newRow.iddetalle) {
        await handleCambioCampo(newRow.iddetalle, directChangeMap);
      }
      // devolvemos la fila con solo esos campos actualizados
      return { ...oldRow, ...cleanedRow };
    }

    // 3) ¿mix? ¿primera del mix?
    const mix = oldRow.idmix ?? cleanedRow.idmix ?? null;
    const esMix = !!mix;
    const firstId = esMix ? primerosPorMix?.[mix] : undefined;
    const esPrimera = esMix && Number(oldRow.iddetalle) === Number(firstId);

    // 4) piezas ↔ cantidad (piezas es el driver)
    let piezas = toNum(cleanedRow.piezas ?? oldRow.piezas ?? oldRow.cantidad);
    let cantidad = toNum(cleanedRow.cantidad ?? oldRow.cantidad);

    if ('piezas' in cleanedRow) {
      // editaron piezas → forzar cantidad siguiendo la regla de mix
      cantidad = esMix ? (esPrimera ? piezas : 0) : piezas;
      updates.piezas = piezas;
      updates.cantidad = cantidad;
    } else if ('cantidad' in cleanedRow) {
      // editaron cantidad → reflejar en piezas y aplicar regla
      if (esMix) {
        if (esPrimera) piezas = cantidad;
        else cantidad = 0;
      } else {
        piezas = cantidad;
      }
      updates.cantidad = cantidad;
      updates.piezas = piezas;
    } else {
      // no tocaron piezas/cantidad → asegurar no-primeras del mix queden en 0
      if (esMix && !esPrimera && oldRow.cantidad !== 0) updates.cantidad = 0;
    }
    // 5) recálculo derivados con la "cantidad" final
    const base = {
      cantidadRamos: toNum(cleanedRow.cantidadRamos ?? oldRow.cantidadRamos),
      idempaque: toNum(cleanedRow.idempaque ?? oldRow.idempaque),
      precio_unitario: toNum(cleanedRow.precio_unitario ?? oldRow.precio_unitario),
      precio_venta: toNum(cleanedRow.precio_venta ?? oldRow.precio_venta),
      esramo: cleanedRow.esramo ?? oldRow.esramo
    };
    const { cantidadTallos, tallos, subtotal, subtotalVenta, totalRamos } =
      buildDerivadosConCantidad(base, updates.cantidad ?? oldRow.cantidad, catalogo);

    if (String(oldRow.cantidadTallos) !== String(cantidadTallos))
      updates.cantidadTallos = cantidadTallos;
    if (String(oldRow.tallos) !== String(tallos)) updates.tallos = tallos;
    if (String(oldRow.subtotal) !== String(subtotal)) updates.subtotal = subtotal;
    if (String(oldRow.subtotalVenta) !== String(subtotalVenta))
      updates.subtotalVenta = subtotalVenta;
    if (String(oldRow.totalRamos) !== String(totalRamos)) updates.totalRamos = totalRamos;

    // 6) persistir solo lo que realmente cambió
    const finales = Object.fromEntries(
      Object.entries(updates).filter(([k, v]) => String(oldRow[k]) !== String(v))
    );
    if (Object.keys(finales).length > 0) {
      await handleCambioCampo(newRow.iddetalle, finales); // tu updater al backend
    }

    return { ...oldRow, ...cleanedRow, ...updates };
  };

  const handleAgregarFila = async () => {
    if (!facturaSeleccionada) {
      alert('⚠️ Debes seleccionar una factura primero.');
      return;
    }

    try {
      await api.post('/api/facturas/factura-detalle', {
        idfactura: facturaSeleccionada.idfactura
      });
      await refrescarDetalleFactura();
    } catch (err) {
      console.error('❌ Error al agregar fila:', err);
      alert('❌ No se pudo agregar la fila. Revisa los datos e inténtalo de nuevo.');
    }
  };
  // para suprimir el click simple si hubo doble clic
  const clickTimerRef = useRef(null);

  const duplicarPedido = useCallback(
    async (id) => {
      const seguro = window.confirm(
        `¿Duplicar el pedido P.${id}?\nSe copiará encabezado y detalle.`
      );
      if (!seguro) return;

      const observaciones = window.prompt('Observación para el nuevo pedido:', '') || '';

      try {
        const { data } = await api.post('/api/facturas/duplicar', {
          idfacturaOrigen: id,
          observaciones
        });

        if (data?.ok && data?.idfactura) {
          await recargarFacturas(); // ya lo tienes como useCallback
          await cargarFacturaPorId(data.idfactura); // si puedes, mémoízalo con useCallback
          alert(`✅ Pedido duplicado: P.${data.idfactura}`);
        } else {
          alert('⚠️ No se pudo duplicar (respuesta inesperada).');
        }
      } catch (err) {
        console.error('❌ Error duplicando:', err?.response?.data || err);
        alert(err?.response?.data?.error || '❌ Error al duplicar el pedido');
      }
    },
    [recargarFacturas, cargarFacturaPorId]
  );

  const handleItemClick = useCallback(
    (id) => {
      // si en ~180ms no hubo doble clic, ejecuta el click normal
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        cargarFacturaPorId(id);
        clickTimerRef.current = null;
      }, 180);
    },
    [cargarFacturaPorId]
  );

  const duplicarFilasSeleccionadas = async () => {
    const idfactura = facturaSeleccionada?.idfactura;
    if (!idfactura) {
      alert('⚠️ No hay factura seleccionada');
      return;
    }

    // 1) Pedir cuántas copias por registro
    const entrada = window.prompt(
      '¿Cuántas copias por registro quieres crear? (1 = duplicar)',
      '1'
    );
    if (entrada === null) return; // usuario canceló
    let veces = parseInt(entrada, 10);
    if (isNaN(veces) || veces < 1) veces = 1;

    // Límite de seguridad (ajusta si quieres)
    const MAX = 20;
    if (veces > MAX) {
      const ok = window.confirm(
        `Vas a crear ${veces} copias por línea. ¿Continuar? (máx. sugerido ${MAX})`
      );
      if (!ok) return;
    }

    // 2) Normalizar selección
    const filasSeleccionadas = detalles.filter((r) => seleccionados.includes(r.iddetalle));
    if (filasSeleccionadas.length === 0) {
      alert('Selecciona al menos un registro');
      return;
    }

    // Utilidad segura para números
    const safeNum = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);
    const toNumberOrNull = (v) => (isNaN(parseInt(v)) ? null : parseInt(v));

    try {
      let insertsTotales = 0;

      // 3) Agrupar: MIX (por idmix único) y SÓLIDOS
      const idmixSeleccionados = new Set(
        filasSeleccionadas.map((f) => f.idmix).filter((v) => v !== null && v !== undefined)
      );
      const solidos = filasSeleccionadas.filter((f) => !f.idmix);

      // 3.a) Duplicar MIXES (una vez por idmix, pero "veces" copias cada uno)
      for (const idmix of idmixSeleccionados) {
        // Traer TODO el mix desde el dataset actual (aunque solo hayan seleccionado una fila del mix)
        const registrosMix = detalles.filter((d) => d.idmix === idmix);

        // Ordenar por iddetalle ASC para que la PRIMERA del mix se inserte primero
        const registrosOrdenados = [...registrosMix].sort(
          (a, b) => Number(a.iddetalle) - Number(b.iddetalle)
        );
        const firstId = Number(registrosOrdenados[0]?.iddetalle);

        for (let i = 0; i < veces; i++) {
          // Un nuevo idmix por cada copia
          const { data } = await api.get(`/api/facturas/nuevo-idmix/${idfactura}`);
          const nuevoIdMix = data.nuevoIdMix;

          for (const reg of registrosOrdenados) {
            const esPrimera = Number(reg.iddetalle) === firstId;
            const cantidad = safeNum(reg.cantidad);
            const tallos = cantidad > 0 ? Math.round(safeNum(reg.cantidadTallos) / cantidad) : 0;
            const totalRamos = cantidad * safeNum(reg.cantidadRamos);

            const duplicado = {
              idfactura,
              idmix: nuevoIdMix,
              codigo: reg.codigo || '',
              idgrupo: toNumberOrNull(reg.idgrupo),
              idproveedor: toNumberOrNull(reg.idproveedor),
              idproducto: reg.idproducto,
              idvariedad: reg.idvariedad,
              idlongitud: reg.idlongitud,
              idempaque: reg.idempaque,
              idtipocaja: reg.idtipocaja,
              // Piezas: solo la PRIMERA del mix lleva piezas>0 (o usa cantidad como fallback)
              piezas: esPrimera
                ? typeof toNum === 'function'
                  ? toNum(reg.piezas) || toNum(reg.cantidad)
                  : safeNum(reg.piezas) || safeNum(reg.cantidad)
                : 0,
              cantidad,
              precio_unitario: safeNum(reg.precio_unitario),
              precio_venta: safeNum(reg.precio_venta), // el backend la ignora si no la persiste
              tallos,
              cantidadTallos: safeNum(reg.cantidadTallos),
              cantidadRamos: safeNum(reg.cantidadRamos),
              totalRamos,
              subtotal: safeNum(reg.subtotal),
              subtotalVenta: safeNum(reg.subtotalVenta), // idem
              peso: safeNum(reg.peso),
              documento_proveedor: reg.documento_proveedor || '',
              idusuario: user?.id || null
            };

            await api.post('/api/facturas/factura-detalle', duplicado);
            insertsTotales++;
          }
        }
      }

      // 3.b) Duplicar SÓLIDOS (cada fila "veces" copias)
      for (const fila of solidos) {
        const cantidad = safeNum(fila.cantidad);
        const tallos = cantidad > 0 ? Math.round(safeNum(fila.cantidadTallos) / cantidad) : 0;
        const totalRamos = cantidad * safeNum(fila.cantidadRamos);

        for (let i = 0; i < veces; i++) {
          const duplicado = {
            idfactura,
            idmix: null,
            codigo: fila.codigo || '',
            idgrupo: toNumberOrNull(fila.idgrupo),
            idproveedor: toNumberOrNull(fila.idproveedor),
            idproducto: fila.idproducto,
            idvariedad: fila.idvariedad,
            idlongitud: fila.idlongitud,
            idempaque: fila.idempaque,
            idtipocaja: fila.idtipocaja,
            // Sólida: piezas = piezas || cantidad
            piezas:
              typeof toNum === 'function'
                ? toNum(fila.piezas) || toNum(fila.cantidad)
                : safeNum(fila.piezas) || safeNum(fila.cantidad),
            cantidad,
            precio_unitario: safeNum(fila.precio_unitario),
            precio_venta: safeNum(fila.precio_venta),
            tallos,
            cantidadTallos: safeNum(fila.cantidadTallos),
            cantidadRamos: safeNum(fila.cantidadRamos),
            totalRamos,
            subtotal: safeNum(fila.subtotal),
            subtotalVenta: safeNum(fila.subtotalVenta),
            peso: safeNum(fila.peso),
            documento_proveedor: fila.documento_proveedor || '',
            idusuario: user?.id || null
          };

          await api.post('/api/facturas/factura-detalle', duplicado);
          insertsTotales++;
        }
      }

      alert(
        `✅ Duplicación completada.\nCopias por línea: ${veces}\nRegistros insertados: ${insertsTotales}`
      );
      await refrescarDetalleFactura();
      setSeleccionados([]);
    } catch (err) {
      console.error('❌ Error al duplicar:', err);
      alert('❌ No se pudo duplicar los registros');
    }
  };

  const primerosPorMix = useMemo(() => {
    const map = {};
    (detalles || []).forEach((row) => {
      if (row && row.idmix != null) {
        const mix = Number(row.idmix);
        const id = Number(row.iddetalle);
        if (!map[mix] || id < map[mix]) map[mix] = id;
      }
    });
    return map;
  }, [detalles]);

  const pedidosProceso = useMemo(() => {
    const actual = facturaSeleccionada?.idfactura;
    return facturas
      .filter(
        (f) =>
          String(f.estado).toLowerCase() === 'proceso' &&
          (actual ? Number(f.idfactura) !== Number(actual) : true)
      )
      .sort((a, b) => Number(b.idfactura) - Number(a.idfactura));
  }, [facturas, facturaSeleccionada?.idfactura]);

  const columns = [
    {
      field: 'idmix',
      headerName: 'No.',
      width: 60,
      editable: false,
      align: 'center',
      headerAlign: 'center',
      sortable: false, // ← sin ordenar
      filterable: true,

      renderHeader: () => (
        <Tooltip title="Doble clic en esta columna agrega un registro" arrow placement="top">
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              cursor: 'help'
            }}
          >
            No.<span style={{ marginLeft: 4, fontSize: 12, opacity: 0.75 }}>ⓘ</span>
          </Box>
        </Tooltip>
      ),

      renderCell: (params) => {
        const hint = 'Doble clic aquí agrega un registro';

        if (!params.row.idmix) {
          return (
            <span title={hint} style={{ cursor: 'pointer' }}>
              {String(params.row.iddetalle ?? '')}
            </span>
          );
        }

        const primerId = primerosPorMix[params.row.idmix];
        if (params.row.iddetalle === primerId) {
          return (
            <span title={hint} style={{ cursor: 'pointer' }}>
              {String(params.row.idmix)}
            </span>
          );
        }

        return (
          <span
            title={hint}
            style={{
              backgroundColor: 'white',
              display: 'block',
              width: '100%',
              height: '100%',
              cursor: 'pointer'
            }}
          >
            &nbsp;
          </span>
        );
      }
    },

    {
      field: 'mix',
      headerName: 'Mix',
      width: 60,
      sortable: false,
      filterable: false, // botón/acción: no tiene sentido filtrar
      renderCell: (params) => (
        <button
          className="boton-icono-pequeno"
          onClick={() => handleCrearMix(params.row)}
          title="Editar Mix"
        >
          🧃
        </button>
      )
    },
    {
      field: 'documento_proveedor',
      headerName: 'Doc. Prov.',
      width: 80,
      editable: true,
      tabbable: false,
      sortable: false,
      filterable: true
    },
    {
      field: 'idproveedor',
      headerName: 'Proveedor',
      width: 140,
      type: 'singleSelect',
      valueOptions: proveedores.map((p) => ({ value: p.idtercero, label: p.nombre })),
      editable: true,
      sortable: false,
      filterable: true
    },
    {
      field: 'idproducto',
      headerName: 'Producto',
      width: 100,
      type: 'singleSelect',
      valueOptions: catalogo
        .filter((c) => c.categoria === 'producto')
        .sort((a, b) => a.valor.localeCompare(b.valor, undefined, { sensitivity: 'base' }))
        .map((c) => ({ value: c.id, label: c.valor })),
      editable: true,
      sortable: false,
      filterable: true
    },
    {
      field: 'idvariedad',
      headerName: 'Variedad',
      width: 130,
      type: 'singleSelect',
      valueOptions: catalogo
        .filter((c) => c.categoria === 'variedad')
        .sort((a, b) => a.valor.localeCompare(b.valor, undefined, { sensitivity: 'base' }))
        .map((c) => ({ value: c.id, label: c.valor })),
      editable: true,
      sortable: false,
      filterable: true
    },
    {
      field: 'idlongitud',
      headerName: 'Longitud',
      width: 50,
      type: 'singleSelect',
      valueOptions: catalogo
        .filter((c) => c.categoria === 'longitud')
        .sort((a, b) => Number(a.valor) - Number(b.valor)) // orden numérico
        .map((c) => ({ value: c.id, label: c.valor })),
      editable: true,
      sortable: false,
      filterable: true
    },
    {
      field: 'piezas',
      headerName: 'Piezas',
      width: 60,
      type: 'number',
      editable: true, // la regla real va en isCellEditable
      sortable: false,
      filterable: true,
      renderCell: (params) => {
        const { row, value } = params;
        if (!row.idmix) return String(value ?? 0);
        const firstId = primerosPorMix[row.idmix];
        if (Number(row.iddetalle) === Number(firstId)) return String(value ?? 0);
        return (
          <span style={{ display: 'block', width: '100%', height: '100%', background: '#fff' }}>
            &nbsp;
          </span>
        );
      }
    },
    {
      field: 'idtipocaja',
      headerName: 'Tipo Caja',
      width: 50,
      type: 'singleSelect',
      valueOptions: catalogo
        .filter((c) => c.categoria === 'tipocaja')
        .map((c) => ({ value: c.id, label: c.valor })),
      editable: true,
      sortable: false,
      filterable: true
    },

    {
      field: 'cantidad',
      headerName: 'Cant.',
      width: 50,
      type: 'number',
      editable: false,
      aggregable: true,
      aggregationFunction: 'sum',
      sortable: false,
      filterable: true
    },
    {
      field: 'cantidadRamos',
      headerName: 'Ramos',
      width: 60,
      type: 'number',
      editable: true,
      aggregable: true,
      sortable: false,
      filterable: true
    },

    {
      field: 'idempaque',
      headerName: 'Empaque',
      width: 50,
      type: 'singleSelect',
      valueOptions: catalogo
        .filter((c) => c.categoria === 'empaque')
        .sort((a, b) => Number(a.valor) - Number(b.valor)) // orden numérico por valor
        .map((c) => ({ value: Number(c.id), label: c.valor })),
      editable: true,
      sortable: false,
      filterable: true,
      valueParser: (value) => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      }
    },
    {
      field: 'esramo',
      headerName: 'Es Ramo',
      width: 90,
      sortable: false,
      filterable: false,
      editable: false,
      headerAlign: 'center',
      align: 'center', // centra horizontalmente el contenido de la celda
      aggregable: false, // 👈 explícitamente no agregable
      renderCell: (params) => {
        const row = params.row;

        // 👇 En la fila de totales / agregación no hay iddetalle,
        // así que NO mostramos checkbox ni nada.
        if (!row || row.iddetalle == null) {
          return null;
        }

        const checked = row?.esramo === 1 || row?.esramo === '1' || row?.esramo === true;

        const handleToggle = async (nuevoValor) => {
          // optimista en UI
          const { subtotal, subtotalVenta } = recalcSubtotalesPorFlag({
            ...row,
            esramo: nuevoValor
          });
          setDetalles((prev) =>
            prev.map((r) =>
              r.iddetalle === row.iddetalle
                ? { ...r, esramo: nuevoValor, subtotal, subtotalVenta }
                : r
            )
          );
          try {
            await api.put(`/api/facturas/factura-detalle/${row.iddetalle}`, {
              campos: { esramo: nuevoValor }
            });
          } catch (err) {
            console.error('Error actualizando esramo:', err);
          }
        };

        return (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%'
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={checked}
              onChange={(e) => handleToggle(e.target.checked ? 1 : 0)}
              size="small"
              sx={{ p: 0, m: 0 }} // sin padding/margen
            />
          </Box>
        );
      }
    },

    {
      field: 'precio_unitario',
      headerName: 'P.Compra',
      width: 70,
      type: 'number',
      editable: true,
      sortable: false,
      filterable: true,
      renderCell: (params) => {
        if (params.api.getCellMode(params.id, params.field) === 'edit') return params.value ?? '';
        const value = Number(params.value);
        return !isNaN(value) ? value.toFixed(2) : '';
      }
    },
    {
      field: 'precio_venta',
      headerName: 'P.Venta',
      width: 70,
      type: 'number',
      editable: true,
      sortable: false,
      filterable: true,
      renderCell: (params) => {
        if (params.api.getCellMode(params.id, params.field) === 'edit') return params.value ?? '';
        const v = Number(params.value);
        const unit = Number(params.row?.precio_unitario);
        const sale = Number(params.row?.precio_venta);
        const highlight = !isNaN(unit) && !isNaN(sale) && sale <= unit;
        const text = !isNaN(v) ? v.toFixed(2) : '';
        return (
          <span style={highlight ? { color: '#dc2626', fontWeight: 700 } : undefined}>{text}</span>
        );
      }
    },

    {
      field: 'totalRamos',
      headerName: 'T.Ramos',
      type: 'number',
      editable: false,
      tabbable: false,
      width: 80,
      sortable: false,
      filterable: true
    },

    {
      field: 'cantidadTallos',
      headerName: 'Total Tallos',
      width: 80,
      type: 'number',
      editable: false,
      tabbable: false,
      aggregable: true,
      aggregationFunction: 'sum',
      sortable: false,
      filterable: true
    },

    {
      field: 'subtotal',
      type: 'number',
      headerName: 'Subtotal',
      width: 100,
      editable: false,
      tabbable: false,
      aggregable: true,
      aggregationFunction: 'sum',
      sortable: false,
      filterable: true,
      renderCell: (params) => {
        const value = Number(params.value);
        return !isNaN(value) ? value.toFixed(2) : '';
      }
    },
    {
      field: 'subtotalVenta',
      headerName: 'SubVenta',
      width: 100,
      type: 'number',
      editable: false,
      tabbable: false,
      aggregable: true,
      aggregationFunction: 'sum',
      sortable: false,
      filterable: true,
      renderCell: (params) => {
        const value = Number(params.value);
        return !isNaN(value) ? value.toFixed(2) : '';
      }
    },
    {
      field: 'codigo',
      headerName: 'Mark',
      width: 120,
      editable: true,
      sortable: false,
      filterable: true
    },

    {
      field: 'guia_master',
      headerName: 'Awbh',
      width: 100,
      editable: true,
      sortable: false,
      filterable: true
    },

    {
      field: 'fechacompra',
      headerName: 'Fecha Compra',
      width: 100,
      editable: false,
      tabbable: false,
      sortable: false,
      filterable: true,
      renderCell: (params) => {
        const raw = params.row?.fechacompra ?? params.value;
        if (!raw) return '';

        if (typeof raw === 'string') {
          const m = raw.match(/^\d{4}-\d{2}-\d{2}/);
          return m ? m[0] : raw; // si ya viene como 'YYYY-MM-DD...' lo recorta
        }

        const d = raw instanceof Date ? raw : new Date(raw);
        if (Number.isNaN(d.getTime())) return '';
        return d.toISOString().slice(0, 10); // YYYY-MM-DD
      }
    }
  ];

  const refrescarDetalleFactura = async () => {
    if (!facturaSeleccionada) return;

    try {
      const { data } = await api.get(
        `/api/facturas/factura-detalle/${facturaSeleccionada.idfactura}`
      );

      // Lee una sola vez y usa radix
      const idResaltadoStr = localStorage.getItem('resaltarMix');
      const idResaltado = idResaltadoStr ? Number.parseInt(idResaltadoStr, 10) : null;

      const detallesConResaltado = data.map((item) => ({
        ...item,
        // compara solo si existe idResaltado
        resaltado: idResaltado !== null && Number(item.idmix) === idResaltado
      }));

      localStorage.removeItem('resaltarMix');
      setDetalles(detallesConResaltado);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('❌ Error al refrescar detalles:', err);
    }
  };

  // Formatea mensajes de “duplicado” reemplazando #id por nombre(s)
  const prettyDupError = useCallback(
    (err) => {
      const data = err?.response?.data || {};
      let msg = String(data.error || err?.message || 'Error al finalizar la factura.');

      // ¿Parece un duplicado?
      const esDup = /duplic/i.test(msg) || /ya existe/i.test(msg) || /mismo proveedor/i.test(msg);
      if (!esDup) {
        if (!msg.startsWith('⚠️') && !msg.startsWith('❌')) msg = `❌ ${msg}`;
        return msg;
      }

      // Junta posibles listas de IDs que pueda enviar el backend
      let ids = [];
      if (data.idproveedor) ids.push(String(data.idproveedor));
      if (Array.isArray(data.proveedores_conflicto))
        ids.push(...data.proveedores_conflicto.map(String));
      if (Array.isArray(data.proveedores)) ids.push(...data.proveedores.map(String));
      if (Array.isArray(data.ids_proveedor)) ids.push(...data.ids_proveedor.map(String));
      ids = [...new Set(ids)];

      // Si tenemos ids en el payload, reemplaza cada uno
      if (ids.length) {
        ids.forEach((id) => {
          const nom = provMap.get(String(id));
          if (!nom) return;
          // "proveedor #2" / "proveedores 2" / "proveedores: 2,5"
          msg = msg.replace(
            new RegExp(`(proveedores?[^\\d#]*)(?=\\b${id}\\b)`, 'ig'),
            (full) => full
          ); // conserva el prefijo
          msg = msg.replace(
            new RegExp(`(proveedores?\\s*(?:#|nro\\.?|no\\.?|)\\s*)(\\b${id}\\b)`, 'ig'),
            (full, pre) => `${pre}${nom}`
          );
          // "#2" suelto
          msg = msg.replace(new RegExp(`#\\s*${id}\\b`, 'g'), nom);
        });
      }

      // Reemplazos genéricos por si el backend no mandó arrays de ids:
      // “proveedor 2”, “proveedores 2, 5”, “proveedor #7”, etc.
      msg = msg.replace(
        /(proveedores?\s*(?:#|nro\.?|no\.?)?\s*)(\d+(?:\s*,\s*\d+)*)/gi,
        (full, pre, list) => {
          const names = list.split(/\s*,\s*/).map((id) => provMap.get(String(id)) || id);
          return `${pre}${names.join(', ')}`;
        }
      );
      msg = msg.replace(/(proveedor\s*(?:#|nro\.?|no\.?)?\s*)(\d+)/gi, (full, pre, id) => {
        const nom = provMap.get(String(id));
        return nom ? `${pre}${nom}` : full;
      });

      if (!msg.startsWith('⚠️') && !msg.startsWith('❌')) msg = `⚠️ ${msg}`;
      return msg;
    },
    [provMap]
  );

  const marcarFacturaComoLista = async () => {
    if (!facturaSeleccionada) return;

    const confirmacion = window.confirm(
      `⚠️ Al finalizar esta factura se generarán automáticamente:\n\n- las carteras,\n- proveedores y clientes.\n\n¿Estás seguro de continuar?`
    );

    if (!confirmacion) return;

    try {
      setGuardandoFactura(true);
      await api.put(`/api/facturas/finalizar/${facturaSeleccionada.idfactura}`);
      alert('✅ Factura marcada como lista, pedidos eliminados y cartera generada correctamente.');

      const res = await api.get(`/api/facturas/facturas-con-clientes`);
      setFacturas(res.data);

      const actualizada = res.data.find((f) => f.idfactura === facturaSeleccionada.idfactura);
      setFacturaSeleccionada(actualizada);
    } catch (err) {
      console.error('❌ Error al finalizar factura:', err);
      const mensajeError = prettyDupError(err);
      alert(mensajeError);
    } finally {
      setGuardandoFactura(false);
    }
  };

  // 👆 Click en el botón "Finalizar"
  const handleClickFinalizar = async () => {
    if (!facturaSeleccionada) {
      alert('Selecciona una factura.');
      return;
    }

    // 1) Si YA tiene número de factura, solo ejecutamos la lógica actual
    const yaTieneNumero =
      facturaSeleccionada.numero_factura != null &&
      String(facturaSeleccionada.numero_factura).trim() !== '';

    if (yaTieneNumero) {
      await marcarFacturaComoLista();
      return;
    }

    // 2) Si NO tiene número, abrimos el modal y pedimos el consecutivo
    try {
      setNumeroFacturaError('');
      setCargandoNumeroFactura(true);

      const { data } = await api.get('/api/facturas/max-numero');
      const max = Number(data?.max || 0);
      const sugerido = String((Number.isFinite(max) ? max : 0) + 1 || 1);

      setNumeroFacturaInput(sugerido);
      setModalNumeroFacturaVisible(true);
    } catch (err) {
      console.error('❌ Error obteniendo max-numero:', err);
      alert('❌ No se pudo obtener el número de factura sugerido');
    } finally {
      setCargandoNumeroFactura(false);
    }
  };

  // ✅ Guardar número + finalizar
  const handleConfirmarNumeroYFinalizar = async () => {
    if (!facturaSeleccionada) {
      setNumeroFacturaError('No hay factura seleccionada');
      return;
    }

    const valor = (numeroFacturaInput || '').trim();
    if (!valor) {
      setNumeroFacturaError('Ingresa el número de factura');
      return;
    }

    try {
      setNumeroFacturaError('');
      setCargandoNumeroFactura(true);

      // 1) Asignar el número de factura en el encabezado
      //    (el backend valida que no esté repetido)
      await api.put(`/api/facturas/factura/${facturaSeleccionada.idfactura}`, {
        campo: 'numero_factura',
        valor
      });

      // Actualizar el estado local
      setForm((prev) => ({ ...prev, numero_factura: valor }));
      setFacturaSeleccionada((prev) => (prev ? { ...prev, numero_factura: valor } : prev));

      // 2) Ejecutar la lógica de finalizar (con confirm)
      await marcarFacturaComoLista();

      // Cerrar modal si todo fue bien
      setModalNumeroFacturaVisible(false);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;

      console.error('❌ Error asignando número de factura:', err);
      if (msg && msg.toLowerCase().includes('ya existe')) {
        // mensaje claro cuando el número ya existe
        setNumeroFacturaError(msg);
      } else {
        setNumeroFacturaError('No se pudo asignar el número de factura');
      }
    } finally {
      setCargandoNumeroFactura(false);
    }
  };

  const abrirModalDividir = () => {
    if (seleccionados.length !== 1) {
      alert('⚠️ Debes seleccionar un solo registro para dividir.');
      return;
    }

    const seleccionado = detalles.find((r) => r.iddetalle === seleccionados[0]);
    if (!seleccionado) {
      alert('⚠️ Registro no encontrado.');
      return;
    }

    if (seleccionado.cantidad <= 1) {
      alert('⚠️ El registro debe tener más de 1 caja para poder dividir.');
      return;
    }

    setRegistroADividir(seleccionado);
    setCantidadDividir(1);
    setModalDividirVisible(true);
  };

  const handleConfirmarDivision = async () => {
    if (!user?.id) {
      alert('❌ No se encontró el usuario logueado. Por favor vuelve a iniciar sesión.');
      return;
    }

    if (
      !registroADividir ||
      isNaN(cantidadDividir) ||
      cantidadDividir < 1 ||
      cantidadDividir >= registroADividir.cantidad
    ) {
      alert('❌ La cantidad a dividir debe ser mayor a 0 y menor a la cantidad actual.');
      return;
    }

    try {
      await api.post('/api/facturas/dividir-registro', {
        iddetalle: registroADividir.iddetalle,
        cantidadDividir,
        idusuario: user.id
      });

      await refrescarDetalleFactura();
      setSeleccionados([]);

      setTimeout(() => {
        setDetalles((prev) => prev.map((d) => ({ ...d, resaltado: false })));
      }, 3000);

      alert('✅ Registro dividido correctamente.');
    } catch (err) {
      console.error('❌ Error al dividir:', err);
      alert(err?.response?.data?.error || '❌ Error al dividir el registro');
    }

    setModalDividirVisible(false);
    setRegistroADividir(null);
    setCantidadDividir(1);
    setSeleccionados([]);
  };

  const handleEliminarSeleccionados = async () => {
    // 🔐 Asegurarnos de tener factura seleccionada
    if (!facturaSeleccionada?.idfactura) {
      alert('❌ No hay factura seleccionada. No se puede eliminar el detalle.');
      return;
    }

    // 1) Tomar primero los ids desde tu estado (si lo usas)
    let ids = Array.isArray(seleccionados) ? seleccionados.map(Number) : [];

    // 2) Si el estado está vacío, leer la selección del grid
    if (!ids.length) {
      const grid = gridApiRef.current;
      if (!grid) return alert('⚠️ Tabla no disponible.');
      if (grid.getSelectedRows) {
        ids = Array.from(grid.getSelectedRows().keys()).map(Number);
      }
    }

    if (!ids.length) return alert('⚠️ No hay registros seleccionados.');

    const ok = window.confirm(
      `⚠️ Estás por eliminar ${ids.length} registro(s). ¿Seguro que deseas continuar?`
    );
    if (!ok) return;

    try {
      await api.post('/api/facturas/eliminar-multiples', {
        ids,
        idfactura: facturaSeleccionada.idfactura // 👈 AQUÍ VA LA FACTURA
      });

      alert('✅ Registros eliminados correctamente.');
      setSeleccionados([]); // limpia selección local
      await refrescarDetalleFactura(); // recarga grilla
    } catch (err) {
      console.error('❌ Error al eliminar:', err);
      alert('❌ Error al eliminar los registros.');
    }
  };

  const abrirModalTrasladar = async () => {
    if (seleccionados.length === 0) {
      alert('⚠️ Selecciona al menos un registro.');
      return;
    }
    try {
      const res = await api.get('/api/facturas/facturas-con-clientes');
      setFacturas(res.data);
    } catch (e) {
      console.warn('No se pudo refrescar la lista de pedidos. Se usa la lista en memoria.');
    }
    setPedidoDestino('');
    setModalTrasladarVisible(true);
  };

  const confirmarTraslado = async () => {
    if (!pedidoDestino) {
      alert('⚠️ Debes seleccionar el pedido destino.');
      return;
    }
    const actual = facturaSeleccionada?.idfactura;
    if (actual && Number(pedidoDestino) === Number(actual)) {
      alert('⚠️ Debes elegir un pedido diferente al actual.');
      return;
    }

    setCargandoTraslado(true);
    try {
      for (const iddetalle of seleccionados) {
        await api.put(`/api/facturas/factura-detalle/${iddetalle}`, {
          campos: { idfactura: Number(pedidoDestino) }
        });
      }
      alert(`✅ ${seleccionados.length} registro(s) trasladado(s) correctamente.`);
      await refrescarDetalleFactura();
      setSeleccionados([]);
      setModalTrasladarVisible(false);
    } catch (err) {
      console.error('❌ Error al trasladar:', err);
      alert('❌ Ocurrió un error al trasladar los registros.');
    } finally {
      setCargandoTraslado(false);
    }
  };

  // 🧭 Opciones de pedidos con filtro (ordenados por fecha ascendente)
  const itemsPedidos = useMemo(() => {
    const ordenadas = [...facturas].sort((a, b) => {
      const fa = (a.fecha || '').slice(0, 10); // YYYY-MM-DD
      const fb = (b.fecha || '').slice(0, 10);

      // Manejo de vacíos: los sin fecha se van al final
      if (!fa && !fb) return 0;
      if (!fa) return 1;
      if (!fb) return -1;

      // Como está en formato YYYY-MM-DD, el localeCompare sirve para ordenar ascendente
      const cmp = fa.localeCompare(fb);
      if (cmp !== 0) return cmp;

      // desempate opcional por idfactura
      return Number(a.idfactura) - Number(b.idfactura);
    });

    return ordenadas.map(mapPedido);
  }, [facturas, mapPedido]);

  const pedidosFiltrados = useMemo(() => {
    const q = busquedaPedido.trim().toLowerCase();
    return q ? itemsPedidos.filter((it) => it.search.includes(q)) : itemsPedidos;
  }, [itemsPedidos, busquedaPedido]);

  // ref para manejar "deltas" sin perder selección
  const selRef = useRef(new Set());

  const handleRowSelectionChange = (next) => {
    // 1) DataGrid v5/v6: array de ids
    if (Array.isArray(next)) {
      const arr = next.map(Number);
      selRef.current = new Set(arr);
      setSeleccionados(arr);
      return;
    }

    // 2) { ids: Set|Array }
    if (next && typeof next === 'object' && next.ids) {
      const ids = next.ids instanceof Set ? Array.from(next.ids) : next.ids;
      const arr = ids.map(Number);
      selRef.current = new Set(arr);
      setSeleccionados(arr);
      return;
    }

    // 3) deltas { added, removed }
    if (next && typeof next === 'object' && (next.added || next.removed)) {
      const cur = new Set(selRef.current);
      (next.added || []).forEach((id) => cur.add(Number(id)));
      (next.removed || []).forEach((id) => cur.delete(Number(id)));
      selRef.current = cur;
      setSeleccionados([...cur]);
      return;
    }

    // 4) fallback: limpiar
    selRef.current = new Set();
    setSeleccionados([]);
  };

  // Mapa id -> código (FB/QB/HB/EB) desde catálogo
  const tipoCajaMap = useMemo(() => {
    const m = {};
    (catalogo || [])
      .filter((c) => c.categoria === 'tipocaja')
      .forEach((c) => (m[c.id] = String(c.valor || '').toUpperCase()));
    return m;
  }, [catalogo]);

  // Totales basados en filas FILTRADAS (todas, no solo las visibles en viewport)
  const [totalesCaja, setTotalesCaja] = useState({
    FB: 0,
    HB: 0,
    QB: 0,
    EB: 0,
    SB: 0, // 👈 NUEVO
    OTROS: 0,
    fullEq: 0,
    totalPiezas: 0
  });

  const recomputeTotalesCaja = useCallback(() => {
    const api = gridApiRef.current;
    let rows = [];

    // 1) ids después de filtros/orden/paginación
    try {
      // Asegúrate de tener importado:
      // import { gridFilteredSortedRowIdsSelector } from '@mui/x-data-grid-premium';
      const ids = gridFilteredSortedRowIdsSelector(gridApiRef); // apiRef (no .current)
      if (Array.isArray(ids) && ids.length && api?.getRow) {
        rows = ids.map((id) => api.getRow(id)).filter(Boolean);
      } else if (api?.getVisibleRowModels) {
        rows = Array.from(api.getVisibleRowModels().values());
      } else {
        rows = detalles;
      }
    } catch {
      // fallback para versiones sin selector
      if (api?.getVisibleRowModels) {
        rows = Array.from(api.getVisibleRowModels().values());
      } else {
        rows = detalles;
      }
    }

    // 2) sumarización
    const acc = {
      FB: 0,
      HB: 0,
      QB: 0,
      EB: 0,
      SB: 0,
      OTROS: 0,
      fullEq: 0,
      totalPiezas: 0
    };

    for (const r of rows) {
      const piezas = Number(r?.piezas || 0);
      if (!piezas) continue; // en mix solo la 1ª lleva piezas

      const raw =
        r?.tipocaja ||
        r?.tipo_caja_variedad ||
        r?.tipoCaja ||
        r?.TipoCaja ||
        tipoCajaMap[r?.idtipocaja] ||
        '';
      const code = String(raw).toUpperCase();

      let t = 'OTROS';
      if (code.includes('FULL') || code === 'FB') t = 'FB';
      else if (code.includes('HALF') || code === 'HB') t = 'HB';
      else if (code.includes('QUARTER') || code === 'QB') t = 'QB';
      else if (code.includes('EIGHTH') || code === 'EB') t = 'EB';
      else if (code === 'SB') t = 'SB';

      acc[t] += piezas;
    }

    acc.totalPiezas = acc.FB + acc.HB + acc.QB + acc.EB + acc.SB + acc.OTROS;
    acc.fullEq = acc.FB + acc.HB * 0.5 + acc.QB * 0.25 + acc.EB * 0.125 + acc.SB * 0.0625;

    setTotalesCaja(acc);
  }, [gridApiRef, detalles, tipoCajaMap]);

  // ✅ Coalescador para evitar demasiados recomputes seguidos desde eventos del grid
  const rafIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (rafIdRef) cancelAnimationFrame(rafIdRef);
    };
  }, []);

  // Recalcular cuando cambien datos o filtros controlados
  useEffect(() => {
    recomputeTotalesCaja();
  }, [recomputeTotalesCaja, filterModel, detalles, tipoCajaMap]);

  return (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'hidden' }}>
      {/* 📋 Pedidos (listbox) */}
      <Box
        sx={{
          width: 280,
          maxWidth: 320,
          minWidth: 260,
          flexShrink: 0,
          mt: 2,
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 95px)' // ajusta 180 si quieres más/menos alto
        }}
      >
        <Typography variant="h6">📋 Pedidos</Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Buscar (fecha, pedido, factura, cliente)..."
          value={busquedaPedido}
          onChange={(e) => setBusquedaPedido(e.target.value)}
          sx={{ mb: 1 }}
        />

        <Box
          role="listbox"
          aria-label="Lista de pedidos"
          sx={{
            flex: 1,
            minHeight: 0, // ⬅️ CRÍTICO: permite que el flex-child tenga scroll interno
            overflowY: 'auto',
            border: '1px solid #ccc',
            borderRadius: 1,
            p: 0.5,
            backgroundColor: '#fff'
          }}
        >
          {pedidosFiltrados.map((it) => {
            const selected = String(it.id) === String(facturaSeleccionada?.idfactura || '');
            return (
              <Box
                key={it.id}
                role="option"
                aria-selected={selected}
                onClick={() => handleItemClick(it.id)} // ← solo click simple
                sx={{
                  p: 1,
                  borderBottom: '1px solid #eee',
                  cursor: 'pointer',
                  bgcolor: selected ? '#eef2ff' : 'transparent',
                  '&:hover': { backgroundColor: selected ? '#e0e7ff' : '#f5f5f5' }
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong
                    style={{
                      fontSize: 13,
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {it.title}
                  </strong>
                  <span
                    style={{
                      fontSize: 12,
                      color: '#6b7280',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {it.subtitle}
                  </span>
                </div>
              </Box>
            );
          })}

          {pedidosFiltrados.length === 0 && (
            <Box sx={{ p: 1, color: '#6b7280' }}>Sin resultados…</Box>
          )}
        </Box>
      </Box>

      {/* ▶️ Panel derecho: toolbar + grilla */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <h3>🧾 Consulta y edición de Factura</h3>

        <div className="form-card" style={{ paddingTop: '0.5rem', minWidth: 0 }}>
          <div
            className="form-toolbar"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.5rem',
              justifyContent: 'flex-start',
              padding: '0.5rem 0'
            }}
          >
            {facturaSeleccionada && (
              <>
                <input
                  type="text"
                  value={form.numero_factura || ''}
                  readOnly
                  style={{ display: 'none' }}
                />
                <TextField
                  label="Fecha"
                  type="date"
                  value={form.fecha || ''}
                  onChange={(e) => handleActualizarCampoEncabezado('fecha', e.target.value)}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />

                <TextField
                  label="Fecha vuelo"
                  type="date"
                  value={form.fecha_vuelo || ''}
                  onChange={(e) => handleActualizarCampoEncabezado('fecha_vuelo', e.target.value)}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />

                <input
                  placeholder="000-0000-0000"
                  inputMode="numeric"
                  maxLength={13} // 11 dígitos + 2 guiones
                  value={formatAWB(form.awb)} // siempre muestra formateado
                  onChange={(e) => {
                    const next = formatAWB(e.target.value);
                    // actualiza estado + persiste al backend con el valor formateado
                    handleActualizarCampoEncabezado('awb', next);
                  }}
                />
                <select
                  value={form.idcarguera}
                  onChange={(e) => handleActualizarCampoEncabezado('idcarguera', e.target.value)}
                >
                  <option value="">-- Carguera --</option>
                  {catalogo
                    .filter((c) => c.categoria === 'carguera')
                    .sort((a, b) => a.valor.localeCompare(b.valor)) // orden alfabético
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.valor}
                      </option>
                    ))}
                </select>

                <input
                  placeholder="Observaciones"
                  value={form.observaciones || ''}
                  onChange={(e) => handleActualizarCampoEncabezado('observaciones', e.target.value)}
                  style={{ minWidth: 260 }}
                />

                {/* ÚNICO botón arriba para duplicar el pedido actual */}
                <button
                  onClick={() =>
                    facturaSeleccionada && duplicarPedido(facturaSeleccionada.idfactura)
                  }
                  disabled={!facturaSeleccionada}
                  title="Duplicar pedido actual"
                  className="btn"
                >
                  📋 Copiar pedido
                </button>

                {user?.permisos?.includes('asignar_documento_proveedor') && (
                  <button
                    onClick={() => setModalDocumentoProveedorVisible(true)}
                    disabled={seleccionados.length === 0}
                    className="btn btn-primary"
                  >
                    🧾 Fac.Proveedor
                  </button>
                )}

                {user?.permisos?.includes('trasladar_registros') && (
                  <button
                    onClick={abrirModalTrasladar}
                    disabled={seleccionados.length === 0}
                    title="Trasladar los registros seleccionados a otro pedido en proceso"
                  >
                    🔁 Trasladar
                  </button>
                )}

                {user?.permisos?.includes('eliminar_registros_factura') && (
                  <button
                    className="btn-eliminar"
                    onClick={handleEliminarSeleccionados}
                    disabled={seleccionados.length === 0}
                    title="Eliminar los registros seleccionados de la factura"
                  >
                    🗑️ Eliminar
                  </button>
                )}

                {user?.permisos?.includes('asignar_etiquetas') && (
                  <button onClick={() => setModalEtiquetaAbierto(true)}>🏷️ Label</button>
                )}

                {user?.permisos?.includes('agregar_filas_factura') && (
                  <button type="button" className="btn-add" onClick={handleAgregarFila}>
                    ➕ Agregar
                  </button>
                )}
                {user?.permisos?.includes('duplicar_filas_factura') && (
                  <button
                    onClick={duplicarFilasSeleccionadas}
                    disabled={seleccionados.length === 0}
                  >
                    🧬 Duplicar
                  </button>
                )}

                {user?.permisos?.includes('dividir_registro') && (
                  <button className="btn btn-warning" onClick={abrirModalDividir}>
                    🪓 Dividir
                  </button>
                )}

                <button
                  onClick={() => setMostrarCoordinaciones(true)}
                  disabled={!idfacturaActual || seleccionados.length === 0}
                  title="Generar y enviar coordinaciones por finca usando los registros seleccionados"
                >
                  🚚 Logística
                </button>

                <button
                  onClick={() => setOpenOrdenesFijas(true)}
                  disabled={!facturaSeleccionada}
                  title="Órdenes fijas (programar / subir)"
                >
                  ✅ Órdenes fijas
                </button>
                {user?.permisos?.includes('generar_ordenes') && (
                  <button
                    onClick={() => {
                      if (!form.idcarguera) {
                        alert(
                          '❌ Por favor selecciona la Agencia de Carga antes de generar órdenes.'
                        );
                        return;
                      }
                      setModalOrdenVisible(true);
                    }}
                  >
                    🧾 Invoice
                  </button>
                )}
                {user?.permisos?.includes('ver_reporte_codigo') && (
                  <button onClick={() => setModalReporteCodigoVisible(true)}>🧾 Mark</button>
                )}
                {user?.permisos?.includes('guardar_factura') && (
                  <button
                    className="btn-principal"
                    onClick={handleClickFinalizar}
                    disabled={facturaSeleccionada?.estado === 'listo' || guardandoFactura}
                  >
                    {guardandoFactura ? '⏳ Guardando…' : '💾 Finalizar'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {detalles.length > 0 && (
          <Box
            sx={{
              height: 'calc(100vh - 240px)',
              width: '100%',
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1,
                mb: 1,
                bgcolor: '#f8fafc',
                border: '1px solid #e5e7eb',
                borderRadius: 1,
                flexWrap: 'wrap'
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Totales cajas:
              </Typography>

              <span>
                FB: <b>{totalesCaja.fullEq.toFixed(2)}</b>
              </span>
              <span>
                HB: <b>{totalesCaja.HB}</b>
              </span>
              <span>
                QB: <b>{totalesCaja.QB}</b>
              </span>
              <span>
                EB: <b>{totalesCaja.EB}</b>
              </span>
              <span>
                SB: <b>{totalesCaja.SB}</b>
              </span>
              {totalesCaja.OTROS > 0 && (
                <span>
                  Otros: <b>{totalesCaja.OTROS}</b>
                </span>
              )}
            </Box>
            <DataGridPremium
              localeText={esES.components.MuiDataGrid.defaultProps.localeText}
              apiRef={gridApiRef}
              rows={detalles}
              columns={columns}
              filterModel={filterModel}
              onFilterModelChange={(m) => {
                setFilterModel(m);
                requestAnimationFrame(recomputeTotalesCaja);
              }}
              onSortModelChange={() => requestAnimationFrame(recomputeTotalesCaja)}
              onCellKeyDown={handleTabInsideGrid}
              onRowClick={(params) => setSelectedRow(params.row)}
              onCellEditStop={handleEditStopEnterMoveRight}
              checkboxSelection
              disableRowSelectionOnClick
              getRowId={(row) => row.iddetalle}
              getRowClassName={(params) => (params.row.idmix ? 'fila-mix' : '')}
              processRowUpdate={handleProcessRowUpdate}
              onRowSelectionModelChange={handleRowSelectionChange}
              isRowSelectable={() => true}
              isCellEditable={(params) => {
                if (params.field === 'cantidad') return !params.row.idmix;
                if (params.field === 'piezas') {
                  if (!params.row.idmix) return true;
                  const primerId = primerosPorMix[params.row.idmix];
                  return Number(params.row.iddetalle) === Number(primerId);
                }
                return true;
              }}
              density="compact"
              headerHeight={38}
              rowHeight={38}
              rowBuffer={1}
              virtualization
              showToolbar
              disableAggregation={false}
              aggregationModel={{
                piezas: 'sum',
                cantidad: 'sum',
                totalRamos: 'sum',
                cantidadTallos: 'sum',
                subtotal: 'sum',
                subtotalVenta: 'sum',
                peso: 'sum'
              }}
              initialState={{
                columns: {
                  columnVisibilityModel: {
                    mix: false,
                    cantidad: false
                  }
                },
                aggregation: {
                  model: {
                    piezas: 'sum',
                    cantidad: 'sum',
                    cantidadRamos: 'sum',
                    totalRamos: 'sum',
                    cantidadTallos: 'sum',
                    subtotal: 'sum',
                    subtotalVenta: 'sum',
                    peso: 'sum'
                  }
                }
              }}
              sx={{
                '& .MuiDataGrid-cell': { borderRight: '1px solid #ccc' },
                '& .MuiDataGrid-footerContainer': { fontWeight: 'bold' },
                '&.MuiDataGrid-root': { overflow: 'hidden' },
                '& .MuiDataGrid-main': { overflowX: 'auto' },
                '& .MuiDataGrid-virtualScroller': { overflowX: 'auto' }
              }}
            />
            <Tooltip title="Recargar detalle">
              <span>
                <IconButton
                  onClick={recargarDetalle}
                  disabled={reloadingDetalle}
                  aria-label="Recargar detalle"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    bgcolor: '#fff',
                    border: '1px solid #e5e7eb',
                    boxShadow: 1,
                    '&:hover': { bgcolor: '#f9fafb' }
                  }}
                >
                  {reloadingDetalle ? (
                    <CircularProgress size={18} />
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4 7.58 4 4.01 7.58 4.01 12S7.58 20 12 20c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                    </svg>
                  )}
                </IconButton>
              </span>
            </Tooltip>{' '}
          </Box>
        )}
      </Box>
      {modalVisible && (
        <div className="modal-overlay">
          <ModalCajaMixta
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
            detalleOriginal={detalleSeleccionado}
            refrescar={refrescarDetalleFactura}
            modoEdicion={modoEdicionMix}
            idmix={idmixEditar}
          />
        </div>
      )}

      {modalOrdenVisible && (
        <div className="modal-overlay">
          <div className="modal orden-compra">
            <ModalOrdenCompra
              idfactura={facturaSeleccionada?.idfactura}
              onClose={() => setModalOrdenVisible(false)}
            />
          </div>
        </div>
      )}

      {modalEtiquetaAbierto && (
        <ModalAsignarEtiqueta
          idfactura={facturaSeleccionada?.idfactura}
          open={modalEtiquetaAbierto}
          onClose={() => setModalEtiquetaAbierto(false)}
          onAsignado={refrescarDetalleFactura}
        />
      )}

      {modalDividirVisible && (
        <div className="modal-overlay">
          <div className="modal">
            <h4>Dividir registro de factura</h4>
            <p>
              Cantidad actual: <strong>{registroADividir?.cantidad}</strong>
            </p>
            <label>¿Cuántas cajas deseas mover al nuevo registro?</label>
            <input
              type="number"
              className="login-input"
              min={1}
              max={registroADividir?.cantidad - 1}
              value={cantidadDividir}
              onChange={(e) => setCantidadDividir(Number(e.target.value))}
            />
            <div className="modal-buttons">
              <button className="btn btn-primary" onClick={handleConfirmarDivision}>
                Confirmar
              </button>
              <button className="btn btn-secondary" onClick={() => setModalDividirVisible(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalDocumentoProveedorVisible && (
        <div className="modal-overlay">
          <div className="modal">
            <h4>Asignar valores a los registros seleccionados</h4>
            <p>Estos valores se asignarán a todos los registros seleccionados…</p>

            {/* Documento del proveedor */}
            <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <span>Documento del Proveedor</span>
              <input
                type="text"
                value={nuevoDocumentoProveedor}
                onChange={(e) => setNuevoDocumentoProveedor(e.target.value)}
                placeholder="Ej: FAC-12345 o ABC9876"
                className="login-input"
              />
            </label>

            {/* Fecha de compra -> fechacompra */}
            <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <span>Fecha de compra</span>
              <input
                type="date"
                value={nuevaFechaCompra}
                onChange={(e) => setNuevaFechaCompra(e.target.value)}
                className="login-input"
              />
            </label>

            <div className="modal-buttons" style={{ marginTop: 12 }}>
              <button
                className="btn"
                onClick={() => {
                  setModalDocumentoProveedorVisible(false);
                  setNuevoDocumentoProveedor('');
                  setNuevaFechaCompra('');
                }}
              >
                Cancelar
              </button>

              <button
                className="btn btn-primary"
                disabled={
                  !(
                    seleccionados.length > 0 &&
                    (nuevoDocumentoProveedor || '').trim() &&
                    (nuevaFechaCompra || '').trim()
                  )
                }
                onClick={async () => {
                  try {
                    const payload = {
                      ids: seleccionados, // iddetalle[]
                      documento_proveedor: (nuevoDocumentoProveedor || '').trim(),
                      fechacompra: (nuevaFechaCompra || '').trim() // 'YYYY-MM-DD'
                    };

                    await api.post('/api/facturas/asignar-documento-proveedor', payload);

                    alert('✅ Valores asignados correctamente');
                    await refrescarDetalleFactura();
                    setSeleccionados([]);
                    setNuevoDocumentoProveedor('');
                    setNuevaFechaCompra('');
                    setModalDocumentoProveedorVisible(false);
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(
                      '❌ Error al asignar valores:',
                      err?.response?.data || err.message
                    );
                    alert('❌ Ocurrió un error al guardar');
                  }
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalReporteCodigoVisible && (
        <ModalReporteCodigo
          idfactura={facturaSeleccionada?.idfactura}
          onClose={() => setModalReporteCodigoVisible(false)}
        />
      )}

      {modalTrasladarVisible && (
        <div className="modal-overlay">
          <div className="modal">
            <h4>🔁 Trasladar / Copiar registros seleccionados</h4>
            <p>
              Registros seleccionados: <strong>{seleccionados.length}</strong>
            </p>

            <label>¿A qué pedido en proceso deseas enviar los registros?</label>
            <select
              className="login-input"
              value={pedidoDestino}
              onChange={(e) => setPedidoDestino(e.target.value)}
            >
              <option value="">-- Selecciona un Pedido (estado: proceso) --</option>

              {pedidosProceso.map((f) => {
                const fecha = (f.fecha || '').slice(0, 10);
                const p = Number(f.idfactura);
                const fac =
                  f.numero_factura !== undefined &&
                  f.numero_factura !== null &&
                  String(f.numero_factura).trim() !== ''
                    ? Number(f.numero_factura)
                    : '-';
                const label = `${fecha} · P.${isNaN(p) ? '-' : p} · F.${fac} — ${f.cliente || ''}`;

                return (
                  <option key={f.idfactura} value={f.idfactura}>
                    {label}
                  </option>
                );
              })}
            </select>

            {pedidosProceso.length === 0 && (
              <p style={{ marginTop: 8, color: '#b00' }}>
                No hay otros pedidos en estado <b>proceso</b> para enviar.
              </p>
            )}

            <div
              className="modal-buttons"
              style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
            >
              <button className="btn btn-secondary" onClick={() => setModalTrasladarVisible(false)}>
                Cancelar
              </button>

              {/* ✅ Nuevo botón: COPIAR */}
              <button
                className="btn btn-success"
                onClick={confirmarCopiado}
                disabled={!pedidoDestino || cargandoCopiado || pedidosProceso.length === 0}
                title={!pedidoDestino ? 'Selecciona el pedido destino' : ''}
              >
                {cargandoCopiado ? 'Copiando...' : 'Copiar al destino'}
              </button>

              {/* Botón existente: TRASLADAR */}
              <button
                className="btn btn-primary"
                onClick={confirmarTraslado}
                disabled={!pedidoDestino || cargandoTraslado || pedidosProceso.length === 0}
                title={!pedidoDestino ? 'Selecciona el pedido destino' : ''}
              >
                {cargandoTraslado ? 'Trasladando...' : 'Confirmar traslado'}
              </button>
            </div>

            <small style={{ display: 'block', marginTop: 8, color: '#6b7280' }}>
              <b>Copiar</b> duplica y deja los originales en el pedido actual. <b>Trasladar</b>{' '}
              mueve y quita del pedido actual.
            </small>
          </div>
        </div>
      )}

      {openOrdenesFijas && (
        <OrdenesFijasHubModal
          open={openOrdenesFijas}
          onClose={() => setOpenOrdenesFijas(false)}
          // ids de factura_consolidada_detalle seleccionados en tu tabla
          selectedDetalleIds={seleccionados}
          // valores por defecto para crear plantillas desde la factura actual
          defaultCliente={facturaSeleccionada?.Idcliente || facturaSeleccionada?.idcliente || ''}
          defaultCarguera={form?.idcarguera || ''}
          // cuando “programar” termina bien
          onProgramarSuccess={() => {
            setOpenOrdenesFijas(false);
          }}
          // cuando “subir programadas” genera encabezados de pedidos
          onSubirSuccess={async (data) => {
            await recargarFacturas();
            const headers = Array.isArray(data?.headers) ? data.headers : [];
            if (headers.length === 1 && headers[0]?.idfactura) {
              await cargarFacturaPorId(headers[0].idfactura);
              setOpenOrdenesFijas(false);
            }
          }}
          // abrir un pedido específico que el modal te devuelve
          onOpenFactura={abrirFacturaDesdeOF}
        />
      )}

      {mostrarCoordinaciones && (
        <ModalCoordinaciones
          idfactura={facturaSeleccionada?.idfactura}
          idcarguera={form?.idcarguera || facturaSeleccionada?.idcarguera || ''}
          selectedDetalleIds={seleccionados}
          onClose={() => setMostrarCoordinaciones(false)}
          onSaved={refrescarDetalleFactura}
        />
      )}
      {modalNumeroFacturaVisible && (
        <div className="modal-overlay">
          <div className="modal">
            <h4>Asignar número de factura</h4>
            <p>
              Este será el número consecutivo de la factura del cliente. No puede repetirse con otra
              factura.
            </p>

            <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <span>Número de factura</span>
              <input
                type="number"
                className="login-input"
                value={numeroFacturaInput}
                onChange={(e) => {
                  setNumeroFacturaInput(e.target.value);
                  if (numeroFacturaError) setNumeroFacturaError('');
                }}
              />
            </label>

            {numeroFacturaError && (
              <p style={{ color: '#b91c1c', marginTop: 8 }}>{numeroFacturaError}</p>
            )}

            <div className="modal-buttons" style={{ marginTop: 12 }}>
              <button
                className="btn"
                onClick={() => {
                  if (guardandoFactura) return;
                  setModalNumeroFacturaVisible(false);
                  setNumeroFacturaError('');
                }}
              >
                Cancelar
              </button>

              <button
                className="btn btn-primary"
                onClick={handleConfirmarNumeroYFinalizar}
                disabled={cargandoNumeroFactura || guardandoFactura}
              >
                {cargandoNumeroFactura || guardandoFactura ? 'Guardando...' : 'Guardar y finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Box>
  );
}

export default FacturaDetalleEditable;
