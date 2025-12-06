// components/EmisorConfig.jsx
import React, { useEffect, useState } from 'react';
import api from '../services/api';

const Field = ({ label, children, className = '' }) => (
  <div className={`emisor-field ${className}`}>
    <label className="emisor-label">{label}</label>
    {children}
  </div>
);

const Input = ({ label, className = '', ...props }) => (
  <Field label={label} className={className}>
    <input {...props} className="emisor-input" />
  </Field>
);

const Select = ({ label, children, className = '', ...props }) => (
  <Field label={label} className={className}>
    <select {...props} className="emisor-select">
      {children}
    </select>
  </Field>
);

const TextArea = ({ label, hint, className = '', ...props }) => (
  <Field label={label} className={className}>
    <textarea {...props} className="emisor-textarea" />
    {hint ? <small className="emisor-hint">{hint}</small> : null}
  </Field>
);

export default function EmisorConfig() {
  const [emisor, setEmisor] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const e = await api.get('/api/empresa/emisor');
        const em = {
          mostrar_ruc: 1,
          mensaje_invoice: '',
          datos_bancarios: '',
          ...e.data
        };
        setEmisor(em);
      } catch (err) {
        console.error('❌ Error cargando configuración de emisor:', err);
      }
    })();
  }, []);

  if (!emisor) {
    return (
      <div className="emisor-loader">
        <div className="emisor-spinner" />
        <div className="emisor-loader-text">Cargando configuración…</div>
      </div>
    );
  }

  const saveEmisor = async () => {
    try {
      await api.put('/api/empresa/emisor', emisor);
      alert('Emisor guardado');
    } catch (err) {
      console.error('❌ Error guardando emisor:', err);
      alert('No se pudo guardar el emisor');
    }
  };

  return (
    <div className="emisor-wrap">
      <div className="emisor-card">
        <div className="emisor-card-header">
          <div className="emisor-title">Configuración del Emisor (SRI)</div>
          <div className="emisor-subtitle">Datos fiscales, contacto y factura comercial</div>
        </div>

        <div className="emisor-grid">
          <Input
            label="Razón Social"
            value={emisor.razon_social || ''}
            onChange={(e) => setEmisor({ ...emisor, razon_social: e.target.value })}
          />

          <Input
            label="Nombre Comercial"
            value={emisor.nombre_comercial || ''}
            onChange={(e) => setEmisor({ ...emisor, nombre_comercial: e.target.value })}
          />

          <Input
            label="RUC"
            value={emisor.ruc || ''}
            maxLength={13}
            onChange={(e) => setEmisor({ ...emisor, ruc: e.target.value })}
          />

          <Input
            className="span-2"
            label="Dirección Matriz (una sola caja, puedes usar Enter / \\n / | para saltos)"
            value={emisor.dir_matriz || ''}
            onChange={(e) => setEmisor({ ...emisor, dir_matriz: e.target.value })}
          />

          <Input
            label="Teléfono"
            value={emisor.telefono || ''}
            onChange={(e) => setEmisor({ ...emisor, telefono: e.target.value })}
          />

          <Input
            label="Email"
            type="email"
            value={emisor.email || ''}
            onChange={(e) => setEmisor({ ...emisor, email: e.target.value })}
          />

          <Select
            label="Obligado a llevar contabilidad"
            value={emisor.obligado_contabilidad || 'SI'}
            onChange={(e) => setEmisor({ ...emisor, obligado_contabilidad: e.target.value })}
          >
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </Select>

          <Input
            label="Contribuyente Especial (número)"
            value={emisor.contribuyente_especial_numero || ''}
            onChange={(e) =>
              setEmisor({ ...emisor, contribuyente_especial_numero: e.target.value })
            }
          />

          <Select
            label="Ambiente"
            value={emisor.ambiente || '1'}
            onChange={(e) => setEmisor({ ...emisor, ambiente: e.target.value })}
          >
            <option value="1">PRUEBAS (1)</option>
            <option value="2">PRODUCCIÓN (2)</option>
          </Select>

          <Field label="Mostrar RUC en Commercial Invoice">
            <label className="emisor-check">
              <input
                type="checkbox"
                checked={!!emisor.mostrar_ruc}
                onChange={(e) => setEmisor({ ...emisor, mostrar_ruc: e.target.checked ? 1 : 0 })}
              />
              <span>Mostrar RUC</span>
            </label>
          </Field>

          <TextArea
            className="span-2"
            label="Mensaje del Commercial Invoice (opcional)"
            rows={3}
            value={emisor.mensaje_invoice || ''}
            onChange={(e) => setEmisor({ ...emisor, mensaje_invoice: e.target.value })}
            hint="Puedes usar Enter, '\n' o '|' para saltos de línea."
          />

          <TextArea
            className="span-2"
            label="Datos bancarios (opcional)"
            rows={5}
            value={emisor.datos_bancarios || ''}
            onChange={(e) => setEmisor({ ...emisor, datos_bancarios: e.target.value })}
            hint="Usa Enter, '\n' o '|' para separar líneas (Beneficiary, Bank, Account, etc.)."
          />

          <Field className="span-2" label="Logo (PNG/JPG base64 opcional)">
            <input
              type="file"
              accept="image/*"
              className="emisor-file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const b64 = await new Promise((resolve, reject) => {
                  const fr = new FileReader();
                  fr.onload = () => resolve(String(fr.result).split(',')[1]);
                  fr.onerror = reject;
                  fr.readAsDataURL(file);
                });
                setEmisor({ ...emisor, logo_base64: b64 });
              }}
            />
          </Field>
        </div>

        <div className="emisor-actions">
          <button className="emisor-btn primary" onClick={saveEmisor}>
            Guardar Emisor
          </button>
        </div>
      </div>
    </div>
  );
}
