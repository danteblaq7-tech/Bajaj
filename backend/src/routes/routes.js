const router = require('express').Router();
const routing = require('../services/routing');
const E = require('../utils/errors');
const { wrap } = require('../utils/helpers');
const { validate, f } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');

// GET /api/routes?from_lat=&from_lng=&to_lat=&to_lng=  ->  { points: [{lat,lng}], distance_km, duration_min }
router.get('/', requireAuth, validate({ from_lat: f.lat(), from_lng: f.lng(), to_lat: f.lat(), to_lng: f.lng() }, 'query'), wrap(async (req, res) => {
  const v = req.valid;
  try {
    const r = await routing.route({ lat: v.from_lat, lng: v.from_lng }, { lat: v.to_lat, lng: v.to_lng });
    res.json({ points: r.points, distance_km: +(r.distance_m / 1000).toFixed(2), duration_min: Math.max(1, Math.round(r.duration_s / 60)) });
  } catch (e) { throw E.unavailable('Route unavailable right now'); }
}));
module.exports = router;
