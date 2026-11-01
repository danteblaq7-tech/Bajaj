const router = require('express').Router();
const config = require('../config');
const payments = require('../services/payments');
const payouts = require('../services/payouts');
const E = require('../utils/errors');
const { wrap, safeEq } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');

router.get('/methods', requireAuth, (req, res) => res.json({ mpesa: true, wallet: true, card: config.card.enabled }));

const schema = {
  booking_id: opt(f.uuid()), parcel_id: opt(f.uuid()), invoice_id: opt(f.uuid()), phone: opt(f.phone()), method: opt(f.oneOf(['MPESA', 'WALLET', 'CARD'])),
};
const pay = (forced) => wrap(async (req, res) => {
  const { booking_id, parcel_id, invoice_id, phone, method } = req.valid;
  const given = [['BOOKING', booking_id], ['PARCEL', parcel_id], ['INVOICE', invoice_id]].filter(([, id]) => id);
  if (given.length !== 1) throw E.badRequest('Send exactly one of booking_id, parcel_id or invoice_id');
  const out = await payments.initiate(req.user, { purpose: given[0][0], targetId: given[0][1], method: forced || method || 'MPESA', phone });
  res.status(202).json(out);
});
router.post('/mpesa/stkpush', requireAuth, validate(schema), pay());
router.post('/card/charge', requireAuth, validate(schema), pay('CARD'));

// Safaricom callbacks. Not JWT-authenticated: protected by a secret token in the URL, and always acknowledged.
const tokenOk = (req) => safeEq(req.query.token || '', config.mpesa.callbackToken);
router.post('/mpesa/callback', wrap(async (req, res) => {
  if (!tokenOk(req)) throw E.unauthorized('Invalid callback token');
  try { await payments.handleMpesaCallback(req.body); } catch (e) { console.error('[mpesa callback]', e.message); }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));
router.post('/payouts/result', wrap(async (req, res) => {
  if (!tokenOk(req)) throw E.unauthorized('Invalid callback token');
  try { await payouts.handleResult(req.body); } catch (e) { console.error('[payout result]', e.message); }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));
router.post('/payouts/timeout', wrap(async (req, res) => {
  if (!tokenOk(req)) throw E.unauthorized('Invalid callback token');
  console.error('[ADMIN ALERT] payout request timed out at Safaricom. Check the payout in the dashboard:', JSON.stringify(req.body).slice(0, 300));
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

// Paystack webhook. The raw body is needed to check the signature (captured in app.js).
router.post('/card/webhook', wrap(async (req, res) => {
  try { await payments.handleCardWebhook(req.rawBody, req.get('x-paystack-signature'), req.body); }
  catch (e) { if (e.status === 401) throw e; console.error('[card webhook]', e.message); }
  res.sendStatus(200);
}));

router.get('/:id/receipt', requireAuth, wrap(async (req, res) => { res.json({ receipt: await payments.getReceipt(req.user, req.params.id) }); }));
module.exports = router;
