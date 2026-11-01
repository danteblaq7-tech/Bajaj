const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const pricing = require('../services/pricing');
const dispatch = require('../services/dispatch');
const notify = require('../services/notify');
const E = require('../utils/errors');
const { wrap, sha, safeEq, digits } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { requireAuth, requireRole, loadDriver } = require('../middleware/auth');

const trackingId = () => 'PR' + crypto.randomBytes(4).toString('hex').toUpperCase();

router.post('/', requireAuth, requireRole('CUSTOMER'), validate({
  recipient_name: f.str({ min: 2, max: 80 }), recipient_phone: f.phone(),
  weight: f.num({ min: 0.1, max: 30 }), size: f.oneOf(['SMALL', 'MEDIUM', 'LARGE']), description: opt(f.str({ max: 300 })),
  pickup_address: f.str({ max: 200 }), pickup_lat: f.lat(), pickup_lng: f.lng(),
  dropoff_address: f.str({ max: 200 }), dropoff_lat: f.lat(), dropoff_lng: f.lng(),
}), wrap(async (req, res) => {
  const v = req.valid;
  const q = await pricing.parcelQuote({ lat: v.pickup_lat, lng: v.pickup_lng }, { lat: v.dropoff_lat, lng: v.dropoff_lng }, v.size);
  const p = (await db.query(
    `INSERT INTO parcels(sender_id,tracking_id,recipient_name,recipient_phone,weight,size,description,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,fare)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,tracking_id,status,fare`,
    [req.user.id, trackingId(), v.recipient_name, v.recipient_phone, v.weight, v.size, v.description || null, v.pickup_address, v.pickup_lat, v.pickup_lng, v.dropoff_address, v.dropoff_lat, v.dropoff_lng, q.fare])).rows[0];
  res.status(201).json({ parcel: p, distance_km: q.km, message: 'Pay with POST /api/payments/mpesa/stkpush { "parcel_id": ... } to dispatch a driver.' });
}));

router.get('/', requireAuth, wrap(async (req, res) => {
  res.json({ parcels: (await db.query('SELECT id,tracking_id,status,fare,recipient_name,created_at,delivered_at FROM parcels WHERE sender_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id])).rows });
}));

// Public tracking: only non-sensitive fields, no addresses or phone numbers.
router.get('/:tracking_id', wrap(async (req, res) => {
  const p = (await db.query(
    `SELECT p.tracking_id, p.status, p.picked_up_at, p.delivered_at, p.created_at, d.last_lat, d.last_lng, d.last_seen_at
     FROM parcels p LEFT JOIN drivers d ON d.id=p.driver_id WHERE p.tracking_id=$1`, [req.params.tracking_id.toUpperCase()])).rows[0];
  if (!p) throw E.notFound('No parcel with that tracking ID');
  const live = p.status === 'IN_TRANSIT' && p.last_lat != null;
  res.json({ tracking_id: p.tracking_id, status: p.status, picked_up_at: p.picked_up_at, delivered_at: p.delivered_at,
    location: live ? { lat: p.last_lat, lng: p.last_lng, at: p.last_seen_at } : null });
}));

router.post('/:id/pickup', requireAuth, requireRole('DRIVER'), loadDriver, validate({ photo_url: f.str({ max: 500 }) }), wrap(async (req, res) => {
  const code = digits(4);
  const r = await db.query(
    `UPDATE parcels SET status='IN_TRANSIT', picked_up_at=now(), pickup_photo=$3, delivery_code_hash=$4
     WHERE id=$1 AND driver_id=$2 AND status='ASSIGNED' RETURNING tracking_id, recipient_phone, sender_id`,
    [req.params.id, req.driver.id, req.valid.photo_url, sha(code)]);
  if (!r.rowCount) throw E.conflict('This parcel is not assigned to you, or was already collected');
  const p = r.rows[0];
  notify.sms(p.recipient_phone, `Parcel ${p.tracking_id} is on its way. Give the driver code ${code} when it arrives. / Kifurushi ${p.tracking_id} kiko njiani. Mpe dereva nambari ${code} kinapofika.`);
  notify.toUser(p.sender_id, 'Parcel collected', `Parcel ${p.tracking_id} is in transit.`);
  res.json({ status: 'IN_TRANSIT' });
}));

router.post('/:id/deliver', requireAuth, requireRole('DRIVER'), loadDriver, validate({ otp: f.str({ min: 4, max: 4 }), photo_url: f.str({ max: 500 }) }), wrap(async (req, res) => {
  const out = await db.tx(async (c) => {
    const p = (await c.query("SELECT * FROM parcels WHERE id=$1 AND driver_id=$2 AND status='IN_TRANSIT' FOR UPDATE", [req.params.id, req.driver.id])).rows[0];
    if (!p) throw E.conflict('This parcel is not in transit with you');
    if (p.delivery_attempts >= 5) throw E.forbidden('Too many wrong codes. Contact the sender for verification.');
    if (!safeEq(sha(req.valid.otp), p.delivery_code_hash)) {
      await c.query('UPDATE parcels SET delivery_attempts=delivery_attempts+1 WHERE id=$1', [p.id]);
      return { wrong: true };
    }
    await c.query("UPDATE parcels SET status='DELIVERED', delivered_at=now(), delivery_photo=$2 WHERE id=$1", [p.id, req.valid.photo_url]);
    await dispatch.releaseDriver(c, req.driver.id, null);
    return { p };
  });
  if (out.wrong) throw E.badRequest('Incorrect delivery code. Ask the recipient again or contact the sender.');
  notify.toUser(out.p.sender_id, 'Parcel delivered', `Parcel ${out.p.tracking_id} was delivered to ${out.p.recipient_name}.`, { sms: true });
  res.json({ status: 'DELIVERED' });
}));
module.exports = router;
