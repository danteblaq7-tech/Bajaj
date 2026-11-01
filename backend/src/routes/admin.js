const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const notify = require('../services/notify');
const payouts = require('../services/payouts');
const footage = require('../services/footage');
const crypto = require('crypto');
const { sha } = require('../utils/helpers');
const { sign } = require('../utils/sign');
const E = require('../utils/errors');
const { wrap } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('ADMIN', 'OPS'));

// ---- fleet ----
router.get('/fleet/live', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT v.id, v.plate_number, v.model, v.status, d.id AS driver_id, u.name AS driver_name,
            d.last_lat, d.last_lng, d.last_seen_at, d.gps_lost
     FROM vehicles v LEFT JOIN shifts s ON s.vehicle_id=v.id AND s.status='OPEN'
     LEFT JOIN drivers d ON d.id=s.driver_id LEFT JOIN users u ON u.id=d.user_id ORDER BY v.plate_number`);
  res.json({ vehicles: r.rows });
}));
router.post('/vehicles', validate({ plate_number: f.str({ max: 20 }), model: opt(f.str({ max: 60 })), year: opt(f.num({ int: true, min: 2000, max: 2100 })), qr_code: f.str({ min: 4, max: 60 }) }), wrap(async (req, res) => {
  const v = req.valid;
  const r = await db.query('INSERT INTO vehicles(plate_number,model,year,qr_code) VALUES($1,$2,$3,$4) RETURNING *', [v.plate_number.toUpperCase(), v.model || null, v.year || null, v.qr_code]);
  res.status(201).json({ vehicle: r.rows[0] });
}));
router.post('/vehicles/:id/disable', wrap(async (req, res) => {
  const r = await db.query("UPDATE vehicles SET status='DISABLED' WHERE id=$1 AND status IN ('OFFLINE','ONLINE','MAINTENANCE') RETURNING id", [req.params.id]);
  if (!r.rowCount) throw E.conflict('Vehicle not found or currently on a trip');
  res.json({ status: 'DISABLED' });
}));

// Recent shifts with checklist photos and selfie (so Operations can review vehicle condition).
router.get('/shifts', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT s.id, s.start_time, s.end_time, s.start_fuel, s.end_fuel, s.mileage, s.status, s.checklist, s.selfie_url,
            u.name AS driver_name, v.plate_number
     FROM shifts s JOIN drivers d ON d.id=s.driver_id JOIN users u ON u.id=d.user_id JOIN vehicles v ON v.id=s.vehicle_id
     ORDER BY s.start_time DESC LIMIT 30`);
  res.json({ shifts: r.rows });
}));

