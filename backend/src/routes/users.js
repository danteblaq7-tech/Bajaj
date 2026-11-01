const router = require('express').Router();
const db = require('../db');
const payments = require('../services/payments');
const { wrap } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const E = require('../utils/errors');

router.use(requireAuth);

router.get('/me', wrap(async (req, res) => {
  const u = (await db.query('SELECT id,phone,name,email,profile_photo,emergency_contact_phone,role,language,created_at FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!u) throw E.notFound('Account not found');
  res.json({ user: u });
}));

router.patch('/me', validate({
  name: opt(f.str({ min: 2, max: 80 })), email: opt(f.email()), profile_photo: opt(f.str({ max: 500 })),
  emergency_contact_phone: opt(f.phone()), push_token: opt(f.str({ max: 500 })), language: opt(f.oneOf(['en', 'sw'])),
}), wrap(async (req, res) => {
  const v = req.valid;
  const u = (await db.query(
    `UPDATE users SET name=COALESCE($2,name), email=COALESCE($3,email), profile_photo=COALESCE($4,profile_photo),
       emergency_contact_phone=COALESCE($5,emergency_contact_phone), push_token=COALESCE($6,push_token), language=COALESCE($7,language)
     WHERE id=$1 RETURNING id,phone,name,email,profile_photo,emergency_contact_phone,role,language`,
    [req.user.id, v.name, v.email, v.profile_photo, v.emergency_contact_phone, v.push_token, v.language])).rows[0];
  // A phone that signs in to another account must stop receiving the previous account's notifications.
  if (v.push_token) await db.query('UPDATE users SET push_token=NULL WHERE push_token=$1 AND id<>$2', [v.push_token, req.user.id]);
  res.json({ user: u });
}));

router.delete('/me/push-token', wrap(async (req, res) => {
  await db.query('UPDATE users SET push_token=NULL WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
}));

router.get('/me/bookings', validate({ limit: opt(f.num({ int: true, min: 1, max: 100 })), offset: opt(f.num({ int: true, min: 0 })) }, 'query'), wrap(async (req, res) => {
  const { limit = 20, offset = 0 } = req.valid;
  const r = await db.query('SELECT * FROM bookings WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [req.user.id, limit, offset]);
  res.json({ bookings: r.rows });
}));

router.get('/me/wallet', wrap(async (req, res) => {
  const w = (await db.query('SELECT balance,currency,updated_at FROM wallets WHERE user_id=$1', [req.user.id])).rows[0];
  res.json({ wallet: w || { balance: 0, currency: 'KES' } });
}));

router.post('/me/wallet/topup', validate({ amount: f.num({ min: 50, max: 70000 }), phone: opt(f.phone()), method: opt(f.oneOf(['MPESA', 'CARD'])) }), wrap(async (req, res) => {
  const out = await payments.initiate(req.user, { purpose: 'WALLET_TOPUP', method: req.valid.method || 'MPESA', amount: req.valid.amount, phone: req.valid.phone });
  res.status(202).json(out);
}));
module.exports = router;
