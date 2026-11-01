const config = require('./config');
const app = require('./app');
const db = require('./db');
const jobs = require('./jobs');

(async () => {
  try { await db.query('SELECT 1'); } catch (e) { console.error('Cannot reach the database:', e.message); process.exit(1); }
  const server = app.listen(config.port, () => {
    console.log(`Pwani Ride API listening on :${config.port} (${config.prod ? 'production' : 'development'}${config.mpesa.mock ? ', M-Pesa MOCK mode' : ''})`);
    jobs.start();
  });
  const stop = () => server.close(() => db.pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})();
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
