const db = require('../db');
const notify = require('./notify');
const payments = require('./payments');

// Hourly job: renew invoices, apply the 3-day grace period, suspend unpaid subscriptions.
async function run() {
  const due = (await db.query(
    `SELECT s.id, s.user_id, s.monthly_fee FROM subscriptions s
     WHERE s.status='ACTIVE' AND s.auto_renew AND s.end_date <= CURRENT_DATE`)).rows;
  for (const s of due) {
    const inv = await db.tx(async (c) => {
      const open = await c.query("SELECT id FROM invoices WHERE subscription_id=$1 AND status='UNPAID'", [s.id]);
      if (open.rowCount) return null;
      await c.query("UPDATE subscriptions SET status='GRACE' WHERE id=$1", [s.id]);
      return (await c.query("INSERT INTO invoices(subscription_id,amount,due_date) VALUES($1,$2,CURRENT_DATE) RETURNING id", [s.id, s.monthly_fee])).rows[0];
    });
    if (!inv) continue;
    await notify.toUser(s.user_id, 'Subscription renewal', `Your renewal of KES ${s.monthly_fee} is due. You have 3 days to pay.`, { sms: true });
    // Best effort: send an M-Pesa prompt right away. Failure is fine, the customer can pay in the app.
    payments.initiate({ id: s.user_id }, { purpose: 'INVOICE', targetId: inv.id, method: 'MPESA' }).catch(() => {});
  }
  const suspended = await db.query(
    `UPDATE subscriptions s SET status='SUSPENDED' WHERE status='GRACE'
       AND EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id=s.id AND i.status='UNPAID' AND i.due_date < CURRENT_DATE - 3)
     RETURNING user_id`);
  for (const r of suspended.rows) await notify.toUser(r.user_id, 'Subscription suspended', 'Your subscription was suspended because the renewal was not paid.', { sms: true });
  await db.query("UPDATE subscriptions SET status='CANCELLED' WHERE status='ACTIVE' AND NOT auto_renew AND end_date < CURRENT_DATE");
}
module.exports = { run };
