const path = require('path');
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const e = process.env;
const prod = e.NODE_ENV === 'production';
// In production every secret must be set. In development we fall back to obvious dev values.
const need = (k, dev) => {
  const v = e[k];
  if (v) return v;
  if (prod) throw new Error(`Missing required environment variable ${k}`);
  return dev;
};

module.exports = {
  prod,
  port: Number(e.PORT) || 4000,
  publicUrl: need('PUBLIC_URL', `http://localhost:${Number(e.PORT) || 4000}`),
  trustProxy: Number(e.TRUST_PROXY) || 0,
  // Photos are stored on local disk. In production mount a persistent volume here (or swap services/storage.js for S3).
  uploadDir: e.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  expoAccessToken: e.EXPO_ACCESS_TOKEN || null,
  corsOrigins: need('CORS_ORIGINS', '*').split(',').map((s) => s.trim()),
  databaseUrl: need('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/pwani_ride'),
  jwt: {
    access: need('JWT_ACCESS_SECRET', 'dev-access-secret'),
    refresh: need('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    accessTtl: '15m',
    refreshTtl: '30d',
  },
  otp: { ttlMin: 5, maxAttempts: 5, resendSec: 30, devCode: prod ? null : e.OTP_DEV_CODE || null },
  commission: Number(e.COMMISSION_RATE) || 0.2,

  // All prices are placeholders (KES). Replace them with figures from your real cost model.
  pricing: {
    baseFare: 150, perKm: 45, minFare: 200, roadFactor: 1.25, maxKm: 150,
    parcelBase: 120, parcelPerKm: 30, parcelSize: { SMALL: 0, MEDIUM: 80, LARGE: 200 },
  },
  dispatch: { radiusKm: 8, offerTtlSec: 30, staleLocSec: 120, scheduledLeadMin: 30, gpsLostSec: 90 },
  plans: {
    EMPLOYEE: { label: 'Employee monthly', fee: 5000, orgType: 'COMPANY' },
    SCHOOL: { label: 'School pupil monthly', fee: 6000, orgType: 'SCHOOL' },
    HOTEL: { label: 'Hotel guest monthly', fee: 20000, orgType: 'HOTEL' },
  },
  mpesa: {
    // Mock mode is never allowed in production.
    mock: !prod && (e.MPESA_MOCK === 'true' || !e.MPESA_CONSUMER_KEY),
    env: e.MPESA_ENV || 'sandbox',
    key: prod ? need('MPESA_CONSUMER_KEY') : e.MPESA_CONSUMER_KEY,
    secret: prod ? need('MPESA_CONSUMER_SECRET') : e.MPESA_CONSUMER_SECRET,
    shortcode: e.MPESA_SHORTCODE || '174379',
    passkey: prod ? need('MPESA_PASSKEY') : e.MPESA_PASSKEY,
    callbackToken: need('MPESA_CALLBACK_TOKEN', 'dev-callback-token'),
  },
  routing: { provider: e.ROUTING_PROVIDER || 'osrm', osrmUrl: e.OSRM_URL || 'https://router.project-osrm.org', googleKey: e.GOOGLE_MAPS_SERVER_KEY || null },
  // Card payments through Paystack's hosted checkout (no card data touches this server). Mock mode in development.
  card: { secret: e.PAYSTACK_SECRET_KEY || null, mock: !prod && !e.PAYSTACK_SECRET_KEY, emailDomain: e.PAYMENT_EMAIL_DOMAIN || 'pwaniride.app', get enabled() { return !!this.secret || this.mock; } },
  payouts: {
    min: Number(e.PAYOUT_MIN) || 100,
    subscriptionTripPay: Number(e.SUBSCRIPTION_TRIP_PAY) || 150, // placeholder: what a driver earns per subscription ride (the rider pays nothing per ride)
    initiator: e.MPESA_INITIATOR_NAME || null, initiatorPassword: e.MPESA_INITIATOR_PASSWORD || null, certPath: e.MPESA_CERT_PATH || null,
  },
  footage: { dir: e.FOOTAGE_DIR || path.join(__dirname, '..', 'footage'), retentionDays: Number(e.FOOTAGE_RETENTION_DAYS) || 30, maxBytes: 100 * 1024 * 1024, signSecret: need('FOOTAGE_SIGN_SECRET', 'dev-footage-secret') },
  sms: { username: e.AT_USERNAME || 'sandbox', apiKey: e.AT_API_KEY, sender: e.AT_SENDER_ID },
};
