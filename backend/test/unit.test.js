const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone, validate, f, opt } = require('../src/utils/validate');
const { haversineKm, rideFare, parcelFare } = require('../src/services/pricing');
const { sha, safeEq } = require('../src/utils/helpers');

test('normalizes Kenyan phone numbers', () => {
  assert.strictEqual(normalizePhone('0712 345 678'), '254712345678');
  assert.strictEqual(normalizePhone('+254112345678'), '254112345678');
  assert.strictEqual(normalizePhone('254712345678'), '254712345678');
  assert.strictEqual(normalizePhone('12345'), null);
});

test('validate collects field errors and cleans values', () => {
  const mw = validate({ phone: f.phone(), age: f.num({ int: true, min: 18 }), note: opt(f.str({ max: 5 })) });
  let err; const req = { body: { phone: '0712345678', age: '17', note: 'toolong' } };
  mw(req, {}, (e) => { err = e; });
  assert.strictEqual(err.status, 400);
  assert.ok(err.details.age && err.details.note && !err.details.phone);
  const ok = { body: { phone: '0712345678', age: '30' } };
  mw(ok, {}, (e) => assert.strictEqual(e, undefined));
  assert.deepStrictEqual(ok.valid, { phone: '254712345678', age: 30 });
});

test('Kilifi to Malindi distance is roughly 55 km as the crow flies', () => {
  const km = haversineKm(-3.6305, 39.8499, -3.2192, 40.1169);
  assert.ok(km > 50 && km < 65, `got ${km}`);
});

test('fares: minimum applies, rounds to 10, grows with distance', () => {
  const a = { lat: -3.63, lng: 39.85 };
  assert.strictEqual(rideFare(a, { lat: -3.6301, lng: 39.8501 }).fare, 200);
  const near = rideFare(a, { lat: -3.7, lng: 39.9 }), far = rideFare(a, { lat: -3.2, lng: 40.1 });
  assert.ok(far.fare > near.fare);
  assert.strictEqual(far.fare % 10, 0);
  assert.ok(parcelFare(a, { lat: -3.7, lng: 39.9 }, 'LARGE').fare > parcelFare(a, { lat: -3.7, lng: 39.9 }, 'SMALL').fare);
});

test('code comparison is exact', () => {
  assert.ok(safeEq(sha('1234'), sha('1234')));
  assert.ok(!safeEq(sha('1234'), sha('1235')));
});
