// Dispatch engine: offers a paid booking to the best driver, one at a time, with a response deadline.
const db = require('../db');
const config = require('../config');
const notify = require('./notify');
const E = require('../utils/errors');
const { haversineKm } = require('./pricing');
const D = config.dispatch;

// Rank: closest first (in 0.5 km steps), then higher rating, then fewer trips today.
const rank = (rows, lat, lng) => rows
  .map((r) => ({ ...r, km: haversineKm(lat, lng, r.last_lat, r.last_lng) }))
  .filter((r) => r.km <= D.radiusKm)
  .sort((a, b) => Math.round(a.km * 2) - Math.round(b.km * 2) || b.rating - a.rating || a.load - b.load);

async function candidates(q, lat, lng, excluded, tourOnly) {
  const r = await q.query(
    `SELECT d.id, d.user_id, d.rating, d.last_lat, d.last_lng,
            (SELECT COUNT(*) FROM bookings b WHERE b.driver_id=d.id AND b.completed_at>=CURRENT_DATE) AS load
     FROM drivers d
     WHERE d.status='ONLINE' AND d.last_lat IS NOT NULL AND d.last_seen_at > now()-make_interval(secs=>$1)
       AND NOT (d.id = ANY($2::uuid[])) AND ($3 = false OR d.tour_certified)
       AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.offered_driver_id=d.id AND o.offer_expires_at>now())`,
    [D.staleLocSec, excluded, tourOnly]);
  return rank(r.rows, lat, lng);
}

async function dispatchBooking(id) {
  let after = null;
  await db.tx(async (c) => {
    const b = (await c.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!b || b.status !== 'PAID' || b.driver_id) return;
    if (b.offered_driver_id && new Date(b.offer_expires_at) > new Date()) return; // an offer is still live
    if (b.scheduled_at && new Date(b.scheduled_at).getTime() > Date.now() + D.scheduledLeadMin * 60000) return; // not due yet
    // An expired offer counts as "no response": move on to the next driver.
    const declined = b.offered_driver_id ? [...b.declined_driver_ids, b.offered_driver_id] : b.declined_driver_ids;
    const list = await candidates(c, b.pickup_lat, b.pickup_lng, declined, b.service_type === 'TOUR');
    if (!list.length) {
      await c.query('UPDATE bookings SET offered_driver_id=NULL, offer_expires_at=NULL, declined_driver_ids=$2::uuid[], demand_notified=true WHERE id=$1', [id, []]);
      if (!b.demand_notified) {
        after = () => notify.toUser(b.user_id, 'High demand', 'All our tuktuks are busy. We are still looking, or you can schedule a pickup for later.');
      }
      return;
    }
    const top = list[0];
    await c.query(
      `UPDATE bookings SET offered_driver_id=$2, offer_expires_at=now()+make_interval(secs=>$3), declined_driver_ids=$4::uuid[] WHERE id=$1`,
      [id, top.id, D.offerTtlSec, declined]);
    after = () => notify.toUser(top.user_id, 'New ride request', `Pickup: ${b.pickup_address || 'see app'}. Respond within ${D.offerTtlSec}s.`, { type: 'RIDE_OFFER', booking_id: id });
  });
  if (after) await after();
}

async function acceptOffer(driver, bookingId) {
  let info;
  await db.tx(async (c) => {
    const d = (await c.query('SELECT status FROM drivers WHERE id=$1 FOR UPDATE', [driver.id])).rows[0];
    if (d.status !== 'ONLINE') throw E.conflict('You must be online and free to accept a ride');
    const b = (await c.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [bookingId])).rows[0];
    if (!b) throw E.notFound('Booking not found');
    if (b.status !== 'PAID' || b.offered_driver_id !== driver.id || new Date(b.offer_expires_at) < new Date()) throw E.conflict('This ride offer is no longer available');
    const sh = (await c.query("SELECT vehicle_id FROM shifts WHERE driver_id=$1 AND status='OPEN'", [driver.id])).rows[0];
    if (!sh) throw E.conflict('Start a shift before accepting rides');
    await c.query("UPDATE bookings SET status='ASSIGNED', driver_id=$2, vehicle_id=$3, offered_driver_id=NULL, offer_expires_at=NULL WHERE id=$1", [b.id, driver.id, sh.vehicle_id]);
    await c.query("UPDATE drivers SET status='ON_TRIP' WHERE id=$1", [driver.id]);
    await c.query("UPDATE vehicles SET status='ON_TRIP' WHERE id=$1", [sh.vehicle_id]);
    const info2 = (await c.query(
      `SELECT u.name, u.profile_photo, v.plate_number FROM drivers d JOIN users u ON u.id=d.user_id, vehicles v WHERE d.id=$1 AND v.id=$2`, [driver.id, sh.vehicle_id])).rows[0];
    const km = driver.last_lat == null ? 3 : haversineKm(driver.last_lat, driver.last_lng, b.pickup_lat, b.pickup_lng);
    info = { b, ...info2, eta: Math.max(2, Math.round((km / 20) * 60)) };
  });
  await notify.toUser(info.b.user_id, 'Driver on the way', `${info.name} in ${info.plate_number}, about ${info.eta} min away.`,
    { type: 'DRIVER_ASSIGNED', booking_id: info.b.id, driver_name: info.name, plate: info.plate_number, photo: info.profile_photo, eta_min: info.eta });
  return { status: 'ASSIGNED', booking_id: info.b.id };
}

