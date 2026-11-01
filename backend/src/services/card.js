// Card payments through Paystack's hosted checkout page: the customer enters card details on Paystack's page,
// never in our app or on our server. To use Flutterwave, DPO or Pesapal instead, keep these three functions' shapes.
// Check with Paystack that your account can accept KES card payments before going live.
const crypto = require('crypto');
const config = require('../config');
const C = config.card;
const API = 'https://api.paystack.co';
const headers = () => ({ Authorization: `Bearer ${C.secret}`, 'Content-Type': 'application/json' });

async function initialize({ email, amount, reference, callbackUrl, metadata }) {
  if (C.mock) return { checkoutUrl: null, mock: true };
  const r = await fetch(`${API}/transaction/initialize`, {
    method: 'POST', headers: headers(), signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ email, amount: Math.round(amount * 100), currency: 'KES', reference, callback_url: callbackUrl, metadata }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw new Error(`Paystack: ${j.message || r.status}`);
  return { checkoutUrl: j.data.authorization_url };
}
// status: 'success' | 'failed' | 'abandoned' | 'pending'; amount in subunits (cents)
async function verify(reference) {
  const r = await fetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, { headers: headers(), signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return { status: 'pending', amount: 0 };
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data) throw new Error(`Paystack verify: ${j.message || r.status}`);
  return { status: j.data.status, amount: j.data.amount, currency: j.data.currency };
}
function validSignature(rawBody, signature) {
  if (!C.secret || !signature) return false;
  const a = Buffer.from(crypto.createHmac('sha512', C.secret).update(rawBody).digest('hex')), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { initialize, verify, validSignature };
