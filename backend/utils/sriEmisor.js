const db = require('../db');

async function getEmisor() {
  const [rows] = await db.query(`SELECT * FROM sri_emisor LIMIT 1`);
  if (!rows.length) throw new Error('Emisor no configurado');
  return rows[0];
}
async function getSecuencia(codDoc = '01') {
  const [rows] = await db.query(
    `SELECT * FROM sri_secuencias WHERE cod_doc=? ORDER BY id LIMIT 1`,
    [codDoc]
  );
  if (!rows.length) throw new Error(`Secuencia no configurada para ${codDoc}`);
  return rows[0];
}
async function incSecuencia(id) {
  await db.query(`UPDATE sri_secuencias SET secuencial_actual = secuencial_actual + 1 WHERE id=?`, [
    id
  ]);
}
const leftPad = (n, w = 9) => String(n).padStart(w, '0');

module.exports = { getEmisor, getSecuencia, incSecuencia, leftPad };