// ---- drivers ----
router.get('/drivers', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT d.id, u.name, u.phone, d.status, d.rating, d.total_trips, d.tour_certified, d.last_seen_at,
       COALESCE((SELECT SUM(CASE WHEN b.service_type='SUBSCRIPTION' THEN ${Number(config.payouts.subscriptionTripPay)} ELSE b.fare END) FROM bookings b WHERE b.driver_id=d.id AND b.status='COMPLETED'),0)
     + COALESCE((SELECT SUM(fare) FROM parcels p WHERE p.driver_id=d.id AND p.status='DELIVERED'),0) AS gross
     FROM drivers d JOIN users u ON u.id=d.user_id ORDER BY u.name`);
  res.json({ drivers: r.rows.map(({ gross, ...d }) => ({ ...d, earnings: +(gross * (1 - config.commission)).toFixed(2) })) });
}));

router.post('/drivers', validate({
  phone: f.phone(), name: f.str({ min: 2, max: 80 }), pin: f.pin(), license_number: f.str({ max: 40 }), badge_number: f.str({ max: 40 }),
}), wrap(async (req, res) => {
  const v = req.valid;
  const out = await db.tx(async (c) => {
    const u = (await c.query("INSERT INTO users(phone,name,pin_hash,role) VALUES($1,$2,$3,'DRIVER') RETURNING id", [v.phone, v.name, await bcrypt.hash(v.pin, 10)])).rows[0];
    return (await c.query('INSERT INTO drivers(user_id,license_number,badge_number) VALUES($1,$2,$3) RETURNING *', [u.id, v.license_number, v.badge_number])).rows[0];
  });
  res.status(201).json({ driver: out, message: 'Driver created and awaiting approval' });
}));

router.post('/drivers/:id/approve', wrap(async (req, res) => {
  const r = await db.query("UPDATE drivers SET status='ACTIVE' WHERE id=$1 AND status IN ('PENDING','SUSPENDED') RETURNING user_id", [req.params.id]);
  if (!r.rowCount) throw E.conflict('Driver not found or already active');
  notify.toUser(r.rows[0].user_id, 'Account approved', 'Your driver account is active. You can start a shift.', { sms: true });
  res.json({ status: 'ACTIVE' });
}));

async function suspendDriver(c, id) {
  const d = (await c.query('SELECT * FROM drivers WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!d) throw E.notFound('Driver not found');
  if (d.status === 'ON_TRIP') throw E.conflict('Driver is on a trip. Suspend after the trip ends.');
  const s = (await c.query("UPDATE shifts SET status='CLOSED', end_time=now() WHERE driver_id=$1 AND status='OPEN' RETURNING vehicle_id", [id])).rows[0];
  if (s) await c.query("UPDATE vehicles SET status='OFFLINE' WHERE id=$1 AND status='ONLINE'", [s.vehicle_id]);
  await c.query("UPDATE drivers SET status='SUSPENDED' WHERE id=$1", [id]);
  return d.user_id;
}
router.post('/drivers/:id/suspend', wrap(async (req, res) => {
  const userId = await db.tx((c) => suspendDriver(c, req.params.id));
  notify.toUser(userId, 'Account suspended', 'Your driver account was suspended. Contact Operations.', { sms: true });
  res.json({ status: 'SUSPENDED' });
}));
router.post('/drivers/:id/training', validate({ tour_certified: f.bool() }), wrap(async (req, res) => {
  const r = await db.query('UPDATE drivers SET tour_certified=$2 WHERE id=$1 RETURNING id', [req.params.id, req.valid.tour_certified]);
  if (!r.rowCount) throw E.notFound('Driver not found');
  res.json({ tour_certified: req.valid.tour_certified });
}));

// ---- revenue ----
router.get('/reports/revenue', validate({ from: opt(f.date()), to: opt(f.date()) }, 'query'), wrap(async (req, res) => {
  const to = req.valid.to || new Date().toISOString();
  const from = req.valid.from || new Date(Date.now() - 7 * 86400000).toISOString();
  const r = await db.query(
    `SELECT date_trunc('day', p.created_at)::date AS day,
       CASE p.purpose WHEN 'BOOKING' THEN CASE b.service_type WHEN 'TOUR' THEN 'TOURS' ELSE 'RIDES' END
         WHEN 'PARCEL' THEN 'PARCELS' WHEN 'INVOICE' THEN 'SUBSCRIPTIONS' END AS stream,
       SUM(p.amount) AS total, COUNT(*) AS payments
     FROM payments p LEFT JOIN bookings b ON b.id=p.booking_id
     WHERE p.status='SUCCESS' AND NOT p.refunded AND p.purpose<>'WALLET_TOPUP' AND p.created_at>=$1 AND p.created_at<$2
     GROUP BY 1,2 ORDER BY 1,2`, [from, to]);
  const totals = {};
  for (const row of r.rows) totals[row.stream] = (totals[row.stream] || 0) + row.total;
  res.json({ from, to, currency: 'KES', daily: r.rows, totals });
}));

// ---- incidents ----
router.get('/incidents', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT i.*, u.name AS driver_name FROM incidents i LEFT JOIN drivers d ON d.id=i.driver_id LEFT JOIN users u ON u.id=d.user_id
     ORDER BY (i.status='OPEN') DESC, i.created_at DESC LIMIT 100`);
  res.json({ incidents: r.rows });
}));
router.post('/incidents', validate({ driver_id: f.uuid(), booking_id: opt(f.uuid()), description: f.str({ max: 500 }), severity: f.oneOf(['LOW', 'MEDIUM', 'HIGH']), evidence_url: opt(f.str({ max: 500 })) }), wrap(async (req, res) => {
  const v = req.valid;
  const r = await db.query('INSERT INTO incidents(driver_id,booking_id,description,severity,evidence_url) VALUES($1,$2,$3,$4,$5) RETURNING *', [v.driver_id, v.booking_id || null, v.description, v.severity, v.evidence_url || null]);
  footage.holdForIncident(r.rows[0].id).catch(() => {}); // keep camera clips around the incident past normal retention
  res.status(201).json({ incident: r.rows[0] });
}));
router.post('/incidents/:id/resolve', validate({ action: f.oneOf(['WARNING', 'SUSPENSION', 'DISMISS']) }), wrap(async (req, res) => {
  let notifyUser = null, text = '';
  await db.tx(async (c) => {
    const i = (await c.query("SELECT * FROM incidents WHERE id=$1 AND status='OPEN' FOR UPDATE", [req.params.id])).rows[0];
    if (!i) throw E.conflict('Incident not found or already closed');
    if (req.valid.action === 'SUSPENSION') { notifyUser = await suspendDriver(c, i.driver_id); text = 'Your account was suspended after an incident review.'; }
    if (req.valid.action === 'WARNING') {
      notifyUser = (await c.query('SELECT user_id FROM drivers WHERE id=$1', [i.driver_id])).rows[0].user_id;
      text = 'You have received a formal warning after an incident review.';
    }
    await c.query("UPDATE incidents SET status='CLOSED', resolution=$2 WHERE id=$1", [i.id, req.valid.action]);
  });
  if (notifyUser) notify.toUser(notifyUser, 'Incident outcome', text, { sms: true });
  res.json({ status: 'CLOSED', resolution: req.valid.action });
}));

