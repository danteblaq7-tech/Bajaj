const router = require('express').Router();
const db = require('../db');
const config = require('../config');
const pricing = require('../services/pricing');
const payments = require('../services/payments');
const dispatch = require('../services/dispatch');
const notify = require('../services/notify');
const E = require('../utils/errors');
const { wrap } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { requireAuth, requireRole, loadDriver } = require('../middleware/auth');

const STAFF = ['ADMIN', 'OPS'];
const createSchema = {
  service_type: f.oneOf(['RIDE', 'SUBSCRIPTION']),
  pickup_address: f.str({ max: 200 }), pickup_lat: f.lat(), pickup_lng: f.lng(),
  dropoff_address: f.str({ max: 200 }), dropoff_lat: f.lat(), dropoff_lng: f.lng(),
  passengers: opt(f.num({ int: true, min: 1, max: 3 })), scheduled_at: opt(f.date()), subscription_id: opt(f.uuid()),
};

async function quote(b) {
  const q = await pricing.rideQuote({ lat: b.pickup_lat, lng: b.pickup_lng }, { lat: b.dropoff_lat, lng: b.dropoff_lng });
  if (q.km < 0.1) throw E.badRequest('Pickup and drop-off are the same place');
  if (q.km > config.pricing.maxKm) throw E.badRequest(`Trips longer than ${config.pricing.maxKm} km are not supported`);
  return q;
}
function checkSchedule(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (t < Date.now() + 10 * 60000) throw E.badRequest('Scheduled time must be at least 10 minutes from now');
  if (t > Date.now() + 60 * 86400000) throw E.badRequest('Bookings can be made up to 60 days ahead');
  return iso;
}

router.post('/estimate', requireAuth, validate(createSchema), wrap(async (req, res) => {
  const q = await quote(req.valid);
  res.json({ distance_km: q.km, fare: req.valid.service_type === 'SUBSCRIPTION' ? 0 : q.fare, currency: 'KES' });
}));

