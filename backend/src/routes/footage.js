const router = require('express').Router();
const path = require('path');
const db = require('../db');
const config = require('../config');
const footage = require('../services/footage');
const E = require('../utils/errors');
const { wrap, sha, safeEq } = require('../utils/helpers');
const { f } = require('../utils/validate');
const { verify } = require('../utils/sign');
const F = config.footage;

// Camera or in-vehicle gateway uploads a clip:
//   curl -X POST $API/footage/device -H "X-Device-Key: <key>" -H "X-Vehicle-Id: <vehicle uuid>" \
//        -H "X-Started-At: 2026-11-02T08:15:00Z" -H "X-Duration-S: 60" -H "Content-Type: video/mp4" --data-binary @clip.mp4
router.post('/device', wrap(async (req, res) => {
  let vehicleId;
  try { vehicleId = f.uuid()(req.get('x-vehicle-id')); } catch (e) { throw E.badRequest('X-Vehicle-Id must be a vehicle id'); }
  const key = req.get('x-device-key');
  const v = (await db.query('SELECT camera_key_hash FROM vehicles WHERE id=$1', [vehicleId])).rows[0];
  if (!v || !v.camera_key_hash || !key || !safeEq(sha(key), v.camera_key_hash)) throw E.unauthorized('Invalid camera key');
  const started = new Date(req.get('x-started-at') || '');
  if (isNaN(started) || started.getTime() > Date.now() + 3600e3) throw E.badRequest('X-Started-At must be a valid ISO time');
  const dur = Math.max(0, Math.min(3600, Math.round(Number(req.get('x-duration-s')) || 0)));
  const saved = await footage.saveStream(req);
  const row = (await db.query('INSERT INTO footage(vehicle_id,started_at,duration_s,bytes,file) VALUES($1,$2,$3,$4,$5) RETURNING id', [vehicleId, started, dur, saved.bytes, saved.file])).rows[0];
  res.status(201).json({ id: row.id });
}));

// Playback through a short-lived signed link created by POST /api/admin/footage/:id/play (supports seeking).
router.get('/file/:id', wrap(async (req, res) => {
  if (!verify(F.signSecret, req.params.id, req.query.exp, req.query.sig)) throw E.forbidden('This link has expired. Open the clip again from the dashboard.');
  const c = (await db.query('SELECT file FROM footage WHERE id=$1', [req.params.id])).rows[0];
  if (!c) throw E.notFound('Clip not found');
  res.set({ 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.resolve(F.dir, c.file), { dotfiles: 'deny' }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: { message: 'Clip file is missing' } }); });
}));
module.exports = router;