// ---- maintenance ----
router.get('/maintenance', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT m.*, v.plate_number FROM maintenance_tickets m JOIN vehicles v ON v.id=m.vehicle_id
     ORDER BY (m.status='DONE'), CASE m.priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, m.created_at DESC`);
  res.json({ tickets: r.rows });
}));
router.post('/maintenance', validate({ vehicle_id: f.uuid(), description: f.str({ max: 500 }), priority: opt(f.oneOf(['LOW', 'MEDIUM', 'HIGH'])) }), wrap(async (req, res) => {
  const v = req.valid;
  const t = await db.tx(async (c) => {
    const row = (await c.query('INSERT INTO maintenance_tickets(vehicle_id,description,priority) VALUES($1,$2,$3) RETURNING *', [v.vehicle_id, v.description, v.priority || 'MEDIUM'])).rows[0];
    if (v.priority === 'HIGH') await c.query("UPDATE vehicles SET status='MAINTENANCE' WHERE id=$1 AND status='OFFLINE'", [v.vehicle_id]);
    return row;
  });
  res.status(201).json({ ticket: t });
}));
router.patch('/maintenance/:id', validate({ status: opt(f.oneOf(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE'])), assigned_to: opt(f.str({ max: 80 })) }), wrap(async (req, res) => {
  const v = req.valid;
  const t = await db.tx(async (c) => {
    const row = (await c.query(
      `UPDATE maintenance_tickets SET status=COALESCE($2,status), assigned_to=COALESCE($3,assigned_to),
         resolved_at=CASE WHEN $2='DONE' THEN now() ELSE resolved_at END WHERE id=$1 RETURNING *`, [req.params.id, v.status || null, v.assigned_to || null])).rows[0];
    if (!row) throw E.notFound('Ticket not found');
    if (row.status === 'DONE') await c.query("UPDATE vehicles SET status='OFFLINE', last_maintenance=now() WHERE id=$1 AND status='MAINTENANCE'", [row.vehicle_id]);
    return row;
  });
  res.json({ ticket: t });
}));
// ---- driver payouts (ADMIN only: money moves) ----
router.get('/payouts', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT p.*, u.name AS driver_name, u.phone FROM payouts p JOIN drivers d ON d.id=p.driver_id JOIN users u ON u.id=d.user_id
     ORDER BY (p.status IN ('PENDING','PROCESSING','FAILED')) DESC, p.created_at DESC LIMIT 150`);
  res.json({ payouts: r.rows });
}));
router.post('/payouts/generate', requireRole('ADMIN'), wrap(async (req, res) => {
  const until = !config.prod && req.body && req.body.until ? new Date(req.body.until) : undefined; // development only: lets tests include this week's work
  res.json({ created: (await payouts.generate(until)).length });
}));
router.post('/payouts/:id/approve', requireRole('ADMIN'), wrap(async (req, res) => { res.json(await payouts.approve(req.params.id, req.user.id)); }));
router.post('/payouts/:id/cancel', requireRole('ADMIN'), wrap(async (req, res) => { await payouts.cancel(req.params.id); res.json({ status: 'CANCELLED' }); }));

