// In-vehicle camera footage: storage, time-limited access, and retention.
// Cameras (or a small gateway device in the vehicle) push MP4 clips to POST /api/footage/device with a per-vehicle key.
// Clips are NEVER public: staff play them through short-lived signed links, and every play is logged.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const E = require('../utils/errors');
const F = config.footage;

// Streams the upload straight to disk (clips can be large), checks it is an MP4, and enforces the size limit.
function saveStream(req) {
  return new Promise((resolve, reject) => {
    fs.promises.mkdir(F.dir, { recursive: true }).then(() => {
      const name = `${crypto.randomBytes(16).toString('hex')}.mp4`;
      const file = path.join(F.dir, name);
      const out = fs.createWriteStream(file, { flags: 'wx' });
      let bytes = 0, head = Buffer.alloc(0), done = false;
      const fail = (err) => { if (done) return; done = true; req.unpipe(out); out.destroy(); fs.unlink(file, () => {}); reject(err); };
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > F.maxBytes) return fail(E.badRequest(`Clip is larger than ${Math.round(F.maxBytes / 1048576)} MB`));
        if (head.length < 12) {
          head = Buffer.concat([head, chunk]);
          if (head.length >= 12 && head.subarray(4, 8).toString('ascii') !== 'ftyp') fail(E.badRequest('Only MP4 video is accepted'));
        }
      });
      req.on('error', fail);
      req.on('aborted', () => fail(E.badRequest('Upload interrupted')));
      out.on('error', fail);
      out.on('finish', () => {
        if (done) return;
        if (bytes < 12) return fail(E.badRequest('Empty or invalid clip'));
        done = true; resolve({ file: name, bytes });
      });
      req.pipe(out);
    }).catch(reject);
  });
}

// The vehicle and time window an incident covers: its trip if it has one, otherwise the driver's shift around that time.
async function incidentWindow(incidentId) {
  const i = (await db.query(
    `SELECT i.driver_id, i.created_at, b.vehicle_id AS bv, b.started_at, b.completed_at, b.created_at AS bc
     FROM incidents i LEFT JOIN bookings b ON b.id=i.booking_id WHERE i.id=$1`, [incidentId])).rows[0];
  if (!i) return null;
  if (i.bv) return { vehicle: i.bv, from: i.started_at || i.bc, to: i.completed_at || new Date() };
  const s = (await db.query(
    `SELECT vehicle_id FROM shifts WHERE driver_id=$1 AND start_time<=$2 AND (end_time IS NULL OR end_time>=$2) ORDER BY start_time DESC LIMIT 1`, [i.driver_id, i.created_at])).rows[0];
  if (!s) return null;
  const t = new Date(i.created_at).getTime();
  return { vehicle: s.vehicle_id, from: new Date(t - 3600e3), to: new Date(t + 900e3) };
}
const OVERLAP = `vehicle_id=$1 AND started_at BETWEEN $2::timestamptz - interval '10 minutes' AND $3::timestamptz`;
async function clipsForIncident(incidentId) {
  const w = await incidentWindow(incidentId);
  if (!w) return [];
  return (await db.query(`SELECT id, vehicle_id, started_at, duration_s, bytes, hold FROM footage WHERE ${OVERLAP} ORDER BY started_at`, [w.vehicle, w.from, w.to])).rows;
}
// Clips around an incident are kept past the normal retention period until staff release them.
async function holdForIncident(incidentId) {
  const w = await incidentWindow(incidentId);
  if (!w) return 0;
  return (await db.query(`UPDATE footage SET hold=true WHERE ${OVERLAP}`, [w.vehicle, w.from, w.to])).rowCount;
}
// Data protection: delete clips older than the retention period unless they are on hold.
async function retention() {
  const r = await db.query('DELETE FROM footage WHERE NOT hold AND created_at < now() - make_interval(days=>$1) RETURNING file', [F.retentionDays]);
  for (const x of r.rows) await fs.promises.unlink(path.join(F.dir, x.file)).catch(() => {});
  return r.rowCount;
}
module.exports = { saveStream, clipsForIncident, holdForIncident, retention };
