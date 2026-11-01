const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
// The dashboard (served at /dashboard) loads Leaflet from cdnjs and map tiles from OpenStreetMap. Everything else stays locked to this server.
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
    styleSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://cdnjs.cloudflare.com'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  } },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins }));
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/payments/card/webhook')) req.rawBody = buf; } }));
app.use((req, res, next) => { // one-line request log
  const t = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t}ms`));
  next();
});

const limiter = (limit, windowMs = 15 * 60 * 1000) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: { message: 'Too many requests. Please wait and try again.' } },
});
app.use(limiter(600, 60 * 1000));

app.use('/uploads', express.static(config.uploadDir, { index: false, dotfiles: 'deny', maxAge: '7d', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use('/dashboard', express.static(path.join(__dirname, '..', '..', 'dashboard'), { index: 'index.html' }));
app.get('/', (req, res) => res.redirect('/dashboard/'));

app.get('/pay/return', (req, res) => res.type('html').send(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title>' +
  '<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px;color:#0F2A33"><h2>Thank you</h2><p>You can close this page and go back to the Pwani Ride app. Your payment will confirm in a moment.</p></body>'));

app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok' }); } catch (e) { res.status(503).json({ status: 'database unavailable' }); }
});

app.use('/api/auth', limiter(40), require('./routes/auth'));
app.use('/api/drivers/login', limiter(20));
app.use('/api/uploads', limiter(120), require('./routes/uploads'));
app.use('/api/routes', limiter(240, 60 * 1000), require('./routes/routes'));
app.use('/api/footage', limiter(300), require('./routes/footage'));
app.use('/api/users', require('./routes/users'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/tours', require('./routes/tours'));
app.use('/api/parcels', require('./routes/parcels'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));

app.use(notFound);
app.use(errorHandler);
module.exports = app;
