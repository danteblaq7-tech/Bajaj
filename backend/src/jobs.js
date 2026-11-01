const dispatch = require('./services/dispatch');
const payments = require('./services/payments');
const subscriptions = require('./services/subscriptions');
const payouts = require('./services/payouts');
const footage = require('./services/footage');
const notify = require('./services/notify');

// One run at a time per job; errors are logged, never thrown.
function every(name, ms, fn) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { console.error(`[job:${name}]`, e.message); } finally { busy = false; }
  }, ms);
  t.unref();
  return t;
}
exports.start = () => {
  every('dispatch', 10 * 1000, dispatch.sweep);
  every('payments', 30 * 1000, payments.reconcilePending);
  every('subscriptions', 60 * 60 * 1000, subscriptions.run);
  // Hourly and safe to repeat: only work not yet in a payout is picked up. Payouts then wait for an admin to approve them.
  every('payouts', 60 * 60 * 1000, async () => { const made = await payouts.generate(); if (made.length) notify.alertAdmin(`${made.length} weekly payout(s) are waiting for approval in the dashboard.`); });
  every('footage', 6 * 60 * 60 * 1000, footage.retention);
};
