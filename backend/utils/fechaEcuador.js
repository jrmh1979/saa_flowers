// Devuelve la fecha actual en Ecuador como 'YYYY-MM-DD'
function formatoFechaEcuador(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

module.exports = { formatoFechaEcuador };
