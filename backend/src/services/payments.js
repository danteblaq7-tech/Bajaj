const db = require('../db');
const config = require('../config');
const mpesa = require('./mpesa');
const card = require('./card');
const notify = require('./notify');
const E = require('../utils/errors');
const dispatch = () => require('./dispatch'); // lazy: avoids a circular import

// ---- what is being paid for -------------------------------------------------
async function resolveTarget(user, purpose, id, amount) {
  if (purpose === 'WALLET_TOPUP') return { amount };
  if (purpose === 'INVOICE') {
    const r = (await db.query(
      `SELECT i.amount, i.status, i.subscription_id, s.user_id FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id WHERE i.id=$1`, [id])).rows[0];
    if (!r) throw E.notFound('Invoice not found');
    if (r.user_id !== user.id) throw E.forbidden('This invoice belongs to another account');
    if (r.status !== 'UNPAID') throw E.conflict('This invoice is already settled');
    return { amount: r.amount, subscriptionId: r.subscription_id };
  }
  const table = purpose === 'BOOKING' ? 'bookings' : 'parcels';
  const owner = purpose === 'BOOKING' ? 'user_id' : 'sender_id';
  const r = (await db.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0];
  if (!r) throw E.notFound(`${purpose === 'BOOKING' ? 'Booking' : 'Parcel'} not found`);
  if (r[owner] !== user.id) throw E.forbidden('This item belongs to another account');
  if (r.status !== 'PENDING') throw E.conflict(`This item is ${r.status.toLowerCase()} and cannot be paid`);
  return { amount: r.fare };
}

