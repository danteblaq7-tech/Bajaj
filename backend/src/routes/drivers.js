const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const dispatch = require('../services/dispatch');
const E = require('../utils/errors');
const { wrap } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { issueTokens, requireAuth, requireRole, loadDriver } = require('../middleware/auth');

router.post('/login', validate({ phone: f.phone(), pin: f.pin() }), wrap(async (req, res) => {
  const u = (await db.query("SELECT u.*, d.status AS driver_status FROM users u JOIN drivers d ON d.user_id=u.id WHERE u.phone=$1 AND u.role='DRIVER'", [req.valid.phone])).rows[0];
  const ok = u && u.pin_hash && (await bcrypt.compare(req.valid.pin, u.pin_hash));
  if (!ok) throw E.unauthorized('Incorrect phone number or PIN');
  if (u.driver_status === 'SUSPENDED') throw E.forbidden('Your account is suspended. Contact Operations.');
  if (u.driver_status === 'PENDING') throw E.forbidden('Your account is awaiting approval.');
  res.json({ user: { id: u.id, name: u.name, phone: u.phone, role: u.role }, ...issueTokens(u) });
}));

router.use(requireAuth, requireRole('DRIVER'));

router.get('/me', loadDriver, wrap(async (req, res) => {
  const u = (await db.query('SELECT name, phone, profile_photo FROM users WHERE id=$1', [req.user.id])).rows[0];
  const d = req.driver;
  res.json({ driver: { id: d.id, ...u, status: d.status, rating: d.rating, total_trips: d.total_trips, tour_certified: d.tour_certified } });
}));

// Pre-shift checklist: every item needs a photo (or fuel litres), plus a selfie and the vehicle's dashboard QR code.
const PHOTOS = ['tires_photo', 'ac_photo', 'cleanliness_photo', 'camera_photo'];
router.post('/shifts/start', loadDriver, validate({ vehicle_qr: f.str({ max: 100 }), selfie_url: f.str({ max: 500 }), checklist: f.obj() }), wrap(async (req, res) => {
  const { vehicle_qr, selfie_url, checklist } = req.valid;
  const missing = PHOTOS.filter((k) => !checklist[k]);
  const fuel = Number(checklist.fuel_liters);
  if (!Number.isFinite(fuel) || fuel < 0) missing.push('fuel_liters');
  if (missing.length) throw E.badRequest('Checklist incomplete', { missing });
  if (req.driver.status !== 'ACTIVE') throw E.conflict(req.driver.status === 'ON_TRIP' ? 'Finish your current trip first' : 'You already have an open shift');
  const shift = await db.tx(async (c) => {
    const v = (await c.query('SELECT * FROM vehicles WHERE qr_code=$1 FOR UPDATE', [vehicle_qr])).rows[0];
    if (!v) throw E.badRequest('QR code not recognised. Contact the Operations Manager.');
    if (v.status !== 'OFFLINE') throw E.conflict(`This vehicle is ${v.status.toLowerCase()} and cannot be started`);
    const s = (await c.query(
      'INSERT INTO shifts(driver_id,vehicle_id,start_fuel,checklist,selfie_url) VALUES($1,$2,$3,$4,$5) RETURNING *', [req.driver.id, v.id, fuel, checklist, selfie_url])).rows[0];
    await c.query("UPDATE vehicles SET status='ONLINE' WHERE id=$1", [v.id]);
    await c.query("UPDATE drivers SET status='ONLINE' WHERE id=$1", [req.driver.id]);
    return { ...s, plate_number: v.plate_number };
  });
  res.status(201).json({ shift });
}));

router.post('/shifts/end', loadDriver, validate({ end_fuel: f.num({ min: 0 }), mileage: f.num({ min: 0 }), incident_note: opt(f.str({ max: 500 })) }), wrap(async (req, res) => {
  if (req.driver.status === 'ON_TRIP') throw E.conflict('Finish your current trip before ending your shift');
  await db.tx(async (c) => {
    const s = (await c.query("SELECT * FROM shifts WHERE driver_id=$1 AND status='OPEN' FOR UPDATE", [req.driver.id])).rows[0];
    if (!s) throw E.conflict('You have no open shift');
    await c.query("UPDATE shifts SET status='CLOSED', end_time=now(), end_fuel=$2, mileage=$3 WHERE id=$1", [s.id, req.valid.end_fuel, req.valid.mileage]);
    await c.query("UPDATE vehicles SET status='OFFLINE' WHERE id=$1", [s.vehicle_id]);
    await c.query("UPDATE drivers SET status='ACTIVE' WHERE id=$1", [req.driver.id]);
    if (req.valid.incident_note) await c.query('INSERT INTO incidents(driver_id,description,severity) VALUES($1,$2,$3)', [req.driver.id, req.valid.incident_note, 'LOW']);
  });
  res.json({ status: 'SHIFT_ENDED' });
}));

