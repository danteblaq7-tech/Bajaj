const { Pool, types } = require('pg');
const config = require('../config');
// NUMERIC -> number, BIGINT -> number (fine at MVP scale; move to integer cents later if you need exact money maths)
types.setTypeParser(1700, parseFloat);
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1082, (v) => v); // DATE -> 'YYYY-MM-DD' string (no timezone shift)

const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
pool.on('error', (e) => console.error('[db] idle client error:', e.message));

const query = (text, params) => pool.query(text, params);
// Runs fn(client) inside a transaction. `client` has the same .query() as this module, so services accept either.
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { pool, query, tx };
