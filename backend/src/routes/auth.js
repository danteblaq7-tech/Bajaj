const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const notify = require('../services/notify');
const E = require('../utils/errors');
const { wrap, sha, safeEq, digits } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { issueTokens } = require('../middleware/auth');

async function sendOtp(phone) {
  const last = (await db.query('SELECT created_at FROM otps WHERE phone=$1 ORDER BY created_at DESC LIMIT 1', [phone])).rows[0];
  if (last && Date.now() - new Date(last.created_at).getTime() < config.otp.resendSec * 1000) {
    throw E.tooMany(`Wait ${config.otp.resendSec} seconds before asking for another code`);
  }
  const code = config.otp.devCode || digits(6);
  await db.query('UPDATE otps SET used=true WHERE phone=$1 AND used=false', [phone]);
  await db.query('INSERT INTO otps(phone,code_hash,expires_at) VALUES($1,$2,now()+make_interval(mins=>$3))', [phone, sha(code), config.otp.ttlMin]);
  const lang = (await db.query('SELECT language FROM users WHERE phone=$1', [phone])).rows[0];
  await notify.sms(phone, notify.tr(lang && lang.language, `Your Pwani Ride code is ${code}. It expires in ${config.otp.ttlMin} minutes.`));
}

router.post('/register', validate({ phone: f.phone(), name: f.str({ min: 2, max: 80 }), email: opt(f.email()), language: opt(f.oneOf(['en', 'sw'])) }), wrap(async (req, res) => {
  const { phone, name, email, language } = req.valid;
  await db.query('INSERT INTO users(phone,name,email,language) VALUES($1,$2,$3,$4) ON CONFLICT (phone) DO NOTHING', [phone, name, email || null, language || 'en']);
  await sendOtp(phone);
  res.status(201).json({ message: 'Verification code sent' });
}));

router.post('/otp/send', validate({ phone: f.phone() }), wrap(async (req, res) => {
  const u = (await db.query('SELECT id FROM users WHERE phone=$1', [req.valid.phone])).rows[0];
  if (!u) throw E.notFound('No account for this number. Register first.');
  await sendOtp(req.valid.phone);
  res.json({ message: 'Verification code sent' });
}));

router.post('/otp/verify', validate({ phone: f.phone(), code: f.str({ min: 4, max: 8 }) }), wrap(async (req, res) => {
  const { phone, code } = req.valid;
  const o = (await db.query('SELECT * FROM otps WHERE phone=$1 AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [phone])).rows[0];
  if (!o) throw E.unauthorized('Code expired. Request a new one.');
  if (o.attempts >= config.otp.maxAttempts) throw E.tooMany('Too many wrong codes. Request a new one.');
  if (!safeEq(sha(code), o.code_hash)) {
    await db.query('UPDATE otps SET attempts=attempts+1 WHERE id=$1', [o.id]);
    throw E.unauthorized('Incorrect code');
  }
  await db.query('UPDATE otps SET used=true WHERE id=$1', [o.id]);
  const u = (await db.query('SELECT id,phone,name,email,role,profile_photo FROM users WHERE phone=$1', [phone])).rows[0];
  if (!u) throw E.notFound('No account for this number');
  if (u.role !== 'CUSTOMER') throw E.forbidden('Staff and drivers sign in with their PIN or password');
  res.json({ user: u, ...issueTokens(u) });
}));

// Staff (ADMIN / OPS) sign in with email and password.
router.post('/login', validate({ email: f.email(), password: f.str({ min: 6, max: 100 }) }), wrap(async (req, res) => {
  const u = (await db.query("SELECT * FROM users WHERE email=$1 AND role IN ('ADMIN','OPS')", [req.valid.email])).rows[0];
  const ok = u && u.password_hash && (await bcrypt.compare(req.valid.password, u.password_hash));
  if (!ok) throw E.unauthorized('Incorrect email or password');
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role }, ...issueTokens(u) });
}));

router.post('/refresh', validate({ refreshToken: f.str({ max: 2000 }) }), wrap(async (req, res) => {
  let p;
  try { p = jwt.verify(req.valid.refreshToken, config.jwt.refresh); } catch (e) { throw E.unauthorized('Session expired. Sign in again.'); }
  if (p.typ !== 'refresh') throw E.unauthorized('Invalid token');
  const u = (await db.query('SELECT id, role FROM users WHERE id=$1', [p.sub])).rows[0];
  if (!u) throw E.unauthorized('Account no longer exists');
  res.json(issueTokens(u));
}));
module.exports = router;
