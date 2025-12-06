import React, { useEffect, useState } from 'react';
import api from '../services/api';

export default function ModalDAE({ show, onClose, onSave, datosEditar }) {
  const [numero, setNumero] = useState('');
  const [paisDestino, setPaisDestino] = useState('');
  const [puertoEmbarque, setPuertoEmbarque] = useState('');
  const [puertoDestino, setPuertoDestino] = useState('');
  const [apertura, setApertura] = useState('');
  const [caducidad, setCaducidad] = useState('');
  const [obs, setObs] = useState('');

  const [paises, setPaises] = useState([]);
  const [puertos, setPuertos] = useState([]);

  useEffect(() => {
    const cargar = async () => {
      try {
        const [cp, pt] = await Promise.all([
          api.get('/api/terceros/catalogo?categoria=pais_sri'),
          api.get('/api/terceros/catalogo?categoria=puerto')
        ]);
        setPaises(cp.data || []);
        setPuertos(pt.data || []);
      } catch (e) {
        console.error(e);
      }
    };
    cargar();
  }, []);

  useEffect(() => {
    if (datosEditar) {
      setNumero(datosEditar.numero || '');
      setPaisDestino(datosEditar.pais_destino_codigo || '');
      setPuertoEmbarque(datosEditar.puerto_embarque_codigo || '');
      setPuertoDestino(datosEditar.puerto_destino_codigo || '');
      setApertura(datosEditar.fecha_apertura ? datosEditar.fecha_apertura.substring(0, 10) : '');
      setCaducidad(datosEditar.fecha_caducidad ? datosEditar.fecha_caducidad.substring(0, 10) : '');
      setObs(datosEditar.observaciones || '');
    } else {
      setNumero('');
      setPaisDestino('');
      setPuertoEmbarque('');
      setPuertoDestino('');
      setApertura('');
      setCaducidad('');
      setObs('');
    }
  }, [datosEditar]);

  if (!show) return null;

  const guardar = async () => {
    if (!numero || !paisDestino || !puertoEmbarque || !puertoDestino || !apertura || !caducidad) {
      alert('Completa todos los campos obligatorios');
      return;
    }
    if (new Date(apertura) > new Date(caducidad)) {
      alert('La fecha de apertura no puede ser mayor a la de caducidad');
      return;
    }
    const payload = {
      numero,
      pais_destino_codigo: paisDestino,
      puerto_embarque_codigo: puertoEmbarque,
      puerto_destino_codigo: puertoDestino,
      fecha_apertura: apertura,
      fecha_caducidad: caducidad,
      observaciones: obs || null
    };
    try {
      if (datosEditar) {
        await api.put(`/api/dae/${datosEditar.iddae}`, payload);
        alert('✅ DAE actualizada');
      } else {
        await api.post('/api/dae', payload);
        alert('✅ DAE creada');
      }
      onSave?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      alert('❌ Error al guardar DAE');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>{datosEditar ? '✏️ Editar DAE' : '➕ Nueva DAE'}</h3>

        <label>Número DAE:</label>
        <input value={numero} onChange={(e) => setNumero(e.target.value.toUpperCase())} />

        <label>País destino (ATS):</label>
        <select value={paisDestino} onChange={(e) => setPaisDestino(e.target.value)}>
          <option value="">-- Selecciona --</option>
          {paises.map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {p.codigo} - {p.nombre}
            </option>
          ))}
        </select>

        <label>Puerto embarque (código):</label>
        <select value={puertoEmbarque} onChange={(e) => setPuertoEmbarque(e.target.value)}>
          <option value="">-- Selecciona --</option>
          {puertos.map((pt) => (
            <option key={pt.codigo} value={pt.codigo}>
              {pt.codigo} - {pt.nombre}
            </option>
          ))}
        </select>

        <label>Puerto destino (código):</label>
        <select value={puertoDestino} onChange={(e) => setPuertoDestino(e.target.value)}>
          <option value="">-- Selecciona --</option>
          {puertos.map((pt) => (
            <option key={pt.codigo} value={pt.codigo}>
              {pt.codigo} - {pt.nombre}
            </option>
          ))}
        </select>

        <label>Fecha apertura:</label>
        <input type="date" value={apertura} onChange={(e) => setApertura(e.target.value)} />

        <label>Fecha caducidad:</label>
        <input type="date" value={caducidad} onChange={(e) => setCaducidad(e.target.value)} />

        <label>Observaciones (opcional):</label>
        <input value={obs} onChange={(e) => setObs(e.target.value)} />

        <div className="modal-buttons">
          <button onClick={guardar}>{datosEditar ? '💾 Actualizar' : '✅ Guardar'}</button>
          <button onClick={onClose}>❌ Cerrar</button>
        </div>
      </div>
    </div>
  );
}
