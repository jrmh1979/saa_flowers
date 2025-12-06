// filtrosCustom.js

// ✅ Agrega la opción "Vacíos" con value ''
export const agregarOpcionVaciosCustom = (opciones = []) => {
  return [{ value: '', label: 'Vacíos' }, ...opciones];
};
