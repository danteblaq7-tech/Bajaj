const crypto = require('crypto');

// Short-lived signed links, so a <video> tag can play footage without sending a login header.
const mac = (secret, id, exp) => crypto.createHmac('sha256', secret).update(`${id}.${exp}`).digest('hex');
function sign(secret, id, ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return { exp, sig: mac(secret, id, exp) };
}
function verify(secret, id, exp, sig) {
  if (!/^\d+$/.test(String(exp)) || Number(exp) < Date.now() / 1000) return false;
  const a = Buffer.from(mac(secret, id, exp)), b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { sign, verify };