const INSERT = `INSERT INTO payments(user_id,purpose,booking_id,parcel_id,invoice_id,subscription_id,amount,method)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
const insertArgs = (user, purpose, id, t, method) => [
  user.id, purpose, purpose === 'BOOKING' ? id : null, purpose === 'PARCEL' ? id : null,
  purpose === 'INVOICE' ? id : null, t.subscriptionId || null, t.amount, method,
];
async function runAfter(after) { if (after) { try { await after(); } catch (e) { console.error('[payments] post-settle:', e.message); } } }

// ---- start a payment --------------------------------------------------------
async function initiate(user, { purpose, targetId, method = 'MPESA', phone, amount }) {
  if (method === 'CARD' && !config.card.enabled) throw E.notImplemented('Card payments are not enabled yet. Use M-Pesa or your wallet.');
  if (method === 'WALLET' && purpose === 'WALLET_TOPUP') throw E.badRequest('Top up your wallet with M-Pesa');
  const t = await resolveTarget(user, purpose, targetId, amount);
  if (!(t.amount > 0)) throw E.badRequest('Amount must be greater than zero');

  const col = { BOOKING: 'booking_id', PARCEL: 'parcel_id', INVOICE: 'invoice_id' }[purpose];
  if (col) {
    const dup = await db.query(`SELECT 1 FROM payments WHERE ${col}=$1 AND status='PENDING' AND created_at>now()-interval '2 minutes'`, [targetId]);
    if (dup.rowCount) throw E.conflict('A payment prompt is already waiting on your phone. Approve it, or wait 2 minutes to try again.');
  }

  if (method === 'WALLET') {
    let after;
    const pid = await db.tx(async (c) => {
      const w = await c.query('UPDATE wallets SET balance=balance-$2, updated_at=now() WHERE user_id=$1 AND balance>=$2 RETURNING balance', [user.id, t.amount]);
      if (!w.rowCount) throw E.badRequest('Insufficient wallet balance. Top up to continue.');
      const p = (await c.query(INSERT, insertArgs(user, purpose, targetId, t, 'WALLET'))).rows[0];
      after = await settleIn(c, p, true, 'WALLET-' + p.id.slice(0, 8).toUpperCase());
      return p.id;
    });
    await runAfter(after);
    return { payment_id: pid, status: 'SUCCESS', method: 'WALLET' };
  }

  if (method === 'CARD') {
    const p = (await db.query(INSERT, insertArgs(user, purpose, targetId, t, 'CARD'))).rows[0];
    const ref = `PR-${p.id}`;
    try {
      const u = (await db.query('SELECT email, phone FROM users WHERE id=$1', [user.id])).rows[0];
      const r = await card.initialize({
        email: u.email || `${u.phone}@${config.card.emailDomain}`, amount: t.amount, reference: ref,
        callbackUrl: `${config.publicUrl}/pay/return`, metadata: { payment_id: p.id },
      });
      await db.query('UPDATE payments SET transaction_ref=$2 WHERE id=$1', [p.id, ref]);
      if (r.mock) setTimeout(() => settle(p.id, true, 'MOCKCARD' + Date.now().toString(36).toUpperCase()).catch((e) => console.error(e.message)), 4000).unref();
      return { payment_id: p.id, status: 'PENDING', method: 'CARD', checkout_url: r.checkoutUrl, message: 'Complete the card payment in the secure page that opens.' };
    } catch (err) {
      console.error('[card] initialize failed:', err.message);
      await db.query("UPDATE payments SET status='FAILED' WHERE id=$1", [p.id]);
      throw E.unavailable('Card payments are not responding right now. Try M-Pesa or your wallet.', { alternative: 'WALLET' });
    }
  }

  const p = (await db.query(INSERT, insertArgs(user, purpose, targetId, t, 'MPESA'))).rows[0];
  try {
    const to = phone || (await db.query('SELECT phone FROM users WHERE id=$1', [user.id])).rows[0].phone;
    const r = await mpesa.stkPush({ phone: to, amount: t.amount, reference: p.id.replace(/-/g, ''), description: 'PwaniRide' });
    await db.query('UPDATE payments SET transaction_ref=$2 WHERE id=$1', [p.id, r.checkoutRequestId]);
    if (r.mock) setTimeout(() => settle(p.id, true, 'MOCK' + Date.now().toString(36).toUpperCase()).catch((e) => console.error(e.message)), 3000).unref();
  } catch (err) {
    console.error('[mpesa] STK push failed:', err.message);
    await db.query("UPDATE payments SET status='FAILED' WHERE id=$1", [p.id]);
    throw E.unavailable('M-Pesa is not responding right now. Try again shortly, or pay from your wallet.', { alternative: 'WALLET' });
  }
  return { payment_id: p.id, status: 'PENDING', method: 'MPESA', message: 'Check your phone and enter your M-Pesa PIN.' };
}

// ---- settle (idempotent) ----------------------------------------------------
async function settleIn(c, p, ok, receipt) {
  await c.query('UPDATE payments SET status=$2, receipt_ref=$3 WHERE id=$1', [p.id, ok ? 'SUCCESS' : 'FAILED', receipt || null]);
  return ok ? onSuccess(c, p, receipt) : onFailure(c, p);
}
async function settle(paymentId, ok, receipt) {
  let after = null;
  await db.tx(async (c) => {
    const p = (await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId])).rows[0];
    if (!p || p.status !== 'PENDING') return; // already handled: callbacks can arrive twice
    after = await settleIn(c, p, ok, receipt);
  });
  await runAfter(after);
}

async function onSuccess(c, p, receipt) {
  const afters = [];
  if (p.purpose === 'BOOKING') {
    await c.query("UPDATE bookings SET status='PAID', payment_method=$2 WHERE id=$1 AND status='PENDING'", [p.booking_id, p.method]);
    const kids = (await c.query("UPDATE bookings SET status='PAID' WHERE group_id=$1 AND status='PENDING' RETURNING id", [p.booking_id])).rows;
    const ids = [p.booking_id, ...kids.map((k) => k.id)];
    afters.push(() => Promise.all(ids.map((id) => dispatch().dispatchBooking(id))));
  } else if (p.purpose === 'PARCEL') {
    await c.query("UPDATE parcels SET status='PAID' WHERE id=$1 AND status='PENDING'", [p.parcel_id]);
    afters.push(() => dispatch().assignParcel(p.parcel_id));
  } else if (p.purpose === 'INVOICE') {
    await c.query("UPDATE invoices SET status='PAID', paid_at=now() WHERE id=$1", [p.invoice_id]);
    await c.query(
      `UPDATE subscriptions SET status='ACTIVE', start_date=COALESCE(start_date,CURRENT_DATE),
         end_date=(GREATEST(COALESCE(end_date,CURRENT_DATE),CURRENT_DATE) + INTERVAL '1 month')::date
       WHERE id=$1 AND status IN ('PENDING','ACTIVE','GRACE','SUSPENDED')`, [p.subscription_id]);
  } else if (p.purpose === 'WALLET_TOPUP') {
    await c.query(
      `INSERT INTO wallets(user_id,balance) VALUES($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET balance=wallets.balance+$2, updated_at=now()`, [p.user_id, p.amount]);
  }
  afters.push(() => notify.toUser(p.user_id, 'Payment received', `KES ${p.amount} received. Receipt ${receipt || p.id.slice(0, 8)}.`, { sms: true }));
  return async () => { for (const a of afters) { try { await a(); } catch (e) { console.error('[payments] after:', e.message); } } };
}

async function onFailure(c, p) {
  if (p.purpose === 'BOOKING') {
    const b = (await c.query("UPDATE bookings SET payment_attempts=payment_attempts+1 WHERE id=$1 AND status='PENDING' RETURNING payment_attempts", [p.booking_id])).rows[0];
    if (b && b.payment_attempts > 3) {
      await c.query("UPDATE bookings SET status='CANCELLED', cancelled_at=now() WHERE id=$1 OR group_id=$1", [p.booking_id]);
      return () => notify.toUser(p.user_id, 'Booking cancelled', 'We cancelled your booking after several failed payments.', { sms: true });
    }
  }
  return () => notify.toUser(p.user_id, 'Payment failed', 'Your payment did not go through. Please try again.');
}

// ---- Daraja callback --------------------------------------------------------
async function handleMpesaCallback(body) {
  const cb = body && body.Body && body.Body.stkCallback;
  if (!cb || !cb.CheckoutRequestID) throw E.badRequest('Malformed callback');
  const p = (await db.query('SELECT * FROM payments WHERE transaction_ref=$1', [cb.CheckoutRequestID])).rows[0];
  if (!p) return; // unknown reference: acknowledge anyway so Safaricom stops retrying
  const items = Object.fromEntries((((cb.CallbackMetadata || {}).Item) || []).map((i) => [i.Name, i.Value]));
  let ok = Number(cb.ResultCode) === 0;
  if (ok && Number(items.Amount) < Number(p.amount)) {
    ok = false;
    notify.alertAdmin(`M-Pesa amount mismatch on payment ${p.id}: paid ${items.Amount}, expected ${p.amount}. Receipt ${items.MpesaReceiptNumber}. Refund manually.`);
  }
  await settle(p.id, ok, items.MpesaReceiptNumber);
}

// Pending M-Pesa and card payments with no confirmation after a few minutes: ask the provider what happened.
async function reconcilePending() {
  const rows = (await db.query(
    `SELECT *, EXTRACT(EPOCH FROM (now()-created_at)) AS age FROM payments
     WHERE status='PENDING' AND method IN ('MPESA','CARD') AND created_at>now()-interval '1 day'
       AND created_at < now() - CASE method WHEN 'CARD' THEN interval '5 minutes' ELSE interval '2 minutes' END`)).rows;
  for (const p of rows) {
    if (!p.transaction_ref || (p.method === 'MPESA' && config.mpesa.mock) || (p.method === 'CARD' && config.card.mock)) { await settle(p.id, false); continue; }
    try {
      if (p.method === 'CARD') {
        const v = await card.verify(p.transaction_ref);
        if (v.status === 'success' && v.amount >= Math.round(p.amount * 100)) await settle(p.id, true, p.transaction_ref);
        else if (v.status === 'failed' || (v.status === 'abandoned' && p.age > 1800)) await settle(p.id, false);
      } else {
        const j = await mpesa.query(p.transaction_ref);
        await settle(p.id, String(j.ResultCode) === '0', null);
      }
    } catch (e) {
      if (p.method === 'MPESA' && p.age > 600) await settle(p.id, false); // still unknown after 10 minutes: treat as failed
    }
  }
}

// Paystack webhook: the signature proves it came from Paystack, and we double-check the amount with their API.
async function handleCardWebhook(rawBody, signature, body) {
  if (!rawBody || !card.validSignature(rawBody, signature)) throw E.unauthorized('Invalid signature');
  if (!body || body.event !== 'charge.success' || !body.data) return;
  const ref = body.data.reference;
  const p = (await db.query("SELECT * FROM payments WHERE transaction_ref=$1 AND method='CARD'", [ref])).rows[0];
  if (!p) return;
  let v;
  try { v = await card.verify(ref); } catch (e) { return; } // the reconcile job will retry
  if (v.status === 'success' && v.amount >= Math.round(p.amount * 100)) await settle(p.id, true, ref);
  else notify.alertAdmin(`Card payment ${p.id} reported as paid but verification disagrees (status ${v.status}, amount ${v.amount}).`);
}

async function refundToWallet(c, userId, amount, bookingId) {
  await c.query(
    `INSERT INTO wallets(user_id,balance) VALUES($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET balance=wallets.balance+$2, updated_at=now()`, [userId, amount]);
  await c.query("UPDATE payments SET refunded=true WHERE booking_id=$1 AND status='SUCCESS'", [bookingId]);
}

async function getReceipt(user, id) {
  const p = (await db.query('SELECT * FROM payments WHERE id=$1', [id])).rows[0];
  if (!p) throw E.notFound('Payment not found');
  if (p.user_id !== user.id && !['ADMIN', 'OPS'].includes(user.role)) throw E.forbidden('This receipt belongs to another account');
  return {
    receipt_no: p.receipt_ref || p.id, status: p.status, purpose: p.purpose, amount: p.amount, currency: p.currency,
    method: p.method, refunded: p.refunded, paid_at: p.created_at,
    booking_id: p.booking_id, parcel_id: p.parcel_id, invoice_id: p.invoice_id,
  };
}
module.exports = { initiate, settle, handleMpesaCallback, handleCardWebhook, reconcilePending, refundToWallet, getReceipt };
