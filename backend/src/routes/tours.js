const router = require('express').Router();
const db = require('../db');
const E = require('../utils/errors');
const { wrap } = require('../utils/helpers');
const { validate, f } = require('../utils/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', wrap(async (req, res) => {
  res.json({ tours: (await db.query("SELECT id,name,description,stops,duration_hours,price FROM tours WHERE status='ACTIVE' ORDER BY price")).rows });
}));
router.get('/:id', wrap(async (req, res) => {
  const t = (await db.query("SELECT id,name,description,stops,duration_hours,price FROM tours WHERE id=$1 AND status='ACTIVE'", [req.params.id])).rows[0];
  if (!t) throw E.notFound('Tour not found');
  res.json({ tour: t });
}));

// Up to 3 passengers per tuktuk. Larger groups get extra tuktuks: one lead booking carries the total fare,
// the others share its group_id and are dispatched together once the lead booking is paid.
router.post('/:id/book', requireAuth, requireRole('CUSTOMER'), validate({
  pickup_address: f.str({ max: 200 }), pickup_lat: f.lat(), pickup_lng: f.lng(),
  scheduled_at: f.date(), passengers: f.num({ int: true, min: 1, max: 15 }),
}), wrap(async (req, res) => {
  const v = req.valid;
  const t = (await db.query("SELECT * FROM tours WHERE id=$1 AND status='ACTIVE'", [req.params.id])).rows[0];
  if (!t) throw E.notFound('Tour not found');
  if (new Date(v.scheduled_at).getTime() < Date.now() + 2 * 3600000) throw E.badRequest('Tours must be booked at least 2 hours ahead');
  const vehicles = Math.ceil(v.passengers / 3);
  const lead = await db.tx(async (c) => {
    const cols = '(user_id,service_type,tour_id,passengers,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng,fare,scheduled_at,group_id)';
    const first = (await c.query(
      `INSERT INTO bookings${cols} VALUES($1,'TOUR',$2,$3,$4,$5,$6,$4,$5,$6,$7,$8,NULL) RETURNING *`,
      [req.user.id, t.id, Math.min(3, v.passengers), v.pickup_address, v.pickup_lat, v.pickup_lng, t.price * vehicles, v.scheduled_at])).rows[0];
    for (let i = 1; i < vehicles; i++) {
      await c.query(
        `INSERT INTO bookings${cols} VALUES($1,'TOUR',$2,$3,$4,$5,$6,$4,$5,$6,0,$7,$8)`,
        [req.user.id, t.id, Math.min(3, v.passengers - 3 * i), v.pickup_address, v.pickup_lat, v.pickup_lng, v.scheduled_at, first.id]);
    }
    return first;
  });
  res.status(201).json({ booking: lead, tuktuks: vehicles, total_fare: lead.fare, message: 'Pay this booking to confirm your tour.' });
}));
module.exports = router;
