import React, { useState } from 'react';
import stringSimilarity from 'string-similarity';
import '../assets/style.css';

function ModalAgregarPedidos({ facturas, catalogo = [], onAgregar, onClose }) {
  const [idfactura, setIdFactura] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [textoPegado, setTextoPegado] = useState('');
  const [codigo, setCodigo] = useState('');
  const [idOrder, setIdOrder] = useState('');

  const normalizar = (texto) =>
    texto?.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  const buscarIdPorSimilitud = (valor, categoria) => {
    const texto = normalizar(valor);
    const lista = catalogo.filter((c) => c.categoria === categoria);
    const valoresNorm = lista.map((r) => normalizar(r.valor));
    if (!texto || valoresNorm.length === 0) return null;

    const resultado = stringSimilarity.findBestMatch(texto, valoresNorm);
    const { bestMatch, bestMatchIndex } = resultado;

    if (bestMatch.rating >= 0.9 || texto.includes(valoresNorm[bestMatchIndex])) {
      return lista[bestMatchIndex].id;
    }

    return null;
  };

  const buscarTallosPorReglaEmpaque = ({ idtipocaja, idproducto, idempaque, longitud }) => {
    const reglas = catalogo.filter((c) => c.categoria === 'regla_empaque');
    const longitudNum = parseInt((longitud || '').toString().match(/\d+/)?.[0]);
    if (!idproducto || !longitudNum) return null;

    for (const r of reglas) {
      const partes = r.valor?.split('|');
      if (!partes || partes.length < 4) continue;

      const [, idProd, long, rango] = partes;
      const longRegla = parseInt(long);
      const [minTallos] = rango.split('-').map(Number);

      if (parseInt(idProd) === idproducto && longRegla === longitudNum) {
        return minTallos;
      }
    }
    return null;
  };

  const handleAgregar = () => {
    if (!idfactura) {
      alert('⚠️ Selecciona una factura válida');
      return;
    }

    const idfacturaNum = parseInt(idfactura);
    const facturaSeleccionada = facturas.find((f) => f.idfactura === idfacturaNum);
    if (!facturaSeleccionada) {
      alert('⚠️ No se encontró la factura seleccionada.');
      return;
    }

    if (textoPegado.trim()) {
      const lineas = textoPegado
        .trim()
        .split('\n')
        .map((linea) => linea.trim())
        .filter((linea) => linea.length > 0);

      const pedidosInterpretados = [];

      const limpiarLinea = (texto) =>
        texto
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
          .replace(/[^\w\s/-]/gi, '') // Quitar símbolos, emojis, etc.
          .replace(/\s+/g, ' ') // Colapsar múltiples espacios
          .trim();

      for (const lineaOriginal of lineas) {
        const linea = limpiarLinea(lineaOriginal);

        const match = linea.match(/^(\d+)\s+(QB|HB|FB)\s+(.+?)\s+(\d{2})(?:\s*CM)?$/i);
        if (!match) {
          console.warn(`❌ No se pudo interpretar esta línea:\n${lineaOriginal}`);
          continue;
        }

        const cantidad = parseInt(match[1]);
        const cajaTexto = match[2];
        const variedadTexto = match[3];
        const longitudTexto = match[4];

        const idtipocaja = buscarIdPorSimilitud(cajaTexto, 'tipocaja');
        const idvariedad = buscarIdPorSimilitud(variedadTexto, 'variedad');
        const idlongitud = buscarIdPorSimilitud(longitudTexto, 'longitud');
        const idproducto = 25;
        const idempaque = 20;

        const tallos = buscarTallosPorReglaEmpaque({
          idtipocaja,
          idproducto,
          idempaque,
          longitud: longitudTexto
        });

        const pedido = {
          idfactura: idfacturaNum,
          idcliente: facturaSeleccionada.idcliente,
          cantidad,
          idtipocaja: idtipocaja || null,
          idvariedad: idvariedad || null,
          idlongitud: idlongitud || null,
          idproducto,
          idempaque,
          tallos: tallos || null,
          totaltallos: tallos ? cantidad * tallos : null,
          codigo: codigo || null,
          idOrder: idOrder ? parseInt(idOrder) : null,
          observaciones: lineaOriginal
        };

        pedidosInterpretados.push(pedido);
      }

      if (pedidosInterpretados.length === 0) {
        alert('⚠️ No hay datos válidos para agregar.');
        return;
      }

      onAgregar(pedidosInterpretados);
    } else {
      if (!cantidad || cantidad <= 0) {
        alert('⚠️ Ingresa una cantidad válida');
        return;
      }
      onAgregar([
        {
          idfactura: idfacturaNum,
          idcliente: facturaSeleccionada.idcliente,
          cantidad,
          codigo: codigo || null,
          idOrder: idOrder ? parseInt(idOrder) : null
        }
      ]);
    }

    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>➕ Agregar pedidos</h3>

        <div style={{ marginBottom: '1rem' }}>
          <label>Factura (proceso):</label>
          <select value={idfactura} onChange={(e) => setIdFactura(e.target.value)}>
            <option value="">-- Selecciona factura --</option>
            {facturas.map((f) => (
              <option key={f.idfactura} value={f.idfactura}>
                {f.idfactura} | {f.cliente} | {f.fecha}
              </option>
            ))}
          </select>
          <div style={{ marginBottom: '1rem' }}>
            <label>Código:</label>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: W459"
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label>Tipo de orden:</label>
            <select value={idOrder} onChange={(e) => setIdOrder(e.target.value)}>
              <option value="">-- Selecciona tipo de orden --</option>
              {catalogo
                .filter((c) => c.categoria === 'tipopedido')
                .map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.valor}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Texto pegado (1 línea = 1 pedido):</label>
          <textarea
            value={textoPegado}
            onChange={(e) => setTextoPegado(e.target.value)}
            placeholder="Ej: 1 QB MANDALA 70CM"
            rows={6}
            style={{ width: '100%' }}
          />
        </div>

        {!textoPegado.trim() && (
          <div style={{ marginBottom: '1rem' }}>
            <label>Cantidad de registros vacíos:</label>
            <input
              type="number"
              min="1"
              value={cantidad}
              onChange={(e) => setCantidad(parseInt(e.target.value))}
            />
          </div>
        )}

        <div style={{ marginTop: '20px' }}>
          <button onClick={handleAgregar}>✅ Agregar</button>
          <button onClick={onClose} style={{ marginLeft: '10px' }}>
            ❌ Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalAgregarPedidos;
