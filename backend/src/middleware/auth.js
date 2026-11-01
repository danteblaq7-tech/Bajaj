const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../utils/errors');

const issueTokens = (u) => ({
  accessToken: jwt.sign({ sub: u.id, role: u.role }, config.jwt.access, { expiresIn: config.jwt.accessTtl }),
  refreshToken: jwt.sign({ sub: u.id, role: u.role, typ: 'refresh' }, config.jwt.refresh, { expiresIn: config.jwt.refreshTtl }),
});

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return next(unauthorized('Missing access token'));
  try {
    const p = jwt.verify(t, config.jwt.access);
    req.user = { id: p.sub, role: p.role };
    next();
  } catch (e) { next(unauthorized('Invalid or expired token')); }
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden('You do not have access to this resource'));

// Loads the driver profile for the signed-in driver and blocks unapproved or suspended accounts.
async function loadDriver(req, res, next) {
  try {
    const d = (await db.query('SELECT * FROM drivers WHERE user_id=$1', [req.user.id])).rows[0];
    if (!d) return next(forbidden('No driver profile for this account'));
    if (d.status === 'SUSPENDED') return next(forbidden('Your account is suspended. Contact Operations.'));
    if (d.status === 'PENDING') return next(forbidden('Your account is awaiting approval.'));
    req.driver = d;
    next();
  } catch (e) { next(e); }
}
module.exports = { issueTokens, requireAuth, requireRole, loadDriver };