router.post('/', requireAuth, requireRole('CUSTOMER'), validate(createSchema), wrap(async (req, res) => {
  const b = req.valid, q = await quote(b), sched = checkSchedule(b.scheduled_at);
  let fare = q.fare, status = 'PENDING', subId = null;
  if (b.service_type === 'SUBSCRIPTION') {
    if (!b.subscription_id) throw E.badRequest('Invalid input', { subscription_id: 'is required' });
    const s = (await db.query(
      `SELECT id FROM subscriptions WHERE id=$1 AND user_id=$2 AND status IN ('ACTIVE','GRACE')`, [b.subscription_id, req.user.id])).rows[0];
    if (!s) throw E.forbidden('No active subscription found for this account');
    fare = 0; status = 'PAID'; subId = s.id; // covered by the subscription: no payment step
  }
  const row = (await db.query(
    `INSERT INTO bookings(user_id,service_type,subscription_id,passengers,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,fare,status,scheduled_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.user.id, b.service_type, subId, b.passengers || 1, b.pickup_address, b.pickup_lat, b.pickup_lng, b.dropoff_address, b.dropoff_lat, b.dropoff_lng, fare, status, sched])).rows[0];
  if (status === 'PAID') dispatch.dispatchBooking(row.id).catch((e) => console.error('[dispatch]', e.message));
  res.status(201).json({ booking: row, distance_km: q.km });
}));

router.get('/:id', requireAuth, wrap(async (req, res) => {
  const b = (await db.query('SELECT * FROM bookings WHERE id=$1', [req.params.id])).rows[0];
  if (!b) throw E.notFound('Booking not found');
  let allowed = b.user_id === req.user.id || STAFF.includes(req.user.role);
  let driver = null;
  if (b.driver_id) {
    const d = (await db.query(
      `SELECT d.id, d.user_id, d.rating, d.last_lat, d.last_lng, d.last_seen_at, d.gps_lost, u.name, u.profile_photo, v.plate_number
       FROM drivers d JOIN users u ON u.id=d.user_id LEFT JOIN vehicles v ON v.id=$2 WHERE d.id=$1`, [b.driver_id, b.vehicle_id])).rows[0];
    if (d && d.user_id === req.user.id) allowed = true;
    if (d) {
      const stale = !d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > config.dispatch.staleLocSec * 1000;
      const target = b.status === 'ASSIGNED' ? { lat: b.pickup_lat, lng: b.pickup_lng } : { lat: b.dropoff_lat, lng: b.dropoff_lng };
      const km = d.last_lat == null ? null : pricing.haversineKm(d.last_lat, d.last_lng, target.lat, target.lng);
      driver = {
        name: d.name, photo: d.profile_photo, plate: d.plate_number, rating: d.rating,
        location: d.last_lat == null ? null : { lat: d.last_lat, lng: d.last_lng, at: d.last_seen_at, estimated: stale || d.gps_lost },
        eta_min: km == null ? null : Math.max(1, Math.round((km / 20) * 60)),
      };
    }
  }
  if (!allowed) throw E.forbidden('This booking belongs to another account');
  res.json({ booking: b, driver });
}));

router.post('/:id/pay', requireAuth, validate({ method: opt(f.oneOf(['MPESA', 'WALLET', 'CARD'])), phone: opt(f.phone()) }), wrap(async (req, res) => {
  const out = await payments.initiate(req.user, { purpose: 'BOOKING', targetId: req.params.id, method: req.valid.method || 'MPESA', phone: req.valid.phone });
  res.status(202).json(out);
}));

router.post('/:id/cancel', requireAuth, wrap(async (req, res) => {
  await db.tx(async (c) => {
    const b = (await c.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!b) throw E.notFound('Booking not found');
    if (b.user_id !== req.user.id && !STAFF.includes(req.user.role)) throw E.forbidden('This booking belongs to another account');
    if (!['PENDING', 'PAID', 'ASSIGNED'].includes(b.status)) throw E.conflict(`A ${b.status.toLowerCase().replace('_', ' ')} booking cannot be cancelled`);
    const kids = (await c.query('SELECT driver_id, vehicle_id FROM bookings WHERE group_id=$1 AND driver_id IS NOT NULL', [b.id])).rows;
    await c.query("UPDATE bookings SET status='CANCELLED', cancelled_at=now(), offered_driver_id=NULL, offer_expires_at=NULL WHERE id=$1 OR group_id=$1", [b.id]);
    if (b.driver_id) await dispatch.releaseDriver(c, b.driver_id, b.vehicle_id);
    for (const k of kids) await dispatch.releaseDriver(c, k.driver_id, k.vehicle_id);
    // Placeholder policy: full refund to the wallet for anything cancelled before the trip starts.
    if (b.fare > 0 && b.status !== 'PENDING') await payments.refundToWallet(c, b.user_id, b.fare, b.id);
  });
  res.json({ status: 'CANCELLED' });
}));

router.post('/:id/rate', requireAuth, validate({ stars: f.num({ int: true, min: 1, max: 5 }), comment: opt(f.str({ max: 500 })) }), wrap(async (req, res) => {
  await db.tx(async (c) => {
    const b = (await c.query('SELECT * FROM bookings WHERE id=$1', [req.params.id])).rows[0];
    if (!b) throw E.notFound('Booking not found');
    if (b.user_id !== req.user.id) throw E.forbidden('Only the rider can rate this trip');
    if (b.status !== 'COMPLETED' || !b.driver_id) throw E.conflict('You can rate a trip once it is completed');
    await c.query('INSERT INTO ratings(user_id,driver_id,booking_id,stars,comment) VALUES($1,$2,$3,$4,$5)', [req.user.id, b.driver_id, b.id, req.valid.stars, req.valid.comment || null]);
    await c.query('UPDATE drivers SET rating=(SELECT ROUND(AVG(stars)::numeric,2) FROM ratings WHERE driver_id=$1) WHERE id=$1', [b.driver_id]);
  });
  res.status(201).json({ message: 'Thanks for your feedback' });
}));

// ---- driver actions on a trip ----
router.post('/:id/start', requireAuth, requireRole('DRIVER'), loadDriver, wrap(async (req, res) => {
  const r = await db.query(
    `UPDATE bookings SET status='IN_PROGRESS', started_at=now() WHERE id=$1 AND driver_id=$2 AND status='ASSIGNED' RETURNING user_id`, [req.params.id, req.driver.id]);
  if (!r.rowCount) throw E.conflict('This trip is not assigned to you, or has already started');
  const u = (await db.query('SELECT emergency_contact_phone, name FROM users WHERE id=$1', [r.rows[0].user_id])).rows[0];
  if (u.emergency_contact_phone) notify.sms(u.emergency_contact_phone, `${u.name || 'Your contact'} has started a Pwani Ride trip. / ${u.name || 'Mwenzako'} ameanza safari ya Pwani Ride.`);
  res.json({ status: 'IN_PROGRESS' });
}));

router.post('/:id/complete', requireAuth, requireRole('DRIVER'), loadDriver, wrap(async (req, res) => {
  const b = await db.tx(async (c) => {
    const row = (await c.query("SELECT * FROM bookings WHERE id=$1 AND driver_id=$2 AND status='IN_PROGRESS' FOR UPDATE", [req.params.id, req.driver.id])).rows[0];
    if (!row) throw E.conflict('This trip is not in progress or is not yours');
    await c.query("UPDATE bookings SET status='COMPLETED', completed_at=now() WHERE id=$1", [row.id]);
    await c.query('UPDATE drivers SET total_trips=total_trips+1 WHERE id=$1', [req.driver.id]);
    await dispatch.releaseDriver(c, req.driver.id, row.vehicle_id);
    return row;
  });
  notify.toUser(b.user_id, 'Trip complete', `Thanks for riding with Pwani Ride. Fare: KES ${b.fare}. Please rate your driver.`, { sms: b.fare > 0, type: 'RATE_PROMPT', booking_id: b.id });
  res.json({ status: 'COMPLETED', earnings: +(b.fare * (1 - config.commission)).toFixed(2) });
}));
module.exports = router;
