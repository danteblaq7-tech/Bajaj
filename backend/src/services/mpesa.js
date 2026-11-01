// M-Pesa Daraja (STK push). In development without credentials, mock mode is used (see config).
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const M = config.mpesa;

const base = () => (M.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
let cached = { value: null, exp: 0 };

async function http(url, opts) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Daraja ${r.status}: ${j.errorMessage || j.errorCode || ''}`), { status: r.status });
  return j;
}
async function token() {
  if (cached.value && Date.now() < cached.exp) return cached.value;
  const auth = Buffer.from(`${M.key}:${M.secret}`).toString('base64');
  const j = await http(`${base()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  cached = { value: j.access_token, exp: Date.now() + (Number(j.expires_in || 3599) - 60) * 1000 };
  return cached.value;
}
const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const password = (t) => Buffer.from(M.shortcode + M.passkey + t).toString('base64');

// Retries timeouts and 5xx up to 3 times with exponential backoff (0.5s, 1s, 2s).
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (e.status && e.status < 500 && e.status !== 429) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

async function stkPush({ phone, amount, reference, description }) {
  if (M.mock) return { checkoutRequestId: 'MOCK-' + crypto.randomUUID(), mock: true };
  const t = stamp();
  const j = await withRetry(async () => http(`${base()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: M.shortcode, Password: password(t), Timestamp: t,
      TransactionType: 'CustomerPayBillOnline', Amount: Math.ceil(amount),
      PartyA: phone, PartyB: M.shortcode, PhoneNumber: phone,
      CallBackURL: `${config.publicUrl}/api/payments/mpesa/callback?token=${M.callbackToken}`,
      AccountReference: String(reference).slice(0, 12), TransactionDesc: String(description).slice(0, 13),
    }),
  }));
  if (String(j.ResponseCode) !== '0') throw new Error(`Daraja rejected request: ${j.ResponseDescription || ''}`);
  return { checkoutRequestId: j.CheckoutRequestID };
}

async function query(checkoutRequestId) {
  const t = stamp();
  return withRetry(async () => http(`${base()}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ BusinessShortCode: M.shortcode, Password: password(t), Timestamp: t, CheckoutRequestID: checkoutRequestId }),
  }));
}

// B2C payout to a driver's M-Pesa. NOT retried automatically: a retry after an unclear failure could pay twice.
// err.definite is true only when Safaricom clearly refused the request; anything else is "unknown, check before retrying".
async function b2c({ phone, amount, remarks, occasion }) {
  if (M.mock) return { conversationId: 'MOCK-' + crypto.randomUUID(), originatorId: null, mock: true };
  const P = config.payouts;
  const refuse = (m) => Object.assign(new Error(m), { definite: true });
  if (!P.initiator || !P.initiatorPassword || !P.certPath) throw refuse('Payout credentials are not configured (MPESA_INITIATOR_NAME, MPESA_INITIATOR_PASSWORD, MPESA_CERT_PATH)');
  const credential = crypto.publicEncrypt({ key: fs.readFileSync(P.certPath), padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(P.initiatorPassword)).toString('base64');
  const hook = (p) => `${config.publicUrl}/api/payments/payouts/${p}?token=${M.callbackToken}`;
  let j;
  try {
    j = await http(`${base()}/mpesa/b2c/v1/paymentrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        InitiatorName: P.initiator, SecurityCredential: credential, CommandID: 'BusinessPayment', Amount: Math.floor(amount),
        PartyA: M.shortcode, PartyB: phone, Remarks: String(remarks).slice(0, 100), QueueTimeOutURL: hook('timeout'), ResultURL: hook('result'), Occassion: String(occasion || '').slice(0, 100),
      }),
    });
  } catch (e) { e.definite = !!(e.status && e.status < 500 && e.status !== 429); throw e; }
  if (String(j.ResponseCode) !== '0') throw refuse(`Safaricom refused the payout: ${j.ResponseDescription || j.errorMessage || ''}`);
  return { conversationId: j.ConversationID, originatorId: j.OriginatorConversationID };
}
module.exports = { stkPush, query, b2c };