// ---- camera footage ----
const logAccess = (userId, footageId, action) => db.query('INSERT INTO footage_access(user_id,footage_id,action) VALUES($1,$2,$3)', [userId, footageId, action]);
router.get('/footage', validate({ vehicle_id: opt(f.uuid()), from: opt(f.date()), to: opt(f.date()) }, 'query'), wrap(async (req, res) => {
  const v = req.valid;
  const r = await db.query(
    `SELECT f.id, f.vehicle_id, vh.plate_number, f.started_at, f.duration_s, f.bytes, f.hold FROM footage f JOIN vehicles vh ON vh.id=f.vehicle_id
     WHERE ($1::uuid IS NULL OR f.vehicle_id=$1) AND f.started_at>=$2 AND f.started_at<$3 ORDER BY f.started_at DESC LIMIT 200`,
    [v.vehicle_id || null, v.from || new Date(Date.now() - 7 * 86400000).toISOString(), v.to || new Date(Date.now() + 86400000).toISOString()]);
  res.json({ clips: r.rows, retention_days: config.footage.retentionDays });
}));
router.post('/footage/:id/play', wrap(async (req, res) => {
  const c = (await db.query('SELECT id FROM footage WHERE id=$1', [req.params.id])).rows[0];
  if (!c) throw E.notFound('Clip not found');
  await logAccess(req.user.id, c.id, 'PLAY'); // every viewing is recorded
  const { exp, sig } = sign(config.footage.signSecret, c.id, 300);
  res.json({ url: `/api/footage/file/${c.id}?exp=${exp}&sig=${sig}`, expires_in: 300 });
}));
router.post('/footage/:id/hold', validate({ hold: f.bool() }), wrap(async (req, res) => {
  const r = await db.query('UPDATE footage SET hold=$2 WHERE id=$1 RETURNING id', [req.params.id, req.valid.hold]);
  if (!r.rowCount) throw E.notFound('Clip not found');
  await logAccess(req.user.id, req.params.id, req.valid.hold ? 'HOLD' : 'RELEASE');
  res.json({ hold: req.valid.hold });
}));
router.get('/incidents/:id/footage', wrap(async (req, res) => { res.json({ clips: await footage.clipsForIncident(req.params.id) }); }));
// Shown once. Put it in the camera or gateway's settings; it cannot be recovered, only replaced.
router.post('/vehicles/:id/camera-key', requireRole('ADMIN'), wrap(async (req, res) => {
  const key = crypto.randomBytes(24).toString('hex');
  const r = await db.query('UPDATE vehicles SET camera_key_hash=$2 WHERE id=$1 RETURNING id', [req.params.id, sha(key)]);
  if (!r.rowCount) throw E.notFound('Vehicle not found');
  await logAccess(req.user.id, null, 'CAMERA_KEY');
  res.json({ vehicle_id: r.rows[0].id, camera_key: key, note: 'Copy this now. It will not be shown again.' });
}));

module.exports = router;
