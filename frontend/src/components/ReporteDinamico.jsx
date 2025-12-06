// frontend/src/components/ReporteDinamico.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Box,
  Stack,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Switch
} from '@mui/material';
import { DataGridPremium, useGridApiRef } from '@mui/x-data-grid-premium';
import { esES as gridEsES } from '@mui/x-data-grid/locales';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LabelList
} from 'recharts';

// Exportación a PDF
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable'; // ✅ usar la función, no el plugin global
import html2canvas from 'html2canvas';

const toISO = (d) => {
  const dt = new Date(d);
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const nf = (v, d = 2) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const rcInt = (p) => <span>{nf(p.value, 0)}</span>;
const rcMoney = (p) => <span>$ {nf(p.value, 2)}</span>;
const rcPct = (p) => <span>{nf(p.value, 2)}%</span>;
const rcDate = (p) => <span>{p.value ? String(p.value).slice(0, 10) : ''}</span>;

const groupRowClassName = (params) => {
  const node =
    params?.rowNode ??
    params?.treeNode ??
    (params?.api && typeof params.api.getRowNode === 'function'
      ? params.api.getRowNode(params.id)
      : null);
  if (!node || node.type !== 'group') return '';
  const depth = node.depth ?? node.treeDepth ?? 0;
  if (depth === 0) return 'rg-depth-0';
  if (depth === 1) return 'rg-depth-1';
  return 'rg-depth-2';
};

const monthNames = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic'
];
const DIM_OPTS = [
  { value: 'semana', label: 'Semana (agrícola)' },
  { value: 'mes', label: 'Mes' },
  { value: 'anio', label: 'Año' },
  { value: 'vendedor', label: 'Vendedor' },
  { value: 'producto', label: 'Producto' },
  { value: 'variedad', label: 'Variedad' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'proveedor', label: 'Proveedor' }
];
const X_LABELS = {
  semana: 'Semana (agrícola)',
  mes: 'Mes',
  anio: 'Año',
  vendedor: 'Vendedor',
  producto: 'Producto',
  variedad: 'Variedad',
  cliente: 'Cliente',
  proveedor: 'Proveedor'
};

const PALETTES = {
  default: [
    '#1976d2',
    '#9c27b0',
    '#ff9800',
    '#2e7d32',
    '#d32f2f',
    '#455a64',
    '#7b1fa2',
    '#f57c00',
    '#388e3c',
    '#c2185b'
  ],
  blues: ['#90caf9', '#64b5f6', '#42a5f5', '#2196f3', '#1e88e5', '#1976d2', '#1565c0'],
  pastel: ['#a6cee3', '#b2df8a', '#fb9a99', '#fdbf6f', '#cab2d6', '#ffff99'],
  gray: ['#90a4ae']
};

const GROUP_KEY = 'reporteDinamico_rowGrouping_v1';
const VIS_KEY = 'reporteDinamico_colVisibility_v1';
const PALETTE_KEY = 'reporteDinamico_palette_v1';
const LABELS_KEY = 'reporteDinamico_showLabels_v1';