// Called every ~10 seconds while online. Points are stored only during a trip or parcel run.
router.post('/location', loadDriver, validate({ lat: f.lat(), lng: f.lng(), speed: opt(f.num({ min: 0, max: 200 })) }), wrap(async (req, res) => {
  const { lat, lng, speed } = req.valid;
  await db.query('UPDATE drivers SET last_lat=$2, last_lng=$3, last_seen_at=now(), gps_lost=false WHERE id=$1', [req.driver.id, lat, lng]);
  if (req.driver.status === 'ON_TRIP') {
    await db.query(
      `INSERT INTO gps_points(driver_id,booking_id,parcel_id,lat,lng,speed)
       VALUES($1,(SELECT id FROM bookings WHERE driver_id=$1 AND status IN ('ASSIGNED','IN_PROGRESS') LIMIT 1),
                (SELECT id FROM parcels WHERE driver_id=$1 AND status IN ('ASSIGNED','IN_TRANSIT') LIMIT 1),$2,$3,$4)`,
      [req.driver.id, lat, lng, speed || null]);
  }
  res.json({ ok: true });
}));

router.get('/offers/current', loadDriver, wrap(async (req, res) => {
  const o = (await db.query(
    `SELECT id, service_type, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, fare, passengers,
            GREATEST(0, EXTRACT(EPOCH FROM (offer_expires_at - now())))::int AS seconds_left
     FROM bookings WHERE offered_driver_id=$1 AND status='PAID' AND offer_expires_at>now()`, [req.driver.id])).rows[0];
  res.json({ offer: o || null });
}));
router.post('/offers/:id/accept', loadDriver, wrap(async (req, res) => { res.json(await dispatch.acceptOffer(req.driver, req.params.id)); }));
router.post('/offers/:id/decline', loadDriver, wrap(async (req, res) => { res.json(await dispatch.declineOffer(req.driver, req.params.id)); }));

// The trip or parcel run the driver is currently on (lets the app recover after a restart).
router.get('/trips/current', loadDriver, wrap(async (req, res) => {
  const b = (await db.query(
    `SELECT b.*, u.name AS customer_name, u.phone AS customer_phone FROM bookings b JOIN users u ON u.id=b.user_id
     WHERE b.driver_id=$1 AND b.status IN ('ASSIGNED','IN_PROGRESS') ORDER BY b.created_at LIMIT 1`, [req.driver.id])).rows[0];
  if (b) return res.json({ type: 'BOOKING', booking: b });
  const p = (await db.query(
    `SELECT id, tracking_id, status, recipient_name, recipient_phone, size, weight, description, pickup_address, pickup_lat, pickup_lng,
            dropoff_address, dropoff_lat, dropoff_lng, fare
     FROM parcels WHERE driver_id=$1 AND status IN ('ASSIGNED','IN_TRANSIT') ORDER BY created_at LIMIT 1`, [req.driver.id])).rows[0];
  res.json(p ? { type: 'PARCEL', parcel: p } : { type: null });
}));

router.get('/payouts', loadDriver, wrap(async (req, res) => {
  const r = await db.query('SELECT id, period_start, period_end, trips, net, status, receipt_ref, paid_at FROM payouts WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 20', [req.driver.id]);
  res.json({ payouts: r.rows });
}));

router.get('/earnings', loadDriver, wrap(async (req, res) => {
  const sum = async (table, dateCol, fareCol) => (await db.query(
    `SELECT COALESCE(SUM(${fareCol}) FILTER (WHERE ${dateCol}>=CURRENT_DATE),0) AS today,
            COALESCE(SUM(${fareCol}) FILTER (WHERE ${dateCol}>=date_trunc('week',now())),0) AS week,
            COALESCE(SUM(${fareCol}) FILTER (WHERE ${dateCol}>=date_trunc('month',now())),0) AS month,
            COALESCE(SUM(${fareCol}),0) AS total
     FROM ${table} WHERE driver_id=$1 AND status IN ('COMPLETED','DELIVERED')`, [req.driver.id])).rows[0];
  const a = await sum('bookings', 'completed_at', `CASE WHEN service_type='SUBSCRIPTION' THEN ${Number(config.payouts.subscriptionTripPay)} ELSE fare END`), b = await sum('parcels', 'delivered_at', 'fare');
  const net = (k) => +((a[k] + b[k]) * (1 - config.commission)).toFixed(2);
  res.json({ currency: 'KES', commission_rate: config.commission, today: net('today'), week: net('week'), month: net('month'), total: net('total') });
}));
module.exports = router;
