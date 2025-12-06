export function formatoFechaEcuador(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  // en-CA -> 'YYYY-MM-DD'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}
