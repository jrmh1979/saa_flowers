import React, { useEffect, useState } from 'react';
import api from '../services/api';

function ModalReporteCodigo({ idfactura, onClose }) {
  const [codigos, setCodigos] = useState([]);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [vistaPrevia, setVistaPrevia] = useState(null);
  const [cargando, setCargando] = useState(false);

  // 🔹 NUEVO: selector de tipo de reporte
  // 'orden' = Orden de compra por código
  // 'prepacking' = Prepacking por código
  const [tipoReporte, setTipoReporte] = useState('orden');

  // 🔹 Obtener códigos únicos de la factura
  useEffect(() => {
    const cargarCodigos = async () => {
      try {
        const res = await api.get(`/api/facturas/factura-detalle/${idfactura}`);
        const codigosUnicos = [
          ...new Set(res.data.map((d) => d.codigo).filter((c) => c && c.trim() !== ''))
        ];
        setCodigos(codigosUnicos);
      } catch (err) {
        console.error('❌ Error al cargar códigos:', err);
      }
    };
    cargarCodigos();
  }, [idfactura]);

  const toggleSeleccion = (codigo) => {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      nuevo.has(codigo) ? nuevo.delete(codigo) : nuevo.add(codigo);
      return nuevo;
    });
  };

  const seleccionarTodos = () => {
    if (seleccionados.size === codigos.length) {
      setSeleccionados(new Set());
      setVistaPrevia(null);
    } else {
      setSeleccionados(new Set(codigos));
    }
  };

  const verReporte = async () => {
    if (seleccionados.size === 0) {
      alert('Selecciona al menos un código');
      return;
    }

    setCargando(true);
    try {
      // 🔹 Elegimos endpoint según el tipo de reporte
      const url =
        tipoReporte === 'orden'
          ? `/api/facturas/reporte-por-codigos` // (ya existente)
          : `/api/facturas/prepacking-por-codigos`; // (nuevo en backend)

      const res = await api.post(url, {
        idfactura,
        codigos: Array.from(seleccionados)
      });

      setVistaPrevia(res.data.base64);
    } catch (err) {
      console.error('❌ Error backend reporte:', err);
      alert('❌ Error al generar reporte');
    }
    setCargando(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-flex">
        <div className="modal-col">
          <h3>📊 Reportes por Código</h3>

          {/* 🔹 NUEVO: selector de tipo */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 12px' }}>
            <label>Tipo de reporte:</label>
            <select
              value={tipoReporte}
              onChange={(e) => {
                setTipoReporte(e.target.value);
                setVistaPrevia(null); // limpiar preview al cambiar tipo
              }}
            >
              <option value="orden">1) Orden de compra por código</option>
              <option value="prepacking">2) Prepacking por código</option>
            </select>
          </div>

          <p style={{ marginBottom: '10px' }}>
            Selecciona los códigos para generar un PDF consolidado:
          </p>

          {codigos.length === 0 ? (
            <p style={{ color: 'gray' }}>No hay códigos registrados en esta factura.</p>
          ) : (
            <>
              <button onClick={seleccionarTodos} style={{ marginBottom: '10px' }}>
                {seleccionados.size === codigos.length
                  ? '🔽 Deseleccionar Todos'
                  : '🔼 Seleccionar Todos'}
              </button>

              <ul className="lista-proveedores">
                {codigos.map((codigo) => (
                  <li key={codigo}>
                    <label>
                      <input
                        type="checkbox"
                        className="checkbox-mini"
                        checked={seleccionados.has(codigo)}
                        onChange={() => toggleSeleccion(codigo)}
                      />
                      <span>{codigo}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div style={{ marginTop: '20px' }}>
            <button onClick={verReporte} disabled={cargando || seleccionados.size === 0}>
              📄 Ver Reporte
            </button>
            <button onClick={onClose} style={{ marginLeft: '10px' }}>
              ❌ Cancelar
            </button>
          </div>
        </div>

        {vistaPrevia && (
          <div className="modal-col vista-pdf">
            <h4>📄 Vista previa PDF</h4>
            <iframe
              src={`data:application/pdf;base64,${vistaPrevia}`}
              title={tipoReporte === 'orden' ? 'Orden por Código' : 'Prepacking por Código'}
              width="100%"
              height="420px"
              style={{ border: '1px solid #ccc', borderRadius: '6px' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default ModalReporteCodigo;
