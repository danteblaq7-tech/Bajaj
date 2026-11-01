const { badRequest } = require('./errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX and returns 2547XXXXXXXX.
function normalizePhone(p) {
  if (typeof p !== 'string') return null;
  let s = p.replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (/^0[17]\d{8}$/.test(s)) s = '254' + s.slice(1);
  return /^254[17]\d{8}$/.test(s) ? s : null;
}

// Each rule returns the cleaned value or throws a message string.
const f = {
  str: (o = {}) => (v) => {
    if (typeof v !== 'string') throw 'must be text';
    v = v.trim();
    if (o.min && v.length < o.min) throw `must be at least ${o.min} characters`;
    if (v.length > (o.max || 500)) throw `must be at most ${o.max || 500} characters`;
    return v;
  },
  num: (o = {}) => (v) => {
    if (typeof v === 'string' && v.trim() !== '') v = Number(v);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw 'must be a number';
    if (o.int && !Number.isInteger(v)) throw 'must be a whole number';
    if (o.min != null && v < o.min) throw `must be at least ${o.min}`;
    if (o.max != null && v > o.max) throw `must be at most ${o.max}`;
    return v;
  },
  uuid: () => (v) => { if (typeof v !== 'string' || !UUID.test(v)) throw 'must be a valid id'; return v; },
  oneOf: (list) => (v) => { if (!list.includes(v)) throw `must be one of ${list.join(', ')}`; return v; },
  phone: () => (v) => { const n = normalizePhone(v); if (!n) throw 'must be a valid Kenyan phone number'; return n; },
  pin: () => (v) => { if (!/^\d{4,6}$/.test(String(v))) throw 'must be 4 to 6 digits'; return String(v); },
  email: () => (v) => {
    if (typeof v !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) throw 'must be a valid email';
    return v.trim().toLowerCase();
  },
  bool: () => (v) => { if (typeof v !== 'boolean') throw 'must be true or false'; return v; },
  date: () => (v) => {
    const d = new Date(v);
    if (typeof v !== 'string' || isNaN(d)) throw 'must be a valid date';
    return d.toISOString();
  },
  obj: () => (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw 'must be an object';
    return v;
  },
};
f.lat = () => f.num({ min: -90, max: 90 });
f.lng = () => f.num({ min: -180, max: 180 });
const opt = (fn) => Object.assign((v) => fn(v), { optional: true });

// validate({field: rule}, 'body'|'query') -> req.valid
function validate(schema, src = 'body') {
  return (req, res, next) => {
    const out = {}, errs = {}, data = req[src] || {};
    for (const k of Object.keys(schema)) {
      const fn = schema[k], v = data[k];
      if (v === undefined || v === null || v === '') {
        if (!fn.optional) errs[k] = 'is required';
        continue;
      }
      try { out[k] = fn(v); } catch (m) { errs[k] = String(m); }
    }
    if (Object.keys(errs).length) return next(badRequest('Invalid input', errs));
    req.valid = out;
    next();
  };
}
module.exports = { validate, f, opt, normalizePhone };