export default function ReporteDinamico() {
  const apiRef = useGridApiRef();
  const chartRef = useRef(null);

  // filtros
  const [desde, setDesde] = useState(() =>
    toISO(new Date(new Date().setDate(new Date().getDate() - 7)))
  );
  const [hasta, setHasta] = useState(() => toISO(new Date()));
  const [vendedorFiltro, setVendedorFiltro] = useState('');

  // datos
  const [rows, setRows] = useState([]);

  // CHART dinámico
  const [xDim, setXDim] = useState('mes');
  const [serieDim, setSerieDim] = useState('vendedor');
  const [metric, setMetric] = useState('subtotalVenta');
  const [agg, setAgg] = useState('sum');
  const [topN, setTopN] = useState(5);
  const [stacked, setStacked] = useState(true);

  // sync gráfica <-> tabla
  const [syncWithGrid, setSyncWithGrid] = useState(true);
  const [gridVersion, setGridVersion] = useState(0);
  const bumpGridVersion = useCallback(() => setGridVersion((v) => v + 1), []);

  // colores/etiquetas persistentes
  const [paletteName, setPaletteName] = useState('default');
  const [showLabels, setShowLabels] = useState(true);
  const palette = PALETTES[paletteName] || PALETTES.default;
  useEffect(() => {
    const p = localStorage.getItem(PALETTE_KEY);
    if (p && PALETTES[p]) setPaletteName(p);
    const sl = localStorage.getItem(LABELS_KEY);
    if (sl !== null) setShowLabels(sl === '1' || sl === 'true');
  }, []);
  useEffect(() => {
    localStorage.setItem(PALETTE_KEY, paletteName);
  }, [paletteName]);
  useEffect(() => {
    localStorage.setItem(LABELS_KEY, showLabels ? '1' : '0');
  }, [showLabels]);

  // persistencia grid
  const [rowGroupingModel, setRowGroupingModel] = useState([]);
  useEffect(() => {
    const raw = localStorage.getItem(GROUP_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) setRowGroupingModel(p);
      } catch {}
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(GROUP_KEY, JSON.stringify(rowGroupingModel));
  }, [rowGroupingModel]);

  const [columnVisibilityModel, setColumnVisibilityModel] = useState({});
  useEffect(() => {
    const raw = localStorage.getItem(VIS_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') setColumnVisibilityModel(p);
      } catch {}
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(VIS_KEY, JSON.stringify(columnVisibilityModel));
  }, [columnVisibilityModel]);

  // agregaciones grid
  const aggregationModel = useMemo(
    () => ({
      piezas: 'sum',
      cantidadTallos: 'sum',
      subtotal: 'sum',
      subtotalVenta: 'sum',
      margenDinero: 'sum',
      margenPct: 'avg'
    }),
    []
  );

  // cargar datos
  const fetchData = useCallback(async () => {
    const qs = new URLSearchParams({ desde, hasta }).toString();
    const res = await fetch(`/api/reportes/dinamico?${qs}`);
    const data = await res.json();

    const withCalc = data.map((r, i) => {
      const subtotal = Number(r.subtotal) || 0;
      const subtotalVenta = Number(r.subtotalVenta) || 0;
      const margenDinero = subtotalVenta - subtotal;
      const margenPct = subtotalVenta > 0 ? (margenDinero / subtotalVenta) * 100 : 0;

      return {
        id: r.iddetalle || i + 1,
        fecha: r.fecha,
        anio: Number(r.anio) || 0,
        mes: Number(r.mes) || 0,
        semana: Number(r.semana) || 0,
        cliente: r.cliente,
        proveedor: r.proveedor,
        vendedor: r.vendedor || '',
        idvendedor: r.idvendedor ?? null,
        producto: r.producto,
        variedad: r.variedad,
        piezas: Number(r.piezas) || 0,
        cantidadTallos: Number(r.cantidadTallos) || 0,
        subtotal,
        subtotalVenta,
        margenDinero,
        margenPct
      };
    });

    setRows(withCalc);
  }, [desde, hasta]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // opciones / filtro vendedor
  const vendedoresOpts = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const key = r.idvendedor != null ? String(r.idvendedor) : '';
      const label = r.vendedor || 'Sin vendedor';
      if (!map.has(key)) map.set(key, label);
    });
    return [...map.entries()]
      .filter(([k]) => k !== '')
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => ({ id, label }));
  }, [rows]);

  const rowsFiltradas = useMemo(() => {
    if (!vendedorFiltro) return rows;
    return rows.filter((r) => String(r.idvendedor ?? '') === vendedorFiltro);
  }, [rows, vendedorFiltro]);

  // filas para la gráfica (solo hojas reales; sin filas de grupo)
  const chartRows = useMemo(() => {
    void gridVersion; // asegura recomputar cuando cambian filtros/orden/paginación del grid
    if (!syncWithGrid || !apiRef.current?.getVisibleRowModels) return rowsFiltradas;
    try {
      const vm = apiRef.current.getVisibleRowModels();
      const arr = [];
      vm.forEach((row) => {
        if (row && Object.prototype.hasOwnProperty.call(row, 'fecha')) arr.push(row);
      });
      return arr.length ? arr : rowsFiltradas;
    } catch {
      return rowsFiltradas;
    }
  }, [syncWithGrid, rowsFiltradas, apiRef, gridVersion]);

  // columnas grid
  const columns = useMemo(
    () => [
      { field: 'fecha', headerName: 'Fecha', width: 110, renderCell: rcDate },
      { field: 'anio', headerName: 'Año', width: 80, type: 'number', renderCell: rcInt },
      { field: 'mes', headerName: 'Mes', width: 70, type: 'number', renderCell: rcInt },
      { field: 'semana', headerName: 'Semana', width: 90, type: 'number', renderCell: rcInt },
      { field: 'cliente', headerName: 'Cliente', width: 220 },
      { field: 'vendedor', headerName: 'Vendedor', width: 200 },
      { field: 'proveedor', headerName: 'Proveedor', width: 220 },
      { field: 'producto', headerName: 'Producto', width: 140 },
      { field: 'variedad', headerName: 'Variedad', width: 180 },
      { field: 'piezas', headerName: 'Piezas', width: 90, type: 'number', renderCell: rcInt },
      {
        field: 'cantidadTallos',
        headerName: 'Total Stems',
        width: 120,
        type: 'number',
        renderCell: rcInt
      },
      {
        field: 'subtotal',
        headerName: 'Costo (subtotal)',
        width: 150,
        type: 'number',
        renderCell: rcMoney
      },
      {
        field: 'subtotalVenta',
        headerName: 'Venta (subtotalVenta)',
        width: 170,
        type: 'number',
        renderCell: rcMoney
      },
      {
        field: 'margenDinero',
        headerName: 'Margen $',
        width: 120,
        type: 'number',
        renderCell: rcMoney
      },
      { field: 'margenPct', headerName: 'Margen %', width: 110, type: 'number', renderCell: rcPct }
    ],
    []
  );

  // totales
  const totals = useMemo(() => {
    const tPiezas = rowsFiltradas.reduce((a, r) => a + (r.piezas || 0), 0);
    const tStems = rowsFiltradas.reduce((a, r) => a + (r.cantidadTallos || 0), 0);
    const tCosto = rowsFiltradas.reduce((a, r) => a + (r.subtotal || 0), 0);
    const tVenta = rowsFiltradas.reduce((a, r) => a + (r.subtotalVenta || 0), 0);
    const tMargenDinero = tVenta - tCosto;
    const tMargenPct = tVenta > 0 ? (tMargenDinero / tVenta) * 100 : 0;
    return {
      piezas: tPiezas,
      cantidadTallos: tStems,
      subtotal: tCosto,
      subtotalVenta: tVenta,
      margenDinero: tMargenDinero,
      margenPct: tMargenPct
    };
  }, [rowsFiltradas]);

  const pinnedRows = useMemo(
    () => ({
      bottom: [
        {
          id: 'totales',
          fecha: '',
          anio: '',
          mes: '',
          semana: '',
          cliente: '',
          vendedor: '',
          proveedor: 'Totales:',
          producto: '',
          variedad: '',
          piezas: totals.piezas,
          cantidadTallos: totals.cantidadTallos,
          subtotal: totals.subtotal,
          subtotalVenta: totals.subtotalVenta,
          margenDinero: totals.margenDinero,
          margenPct: totals.margenPct
        }
      ]
    }),
    [totals]
  );

  // pivot para la gráfica
  const labelFormatter = useCallback(
    (value) => {
      if (metric === 'margenPct') return `${Number(value || 0).toFixed(2)}%`;
      if (['subtotal', 'subtotalVenta', 'margenDinero'].includes(metric)) {
        return `$ ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return Number(value || 0).toLocaleString();
    },
    [metric]
  );

  const extractDim = (row, dim) => {
    switch (dim) {
      case 'semana': {
        const w = Number(row.semana) || 0;
        return { key: String(w), label: `S${String(w).padStart(2, '0')}`, sort: w };
      }
      case 'mes': {
        const idx = Number(row.mes) ? Number(row.mes) - 1 : new Date(row.fecha).getMonth();
        return { key: String(idx), label: monthNames[idx], sort: idx };
      }
      case 'anio': {
        const y = Number(row.anio) || new Date(row.fecha).getFullYear();
        return { key: String(y), label: String(y), sort: y };
      }
      case 'vendedor':
        return {
          key: row.vendedor || 'Sin vendedor',
          label: row.vendedor || 'Sin vendedor',
          sort: row.vendedor || 'Sin vendedor'
        };
      case 'producto':
        return {
          key: row.producto || 'SIN PRODUCTO',
          label: row.producto || 'SIN PRODUCTO',
          sort: row.producto || 'SIN PRODUCTO'
        };
      case 'variedad':
        return {
          key: row.variedad || 'SIN VARIEDAD',
          label: row.variedad || 'SIN VARIEDAD',
          sort: row.variedad || 'SIN VARIEDAD'
        };
      case 'cliente':
        return {
          key: row.cliente || 'SIN CLIENTE',
          label: row.cliente || 'SIN CLIENTE',
          sort: row.cliente || 'SIN CLIENTE'
        };
      case 'proveedor':
        return {
          key: row.proveedor || 'SIN PROVEEDOR',
          label: row.proveedor || 'SIN PROVEEDOR',
          sort: row.proveedor || 'SIN PROVEEDOR'
        };
      default:
        return { key: 'NA', label: 'NA', sort: 'NA' };
    }
  };

  const pivot = useMemo(() => {
    const serieDimSafe = serieDim === xDim ? 'vendedor' : serieDim;
    const catMap = new Map();
    const serMap = new Map();
    const cellMap = new Map();

    chartRows.forEach((r) => {
      const x = extractDim(r, xDim);
      const s = extractDim(r, serieDimSafe);
      const v = Number(r[metric] ?? 0);

      if (!catMap.has(x.key)) catMap.set(x.key, { label: x.label, sort: x.sort });
      if (!serMap.has(s.key)) serMap.set(s.key, s.label);

      const k = `${x.key}|${s.key}`;
      const obj = cellMap.get(k) || { sum: 0, cnt: 0 };
      obj.sum += v;
      obj.cnt += 1;
      cellMap.set(k, obj);
    });

    const serTotals = [...serMap.keys()]
      .map((sKey) => {
        let total = 0;
        catMap.forEach((_v, xKey) => {
          const cell = cellMap.get(`${xKey}|${sKey}`);
          if (cell) total += cell.sum;
        });
        return { key: sKey, label: serMap.get(sKey), total };
      })
      .sort((a, b) => b.total - a.total);

    const series = serTotals.slice(0, topN);

    const cats = [...catMap.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) =>
        typeof a.sort === 'number' ? a.sort - b.sort : String(a.sort).localeCompare(String(b.sort))
      );

    const data = cats.map((c) => {
      const obj = { label: c.label };
      series.forEach((s) => {
        const cell = cellMap.get(`${c.key}|${s.key}`);
        let val = 0;
        if (cell) val = agg === 'avg' ? (cell.cnt ? cell.sum / cell.cnt : 0) : cell.sum;
        obj[s.label] = val;
      });
      return obj;
    });

    return { data, seriesLabels: series.map((s) => s.label) };
  }, [chartRows, xDim, serieDim, metric, agg, topN]);

  // ========= Exportar PDF (gráfico + tabla de filas visibles/filtradas) =========
  const exportPDF = async () => {
    const doc = new jsPDF('landscape', 'pt', 'A4');
    const marginX = 40;
    let y = 40;

    doc.setFontSize(16);
    doc.text('Reporte Dinámico', marginX, y);
    y += 18;
    doc.setFontSize(10);
    const meta = `Rango: ${desde} a ${hasta}   |   X: ${X_LABELS[xDim]}   •   Serie: ${X_LABELS[serieDim]}   •   Métrica: ${metric}   •   ${agg === 'sum' ? 'Suma' : 'Promedio'}`;
    doc.text(meta, marginX, y);
    y += 10;

    // Gráfica
    const chartNode = chartRef.current;
    if (chartNode) {
      const canvas = await html2canvas(chartNode, { scale: 2, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pageWidth = doc.internal.pageSize.getWidth() - marginX * 2;
      const chartH = Math.min((canvas.height / canvas.width) * pageWidth, 320);
      doc.addImage(imgData, 'PNG', marginX, y, pageWidth, chartH);
      y += chartH + 16;
    }

    // Filas a exportar
    let exportRows = rowsFiltradas;
    if (syncWithGrid && apiRef.current?.getVisibleRowModels) {
      exportRows = Array.from(apiRef.current.getVisibleRowModels().values()).filter((r) =>
        Object.prototype.hasOwnProperty.call(r, 'fecha')
      ); // sólo filas reales
    }

    // Columnas visibles (mismo orden)
    const visibleCols = columns.filter((c) => columnVisibilityModel[c.field] !== false);
    const head = [visibleCols.map((c) => c.headerName || c.field)];
    const body = exportRows.map((r) =>
      visibleCols.map((c) => {
        const v = r[c.field];
        if (c.field === 'fecha') return v ? String(v).slice(0, 10) : '';
        if (['piezas', 'cantidadTallos', 'anio', 'mes', 'semana'].includes(c.field))
          return nf(v, 0);
        if (['subtotal', 'subtotalVenta', 'margenDinero'].includes(c.field)) return `$ ${nf(v, 2)}`;
        if (c.field === 'margenPct') return `${nf(v, 2)}%`;
        return v ?? '';
      })
    );

    autoTable(doc, {
      head,
      body,
      startY: y,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [25, 118, 210], textColor: 255 },
      didDrawPage: () => {
        const str = `Página ${doc.internal.getNumberOfPages()}`;
        doc.setFontSize(9);
        doc.text(
          str,
          doc.internal.pageSize.getWidth() - marginX,
          doc.internal.pageSize.getHeight() - 12,
          { align: 'right' }
        );
      }
    });

    doc.save(`reporte-dinamico_${desde}_${hasta}.pdf`);
  };
  // ===================================================================

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      {/* Filtros */}
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        <TextField
          label="Desde"
          type="date"
          size="small"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="Hasta"
          type="date"
          size="small"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Vendedor</InputLabel>
          <Select
            label="Vendedor"
            value={vendedorFiltro}
            onChange={(e) => setVendedorFiltro(e.target.value)}
          >
            <MenuItem value="">Todos</MenuItem>
            {vendedoresOpts.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="contained" onClick={fetchData}>
          APLICAR
        </Button>
        <FormControlLabel
          control={
            <Switch checked={syncWithGrid} onChange={(e) => setSyncWithGrid(e.target.checked)} />
          }
          label="Sincronizar con la tabla"
        />
        <Button variant="outlined" onClick={exportPDF}>
          EXPORTAR PDF
        </Button>
      </Stack>

      {/* Controles de la gráfica */}
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Eje X</InputLabel>
          <Select label="Eje X" value={xDim} onChange={(e) => setXDim(e.target.value)}>
            {DIM_OPTS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Serie</InputLabel>
          <Select label="Serie" value={serieDim} onChange={(e) => setSerieDim(e.target.value)}>
            {DIM_OPTS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Métrica</InputLabel>
          <Select label="Métrica" value={metric} onChange={(e) => setMetric(e.target.value)}>
            <MenuItem value="piezas">Piezas</MenuItem>
            <MenuItem value="cantidadTallos">Total Stems</MenuItem>
            <MenuItem value="subtotal">Costo</MenuItem>
            <MenuItem value="subtotalVenta">Venta</MenuItem>
            <MenuItem value="margenDinero">Margen $</MenuItem>
            <MenuItem value="margenPct">Margen %</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Agregación</InputLabel>
          <Select label="Agregación" value={agg} onChange={(e) => setAgg(e.target.value)}>
            <MenuItem value="sum">Suma</MenuItem>
            <MenuItem value="avg">Promedio</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Top N series</InputLabel>
          <Select
            label="Top N series"
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
          >
            {[3, 5, 8, 10, 15].map((n) => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          control={<Checkbox checked={stacked} onChange={(e) => setStacked(e.target.checked)} />}
          label="Apilar barras"
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Colores</InputLabel>
          <Select
            label="Colores"
            value={paletteName}
            onChange={(e) => setPaletteName(e.target.value)}
          >
            <MenuItem value="default">Predeterminado</MenuItem>
            <MenuItem value="blues">Azules</MenuItem>
            <MenuItem value="pastel">Pastel</MenuItem>
            <MenuItem value="gray">Gris</MenuItem>
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Checkbox checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          }
          label="Mostrar valores"
        />
      </Stack>

      {/* Gráfica */}
      <Box
        ref={chartRef}
        sx={{ height: 350, width: '100%', bgcolor: '#fff', p: 1, borderRadius: 1 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pivot.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip formatter={(v) => labelFormatter(v)} />
            <Legend verticalAlign="bottom" height={24} />
            {pivot.seriesLabels.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                stackId={stacked ? 'a' : undefined}
                fill={palette[i % palette.length]}
              >
                {showLabels && (
                  <LabelList
                    dataKey={s}
                    position={stacked ? 'insideTop' : 'top'}
                    content={({ x, y, width, value }) => (
                      <text
                        x={x + width / 2}
                        y={stacked ? y + 12 : y - 4}
                        textAnchor="middle"
                        fontSize={11}
                      >
                        {labelFormatter(value)}
                      </text>
                    )}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Box>

      {/* Grid de detalle */}
      <Box sx={{ height: 620, width: '100%', bgcolor: '#fff', p: 1, borderRadius: 1 }}>
        <DataGridPremium
          apiRef={apiRef}
          rows={rowsFiltradas}
          columns={columns}
          getRowId={(r) => r.id}
          showToolbar
          density="compact"
          disableRowSelectionOnClick
          localeText={gridEsES.components.MuiDataGrid.defaultProps.localeText}
          rowGroupingModel={rowGroupingModel}
          onRowGroupingModelChange={(m) => {
            setRowGroupingModel(m);
            bumpGridVersion();
          }}
          aggregationModel={aggregationModel}
          getAggregationPosition={() => 'inline'}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={(m) => {
            setColumnVisibilityModel(m);
            bumpGridVersion();
          }}
          onFilterModelChange={bumpGridVersion}
          onSortModelChange={bumpGridVersion}
          onPaginationModelChange={bumpGridVersion}
          onQuickFilterValuesChange={bumpGridVersion}
          initialState={{ sorting: { sortModel: [{ field: 'fecha', sort: 'desc' }] } }}
          pinnedRows={pinnedRows}
          getRowClassName={groupRowClassName}
          sx={{
            '& .MuiDataGrid-pinnedRows .MuiDataGrid-row': { fontWeight: 700 },
            '& .rg-depth-0': { fontWeight: 800, backgroundColor: 'rgba(25,118,210,0.10)' },
            '& .rg-depth-1': { fontWeight: 700, backgroundColor: 'rgba(25,118,210,0.06)' },
            '& .rg-depth-2': { fontWeight: 600, backgroundColor: 'rgba(25,118,210,0.03)' }
          }}
        />
      </Box>
    </Stack>
  );
}
