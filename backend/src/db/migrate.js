const fs = require('fs');
const path = require('path');
const db = require('./index');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('Schema applied.');
  await db.pool.end();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
