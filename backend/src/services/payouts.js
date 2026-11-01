// Weekly driver payouts. Every Monday (Nairobi time) the previous work is gathered into one PENDING payout per driver.
// An ADMIN approves each payout in the dashboard, which sends it by M-Pesa B2C. Nothing is paid without approval.
const db = require('../db');
const config = require('../config');
const mpesa = require('./mpesa');
const notify = require('./notify');
const E = require('../utils/errors');
const { weekStart } = require('../utils/time');

const SUB_PAY = Number(config.payouts.subscriptionTripPay);
// What a booking earns before commission. Subscription rides have fare 0, so they earn a flat rate instead.
const EARN = `(CASE WHEN b.service_type='SUBSCRIPTION' THEN ${SUB_PAY} ELSE b.fare END)`;

async function generate(periodEnd = weekStart()) {
  const created = [];
  await db.tx(async (c) => {
    const rows = (await c.query(
      `SELECT driver_id, SUM(amount) AS gross, COUNT(*) AS trips, MIN(t) AS first FROM (
         SELECT b.driver_id, ${EARN} AS amount, b.completed_at AS t FROM bookings b
           WHERE b.status='COMPLETED' AND b.payout_id IS NULL AND b.completed_at < $1 AND b.driver_id IS NOT NULL
         UNION ALL
         SELECT driver_id, fare AS amount, delivered_at AS t FROM parcels
           WHERE status='DELIVERED' AND payout_id IS NULL AND delivered_at < $1 AND driver_id IS NOT NULL) x
       WHERE amount > 0 GROUP BY driver_id`, [periodEnd])).rows;
    for (const r of rows) {
      const commission = +(r.gross * config.commission).toFixed(2);
      const net = +(r.gross - commission).toFixed(2);
      if (net < config.payouts.min) continue; // too small: stays unsettled and rolls into the next week
      const p = (await c.query(
        `INSERT INTO payouts(driver_id,period_start,period_end,trips,gross,commission,net) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [r.driver_id, r.first, periodEnd, r.trips, r.gross, commission, net])).rows[0];
      await c.query("UPDATE bookings SET payout_id=$2 WHERE driver_id=$1 AND status='COMPLETED' AND payout_id IS NULL AND completed_at<$3", [r.driver_id, p.id, periodEnd]);
      await c.query("UPDATE parcels SET payout_id=$2 WHERE driver_id=$1 AND status='DELIVERED' AND payout_id IS NULL AND delivered_at<$3", [r.driver_id, p.id, periodEnd]);
      created.push(p);
    }
  });
  return created;
}

async function approve(id, adminId) {
  const p = await db.tx(async (c) => {
    const r = (await c.query(
      `SELECT p.*, u.phone FROM payouts p JOIN drivers d ON d.id=p.driver_id JOIN users u ON u.id=d.user_id WHERE p.id=$1 FOR UPDATE OF p`, [id])).rows[0];
    if (!r) throw E.notFound('Payout not found');
    if (!['PENDING', 'FAILED'].includes(r.status)) throw E.conflict(`This payout is ${r.status.toLowerCase()}`);
    await c.query("UPDATE payouts SET status='PROCESSING', approved_by=$2, failure_reason=NULL WHERE id=$1", [id, adminId]);
    return r;
  });
  try {
    const r = await mpesa.b2c({ phone: p.phone, amount: p.net, remarks: 'Pwani Ride weekly payout', occasion: p.id.slice(0, 8) });
    await db.query('UPDATE payouts SET conversation_id=$2, originator_id=$3 WHERE id=$1', [id, r.conversationId, r.originatorId]);
    if (r.mock) setTimeout(() => handleResult({ Result: { ResultCode: 0, ConversationID: r.conversationId, ResultParameters: { ResultParameter: [{ Key: 'TransactionReceipt', Value: 'MOCKB2C' + Date.now().toString(36).toUpperCase() }] } } }).catch((e) => console.error(e.message)), 3000).unref();
    return { status: 'PROCESSING' };
  } catch (e) {
    console.error('[payout] B2C request failed:', e.message);
    if (e.definite) {
      await db.query("UPDATE payouts SET status='FAILED', failure_reason=$2 WHERE id=$1", [id, e.message.slice(0, 200)]);
      throw E.badRequest(`Payout was not sent: ${e.message}`);
    }
    // Unclear outcome (timeout, network): money may have been sent. Leave it PROCESSING and check M-Pesa before retrying.
    await db.query("UPDATE payouts SET failure_reason=$2 WHERE id=$1", [id, 'No clear answer from M-Pesa. Check the M-Pesa statement before doing anything else.']);
    throw E.unavailable('No clear answer from M-Pesa. The payout stays "processing". Check your M-Pesa statement before retrying.');
  }
}

async function cancel(id) {
  await db.tx(async (c) => {
    const p = (await c.query("UPDATE payouts SET status='CANCELLED' WHERE id=$1 AND status IN ('PENDING','FAILED') RETURNING id", [id])).rows[0];
    if (!p) throw E.conflict('Only pending or failed payouts can be cancelled');
    await c.query('UPDATE bookings SET payout_id=NULL WHERE payout_id=$1', [id]); // the work rolls into the next payout
    await c.query('UPDATE parcels SET payout_id=NULL WHERE payout_id=$1', [id]);
  });
}

// Safaricom result callback (authenticated by the secret token in the URL).
async function handleResult(body) {
  const r = body && body.Result;
  if (!r) throw E.badRequest('Malformed result');
  const params = Object.fromEntries((((r.ResultParameters || {}).ResultParameter) || []).map((x) => [x.Key, x.Value]));
  const ok = Number(r.ResultCode) === 0;
  const row = (await db.query(
    `UPDATE payouts SET status=$2, receipt_ref=$3, failure_reason=$4, paid_at=CASE WHEN $2='PAID' THEN now() END
     WHERE status='PROCESSING' AND (conversation_id=$1 OR originator_id=$5) RETURNING *`,
    [r.ConversationID, ok ? 'PAID' : 'FAILED', params.TransactionReceipt || null, ok ? null : String(r.ResultDesc || 'Failed').slice(0, 200), r.OriginatorConversationID || null])).rows[0];
  if (!row) return;
  if (ok) {
    const u = (await db.query('SELECT user_id FROM drivers WHERE id=$1', [row.driver_id])).rows[0];
    if (u) await notify.toUser(u.user_id, 'Payout sent', `KES ${row.net} was sent to your M-Pesa. Receipt ${params.TransactionReceipt || row.id.slice(0, 8)}.`, { sms: true });
  } else notify.alertAdmin(`Payout ${row.id} failed: ${r.ResultDesc}`);
}

module.exports = { generate, approve, cancel, handleResult, weekStart };
