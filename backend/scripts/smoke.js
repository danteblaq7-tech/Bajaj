// End-to-end check of the main flow against a RUNNING server (development mode, seeded database):
//   npm run migrate && npm run seed && npm run dev      (in one terminal)
//   npm run smoke                                       (in another)
// Covers: sign-up/OTP, admin login, driver login, photo upload, shift start (QR + checklist), live location,
// booking + mock M-Pesa payment, dispatch + accept, trip start/complete, rating, revenue and shift reports.
const BASE = process.env.API || 'http://localhost:4000';
const OTP = process.env.OTP_DEV_CODE || '123456';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let failed = 0;

async function call(method, path, { body, token, raw, type } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(raw ? { 'Content-Type': type } : body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) {
  try { const out = await fn(); console.log(`PASS  ${name}`); return out; }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); return null; }
}
const need = (r, ...ok) => { if (!ok.includes(r.status)) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.j)}`); return r.j; };
async function until(fn, tries = 20, ms = 1500) { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } throw new Error('timed out'); }

(async () => {
  const phone = '0711000111';
  await step('server health', async () => need(await call('GET', '/health'), 200));

  const cust = await step('customer sign-up and OTP login', async () => {
    const s = await call('POST', '/api/auth/otp/send', { body: { phone } });
    if (s.status === 404) need(await call('POST', '/api/auth/register', { body: { phone, name: 'Smoke Test' } }), 201);
    else if (s.status !== 200 && s.status !== 429) need(s, 200);
    return need(await call('POST', '/api/auth/otp/verify', { body: { phone, code: OTP } }), 200).accessToken;
  });
  const admin = await step('admin login', async () => need(await call('POST', '/api/auth/login', { body: { email: process.env.ADMIN_EMAIL || 'admin@pwaniride.test', password: process.env.ADMIN_PASSWORD || 'ChangeMe123!' } }), 200).accessToken);
  const drv = await step('driver login (demo driver)', async () => need(await call('POST', '/api/drivers/login', { body: { phone: '0700000001', pin: '1234' } }), 200).accessToken);
  if (!cust || !admin || !drv) return finish();

  const photo = await step('photo upload', async () => {
    const j = need(await call('POST', '/api/uploads', { token: drv, raw: PNG, type: 'image/png' }), 201);
    if (!/^\/uploads\/[0-9a-f]{32}\.png$/.test(j.url)) throw new Error('unexpected url ' + j.url);
    const pic = await fetch(BASE + j.url); if (pic.status !== 200) throw new Error('uploaded file not served');
    return j.url;
  });
  await step('upload rejects non-images', async () => { const r = await call('POST', '/api/uploads', { token: drv, raw: Buffer.from('<script>alert(1)</script>'), type: 'image/png' }); if (r.status !== 400) throw new Error('expected 400, got ' + r.status); });

  await step('driver starts shift (QR + checklist photos)', async () => {
    const r = await call('POST', '/api/drivers/shifts/start', { token: drv, body: { vehicle_qr: 'PR-VEH-001', selfie_url: photo, checklist: { tires_photo: photo, ac_photo: photo, cleanliness_photo: photo, camera_photo: photo, fuel_liters: 6 } } });
    if (r.status === 409) return; // already on shift from an earlier run
    need(r, 201);
  });
  await step('driver location ping', async () => need(await call('POST', '/api/drivers/location', { token: drv, body: { lat: -3.6305, lng: 39.8499 } }), 200));

  const trip = { service_type: 'RIDE', pickup_address: 'Kilifi Town', pickup_lat: -3.6305, pickup_lng: 39.8499, dropoff_address: 'Mnarani', dropoff_lat: -3.64, dropoff_lng: 39.865 };
  const est = await step('fare estimate', async () => need(await call('POST', '/api/bookings/estimate', { token: cust, body: trip }), 200));
  const booking = await step('create booking', async () => need(await call('POST', '/api/bookings', { token: cust, body: trip }), 201).booking);
  if (!booking) return finish();
  await step('pay with M-Pesa (mock) and confirm', async () => {
    const p = need(await call('POST', `/api/bookings/${booking.id}/pay`, { token: cust, body: { method: 'MPESA' } }), 202);
    await until(async () => (need(await call('GET', `/api/payments/${p.payment_id}/receipt`, { token: cust }), 200).receipt.status === 'SUCCESS'), 15, 1000);
  });
  await step('driver receives the offer and accepts', async () => {
    const o = await until(async () => need(await call('GET', '/api/drivers/offers/current', { token: drv }), 200).offer, 25, 1500);
    need(await call('POST', `/api/drivers/offers/${o.id}/accept`, { token: drv }), 200);
  });
  await step('customer sees driver and live position', async () => {
    const j = need(await call('GET', `/api/bookings/${booking.id}`, { token: cust }), 200);
    if (!j.driver || !j.driver.location) throw new Error('no driver location in response');
  });
  await step('trip start and complete', async () => {
    need(await call('POST', `/api/bookings/${booking.id}/start`, { token: drv }), 200);
    const j = need(await call('POST', `/api/bookings/${booking.id}/complete`, { token: drv }), 200);
    if (!(j.earnings > 0)) throw new Error('no earnings returned');
  });
  await step('customer rates the trip', async () => need(await call('POST', `/api/bookings/${booking.id}/rate`, { token: cust, body: { stars: 5 } }), 201));
  await step('admin: fleet, revenue and shift photos', async () => {
    const f = need(await call('GET', '/api/admin/fleet/live', { token: admin }), 200);
    if (!f.vehicles.length) throw new Error('no vehicles');
    const rev = need(await call('GET', '/api/admin/reports/revenue', { token: admin }), 200);
    if (!(rev.totals.RIDES > 0)) throw new Error('ride revenue missing');
    const s = need(await call('GET', '/api/admin/shifts', { token: admin }), 200);
    if (!s.shifts.some((x) => x.selfie_url)) throw new Error('shift photos missing');
  });
  // ---- newer features ----
  await step('language preference saved', async () => {
    need(await call('PATCH', '/api/users/me', { token: cust, body: { language: 'sw' } }), 200);
    if (need(await call('GET', '/api/users/me', { token: cust }), 200).user.language !== 'sw') throw new Error('language not saved');
    need(await call('PATCH', '/api/users/me', { token: cust, body: { language: 'en' } }), 200);
  });
  await step('drawn route (200, or 503 if the routing server is unreachable)', async () => {
    const r = await call('GET', '/api/routes?from_lat=-3.6305&from_lng=39.8499&to_lat=-3.2192&to_lng=40.1169', { token: cust });
    if (r.status === 503) { console.log('      routing server unreachable: fares fall back to straight-line distance'); return; }
    const j = need(r, 200); if (!(j.points.length > 2 && j.distance_km > 30)) throw new Error('route looks wrong');
  });
  let sched;
  await step('scheduled ride, paid by card (mock), then cancelled with wallet refund', async () => {
    const at = new Date(Date.now() + 3 * 3600000).toISOString();
    sched = need(await call('POST', '/api/bookings', { token: cust, body: { ...trip, scheduled_at: at } }), 201).booking;
    if (!sched.scheduled_at) throw new Error('scheduled_at missing');
    const m = need(await call('GET', '/api/payments/methods', { token: cust }), 200);
    if (!m.card) throw new Error('card payments are not enabled (set PAYSTACK_SECRET_KEY, or use development mock mode)');
    const before = need(await call('GET', '/api/users/me/wallet', { token: cust }), 200).wallet.balance;
    const p = need(await call('POST', `/api/bookings/${sched.id}/pay`, { token: cust, body: { method: 'CARD' } }), 202);
    await until(async () => (need(await call('GET', `/api/payments/${p.payment_id}/receipt`, { token: cust }), 200).receipt.status === 'SUCCESS'), 15, 1000);
    need(await call('POST', `/api/bookings/${sched.id}/cancel`, { token: cust }), 200);
    const after = need(await call('GET', '/api/users/me/wallet', { token: cust }), 200).wallet.balance;
    if (!(after > before)) throw new Error('refund did not reach the wallet');
  });
  await step('weekly payout: generate, approve, paid by M-Pesa (mock)', async () => {
    const g = need(await call('POST', '/api/admin/payouts/generate', { token: admin, body: { until: new Date(Date.now() + 60000).toISOString() } }), 200);
    const list = need(await call('GET', '/api/admin/payouts', { token: admin }), 200).payouts;
    const p = list.find((x) => x.status === 'PENDING');
    if (!p) throw new Error(`no pending payout (created ${g.created}); the demo driver needs completed trips with unsettled earnings`);
    need(await call('POST', `/api/admin/payouts/${p.id}/approve`, { token: admin }), 200);
    await until(async () => (need(await call('GET', '/api/admin/payouts', { token: admin }), 200).payouts.find((x) => x.id === p.id).status === 'PAID'), 10, 1000);
    const mine = need(await call('GET', '/api/drivers/payouts', { token: drv }), 200).payouts;
    if (!mine.length) throw new Error('driver cannot see payouts');
  });
  await step('camera footage: key, upload, list, signed playback, bad link refused', async () => {
    const fleet = need(await call('GET', '/api/admin/fleet/live', { token: admin }), 200).vehicles;
    const v = fleet.find((x) => x.plate_number === 'KDF 101A') || fleet[0];
    const key = need(await call('POST', `/api/admin/vehicles/${v.id}/camera-key`, { token: admin }), 200).camera_key;
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(40)]);
    const bad = await fetch(BASE + '/api/footage/device', { method: 'POST', headers: { 'X-Device-Key': 'wrong', 'X-Vehicle-Id': v.id, 'X-Started-At': new Date().toISOString(), 'Content-Type': 'video/mp4' }, body: mp4 });
    if (bad.status !== 401) throw new Error('wrong camera key was not refused');
    const up = await fetch(BASE + '/api/footage/device', { method: 'POST', headers: { 'X-Device-Key': key, 'X-Vehicle-Id': v.id, 'X-Started-At': new Date().toISOString(), 'X-Duration-S': '30', 'Content-Type': 'video/mp4' }, body: mp4 });
    if (up.status !== 201) throw new Error('upload failed: HTTP ' + up.status);
    const clip = (await up.json()).id;
    const clips = need(await call('GET', `/api/admin/footage?vehicle_id=${v.id}`, { token: admin }), 200).clips;
    if (!clips.some((c) => c.id === clip)) throw new Error('clip not listed');
    const play = need(await call('POST', `/api/admin/footage/${clip}/play`, { token: admin }), 200);
    const f1 = await fetch(BASE + play.url); if (f1.status !== 200 || (await f1.arrayBuffer()).byteLength !== mp4.length) throw new Error('signed playback failed');
    const f2 = await fetch(BASE + play.url.replace(/sig=.{4}/, 'sig=0000')); if (f2.status !== 403) throw new Error('tampered link was accepted');
  });
  await step('driver ends shift', async () => need(await call('POST', '/api/drivers/shifts/end', { token: drv, body: { end_fuel: 5, mileage: 12 } }), 200));
  console.log(est ? `\n(fare quoted: KES ${est.fare})` : '');
  finish();
})();
function finish() { console.log(failed ? `\n${failed} step(s) failed.` : '\nAll steps passed.'); process.exit(failed ? 1 : 0); }
