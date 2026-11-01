const crypto = require('crypto');
// Lets async route handlers throw: errors flow to the central error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const digits = (n) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
module.exports = { wrap, sha, safeEq, digits };
