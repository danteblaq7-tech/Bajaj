const config = require('../config');
const P = config.pricing;
const R = Math.PI / 180;

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * R, dLng = (lng2 - lng1) * R;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}
const round10 = (n) => Math.ceil(n / 10) * 10;
const roadKm = (a, b) => haversineKm(a.lat, a.lng, b.lat, b.lng) * P.roadFactor;

// Fares are fixed and quoted up front: base + per km (straight-line distance scaled by a road factor).
function rideFare(a, b) {
  const km = roadKm(a, b);
  return { km: +km.toFixed(2), fare: Math.max(P.minFare, round10(P.baseFare + P.perKm * km)) };
}
function parcelFare(a, b, size) {
  const km = roadKm(a, b);
  return { km: +km.toFixed(2), fare: round10(P.parcelBase + P.parcelPerKm * km + (P.parcelSize[size] || 0)) };
}

const routing = require('./routing');
// Prefer real road distance (cached, so an estimate and the booking that follows give the same price); fall back to straight-line.
async function roadDistanceKm(a, b) {
  const hav = haversineKm(a.lat, a.lng, b.lat, b.lng);
  const km = hav >= 0.1 ? await routing.distanceKm(a, b) : null;
  return km == null ? hav * P.roadFactor : km;
}
async function rideQuote(a, b) {
  const km = await roadDistanceKm(a, b);
  return { km: +km.toFixed(2), fare: Math.max(P.minFare, round10(P.baseFare + P.perKm * km)) };
}
async function parcelQuote(a, b, size) {
  const km = await roadDistanceKm(a, b);
  return { km: +km.toFixed(2), fare: round10(P.parcelBase + P.parcelPerKm * km + (P.parcelSize[size] || 0)) };
}
module.exports = { haversineKm, rideFare, parcelFare, rideQuote, parcelQuote };
