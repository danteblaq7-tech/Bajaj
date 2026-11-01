// Driving routes for the map and for fares. Provider: OSRM (default; the public demo server is for testing only,
// self-host it or use OpenRouteService for production) or Google Directions (set ROUTING_PROVIDER=google and a server key).
const config = require('../config');
const R = config.routing;
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;
const key = (a, b) => [a.lat, a.lng, b.lat, b.lng].map((n) => Number(n).toFixed(4)).join(',');

// Google/OSRM "encoded polyline" to [{lat,lng}]
function decode(str, precision = 5) {
  const f = 10 ** precision;
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    pts.push({ lat: lat / f, lng: lng / f });
  }
  return pts;
}
function thin(points, max = 250) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
async function osrm(a, b) {
  const url = `${R.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=polyline`;
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'PwaniRide/0.1' } });
  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error('OSRM: no route');
  const rt = j.routes[0];
  return { points: decode(rt.geometry), distance_m: rt.distance, duration_s: rt.duration };
}
async function google(a, b) {
  if (!R.googleKey) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set');
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&mode=driving&key=${R.googleKey}`;
  const j = await (await fetch(url, { signal: AbortSignal.timeout(4000) })).json();
  if (j.status !== 'OK' || !j.routes[0]) throw new Error(`Directions: ${j.status}`);
  const legs = j.routes[0].legs;
  return {
    points: decode(j.routes[0].overview_polyline.points),
    distance_m: legs.reduce((s, l) => s + l.distance.value, 0),
    duration_s: legs.reduce((s, l) => s + l.duration.value, 0),
  };
}
async function route(a, b) {
  const k = key(a, b), hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const raw = R.provider === 'google' ? await google(a, b) : await osrm(a, b);
  const value = { ...raw, points: thin(raw.points) };
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(k, { at: Date.now(), value });
  return value;
}
// Road distance in km, or null if routing is unavailable (callers fall back to straight-line distance).
async function distanceKm(a, b) {
  try { return (await route(a, b)).distance_m / 1000; } catch (e) { return null; }
}
module.exports = { route, distanceKm, decode, thin };
