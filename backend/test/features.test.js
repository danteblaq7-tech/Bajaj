const test = require('node:test');
const assert = require('node:assert');
const { weekStart } = require('../src/utils/time');
const { sign, verify } = require('../src/utils/sign');
const { decode, thin } = require('../src/services/routing');
const { tr } = require('../src/services/i18n');

test('payout week starts Monday 00:00 Nairobi time', () => {
  // Saturday 31 Oct 2026 09:00 Nairobi -> Monday 26 Oct 2026 00:00 Nairobi = Sunday 21:00 UTC
  assert.strictEqual(weekStart(new Date('2026-10-31T06:00:00Z')).toISOString(), '2026-10-25T21:00:00.000Z');
  // Monday 01:00 Nairobi is already the new week
  assert.strictEqual(weekStart(new Date('2026-10-25T22:00:00Z')).toISOString(), '2026-10-25T21:00:00.000Z');
  // Sunday 23:30 Nairobi is still the old week
  assert.strictEqual(weekStart(new Date('2026-10-25T20:30:00Z')).toISOString(), '2026-10-18T21:00:00.000Z');
});
test('signed links verify, expire and resist tampering', () => {
  const { exp, sig } = sign('s3cret', 'clip-1', 60);
  assert.ok(verify('s3cret', 'clip-1', exp, sig));
  assert.ok(!verify('s3cret', 'clip-2', exp, sig));
  assert.ok(!verify('other', 'clip-1', exp, sig));
  assert.ok(!verify('s3cret', 'clip-1', exp, sig.replace(/.$/, (c) => (c === '0' ? '1' : '0'))));
  const old = sign('s3cret', 'clip-1', -10);
  assert.ok(!verify('s3cret', 'clip-1', old.exp, old.sig));
});
test('decodes Google/OSRM encoded polylines', () => {
  const pts = decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepStrictEqual(pts.map((p) => [p.lat, p.lng]), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});
test('thinning keeps the first and last point', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ lat: i, lng: i }));
  const t = thin(pts, 100);
  assert.strictEqual(t.length, 100);
  assert.strictEqual(t[0].lat, 0);
  assert.strictEqual(t[99].lat, 999);
});
test('server messages translate to Swahili with their values kept', () => {
  assert.strictEqual(tr('sw', 'Payment received'), 'Malipo yamepokelewa');
  assert.strictEqual(tr('sw', 'KES 500 received. Receipt AB12.'), 'KES 500 imepokelewa. Risiti AB12.');
  assert.strictEqual(tr('sw', 'Pickup: Kilifi Town. Respond within 30s.'), 'Kuchukua: Kilifi Town. Jibu ndani ya sekunde 30.');
  assert.strictEqual(tr('sw', 'Your Pwani Ride code is 123456. It expires in 5 minutes.'), 'Nambari yako ya Pwani Ride ni 123456. Itaisha baada ya dakika 5.');
  assert.strictEqual(tr('en', 'Payment received'), 'Payment received');
  assert.strictEqual(tr('sw', 'Something unknown'), 'Something unknown');
});
