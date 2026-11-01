// Notifications never throw: a failed SMS must not break a booking.
const config = require('../config');
const db = require('../db');
const { tr } = require('./i18n');

async function sms(to, message) {
  if (!config.sms.apiKey) { console.log(`[sms:dev] to=${to} :: ${message}`); return; }
  try {
    const body = new URLSearchParams({ username: config.sms.username, to: '+' + to, message });
    if (config.sms.sender) body.set('from', config.sms.sender);
    const r = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { apiKey: config.sms.apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error('[sms] provider returned', r.status);
  } catch (e) { console.error('[sms] failed:', e.message); }
}

// Push notifications through Expo's push service (which forwards to FCM and APNs).
// Tokens come from the apps (PATCH /users/me { push_token }). Needs a development or production build, not Expo Go on Android.
const validToken = (t) => typeof t === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(t);
async function push(user, title, body, data = {}) {
  if (!validToken(user.push_token)) { console.log(`[push:skip] no device token :: ${title}`); return; }
  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(config.expoAccessToken ? { Authorization: `Bearer ${config.expoAccessToken}` } : {}) },
      body: JSON.stringify({ to: user.push_token, title, body, data, sound: 'default', priority: 'high', channelId: 'rides', ttl: 120 }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => ({}));
    const ticket = Array.isArray(j.data) ? j.data[0] : j.data;
    if (ticket && ticket.status === 'error') {
      console.error('[push] rejected:', ticket.message);
      if (ticket.details && ticket.details.error === 'DeviceNotRegistered') await db.query('UPDATE users SET push_token=NULL WHERE push_token=$1', [user.push_token]);
    }
  } catch (e) { console.error('[push] failed:', e.message); }
}

async function toUser(userId, title, body, opts = {}) {
  try {
    const u = (await db.query('SELECT phone, push_token, language FROM users WHERE id=$1', [userId])).rows[0];
    if (!u) return;
    title = tr(u.language, title); body = tr(u.language, body);
    const { sms: wantSms, ...data } = opts;
    await push(u, title, body, data);
    if (wantSms) await sms(u.phone, `${title}: ${body}`);
  } catch (e) { console.error('[notify] failed:', e.message); }
}

function alertAdmin(message) { console.error('[ADMIN ALERT]', message); }

module.exports = { sms, push, toUser, alertAdmin, validToken, tr };