async function declineOffer(driver, bookingId) {
  const r = await db.query(
    `UPDATE bookings SET declined_driver_ids=array_append(declined_driver_ids,$2::uuid), offered_driver_id=NULL, offer_expires_at=NULL
     WHERE id=$1 AND offered_driver_id=$2 AND status='PAID' RETURNING id`, [bookingId, driver.id]);
  if (!r.rowCount) throw E.conflict('This ride offer is no longer available');
  await dispatchBooking(bookingId); // move straight to the next driver
  return { status: 'DECLINED' };
}

async function releaseDriver(c, driverId, vehicleId) {
  const open = (await c.query("SELECT 1 FROM shifts WHERE driver_id=$1 AND status='OPEN'", [driverId])).rowCount > 0;
  await c.query("UPDATE drivers SET status=$2 WHERE id=$1 AND status<>'SUSPENDED'", [driverId, open ? 'ONLINE' : 'ACTIVE']);
  if (vehicleId) await c.query("UPDATE vehicles SET status=$2 WHERE id=$1 AND status IN ('ON_TRIP','ONLINE')", [vehicleId, open ? 'ONLINE' : 'OFFLINE']);
}

// Parcels skip the offer step: the nearest free driver is assigned directly.
async function assignParcel(parcelId) {
  let after = null;
  await db.tx(async (c) => {
    const p = (await c.query('SELECT * FROM parcels WHERE id=$1 FOR UPDATE', [parcelId])).rows[0];
    if (!p || p.status !== 'PAID' || p.driver_id) return;
    const list = await candidates(c, p.pickup_lat, p.pickup_lng, [], false);
    if (!list.length) return; // the sweep retries every 10 seconds
    const d = list[0];
    await c.query("UPDATE parcels SET status='ASSIGNED', driver_id=$2 WHERE id=$1", [p.id, d.id]);
    await c.query("UPDATE drivers SET status='ON_TRIP' WHERE id=$1", [d.id]);
    after = async () => {
      await notify.toUser(d.user_id, 'Parcel pickup', `Collect parcel ${p.tracking_id} at ${p.pickup_address || 'the pickup point'}.`, { type: 'PARCEL', parcel_id: p.id });
      await notify.toUser(p.sender_id, 'Driver assigned', `A driver is heading to collect parcel ${p.tracking_id}.`);
    };
  });
  if (after) await after();
}

// Runs every 10 seconds: retries unassigned work, expires stale items and flags drivers who lost GPS.
async function sweep() {
  const bs = await db.query("SELECT id FROM bookings WHERE status='PAID' AND driver_id IS NULL");
  for (const r of bs.rows) await dispatchBooking(r.id).catch((e) => console.error('[dispatch]', e.message));
  const ps = await db.query("SELECT id FROM parcels WHERE status='PAID' AND driver_id IS NULL");
  for (const r of ps.rows) await assignParcel(r.id).catch((e) => console.error('[parcel]', e.message));
  await db.query("UPDATE bookings SET status='CANCELLED', cancelled_at=now() WHERE status='PENDING' AND created_at<now()-interval '30 minutes'");
  await db.query("UPDATE parcels SET status='CANCELLED' WHERE status='PENDING' AND created_at<now()-interval '30 minutes'");
  const lost = await db.query(
    `UPDATE drivers SET gps_lost=true WHERE status='ON_TRIP' AND gps_lost=false AND last_seen_at<now()-make_interval(secs=>$1) RETURNING id`, [D.gpsLostSec]);
  for (const r of lost.rows) notify.alertAdmin(`Driver ${r.id} has lost GPS signal during a trip (GPS_LOST). Last known location is shown to the customer.`);
}

module.exports = { dispatchBooking, acceptOffer, declineOffer, releaseDriver, assignParcel, sweep };
