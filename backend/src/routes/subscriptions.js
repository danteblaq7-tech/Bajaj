const router = require('express').Router();
const db = require('../db');
const config = require('../config');
const E = require('../utils/errors');
const { wrap } = require('../utils/helpers');
const { validate, f, opt } = require('../utils/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/plans', wrap(async (req, res) => {
  res.json({ plans: Object.entries(config.plans).map(([type, p]) => ({ type, label: p.label, base_fee: p.fee, currency: 'KES' })) });
}));

router.use(requireAuth);

// Creates a PENDING subscription and its first invoice. Pay it with POST /api/payments/mpesa/stkpush { invoice_id }.
router.post('/', requireRole('CUSTOMER'), validate({
  plan_type: f.oneOf(Object.keys(config.plans)), organization_code: f.str({ min: 3, max: 30 }),
  schedule: f.obj(), member_id: opt(f.str({ max: 60 })), auto_renew: opt(f.bool()),
}), wrap(async (req, res) => {
  const v = req.valid, plan = config.plans[v.plan_type];
  const org = (await db.query('SELECT * FROM organizations WHERE code=$1 AND active=true', [v.organization_code.toUpperCase()])).rows[0];
  if (!org || org.type !== plan.orgType) {
    throw E.badRequest(v.plan_type === 'EMPLOYEE' ? 'Company not registered. Ask your HR team.' : v.plan_type === 'SCHOOL' ? 'School contract not active. Contact the school.' : 'This hotel is not a partner.');
  }
  const fee = org.monthly_fee || plan.fee;
  const out = await db.tx(async (c) => {
    const s = (await c.query(
      `INSERT INTO subscriptions(user_id,plan_type,organization_code,monthly_fee,auto_renew,schedule,meta) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, v.plan_type, org.code, fee, v.auto_renew !== false, v.schedule, { member_id: v.member_id || null }])).rows[0];
    const inv = (await c.query("INSERT INTO invoices(subscription_id,amount,due_date) VALUES($1,$2,CURRENT_DATE) RETURNING *", [s.id, fee])).rows[0];
    return { subscription: s, invoice: inv };
  });
  res.status(201).json(out);
}));

router.get('/me', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT s.*, (SELECT json_agg(i ORDER BY i.due_date DESC) FROM invoices i WHERE i.subscription_id=s.id) AS invoices
     FROM subscriptions s WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [req.user.id]);
  res.json({ subscriptions: r.rows });
}));

router.post('/:id/cancel', wrap(async (req, res) => {
  const r = await db.query(
    `UPDATE subscriptions SET status='CANCELLED', auto_renew=false WHERE id=$1 AND user_id=$2 AND status<>'CANCELLED' RETURNING id`, [req.params.id, req.user.id]);
  if (!r.rowCount) throw E.notFound('Subscription not found or already cancelled');
  await db.query("UPDATE invoices SET status='VOID' WHERE subscription_id=$1 AND status='UNPAID'", [req.params.id]);
  res.json({ status: 'CANCELLED' });
}));
module.exports = router;
