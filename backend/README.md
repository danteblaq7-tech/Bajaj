# Pwani Ride API

Node.js + Express + PostgreSQL backend for the tuktuk ride-hailing MVP. Plain JavaScript (CommonJS), no build step.

## Run it

```bash
npm install
cp .env.example .env          # then edit the values
createdb pwani_ride           # PostgreSQL 13+
npm run migrate               # creates the tables
npm run seed                  # admin, sample tours, partner codes, 5 vehicles, demo driver (not in production)
npm run dev                   # http://localhost:4000
npm test                      # unit tests (no database needed)
```

In development, M-Pesa runs in **mock mode** (a payment succeeds 3 seconds after the prompt) and SMS/push are printed to the console. `OTP_DEV_CODE=123456` lets you log in without an SMS provider. Mock mode is refused in production.

## Try the main flow

```bash
API=http://localhost:4000/api
# customer: register, verify, book, pay
curl -X POST $API/auth/register -H 'content-type: application/json' -d '{"phone":"0712345678","name":"Amina"}'
curl -X POST $API/auth/otp/verify -H 'content-type: application/json' -d '{"phone":"0712345678","code":"123456"}'   # returns accessToken
# driver (seeded): POST $API/drivers/login {"phone":"0700000001","pin":"1234"}, then
#   POST /drivers/shifts/start with vehicle_qr "PR-VEH-001", POST /drivers/location every ~10s
# customer: POST /bookings -> POST /bookings/:id/pay -> driver GET /drivers/offers/current -> accept -> /bookings/:id/start -> /complete -> customer /rate
```

## Endpoints

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/otp/send`, `/auth/otp/verify`, `/auth/login` (staff), `/auth/refresh` |
| Users | `GET/PATCH /users/me`, `GET /users/me/bookings`, `GET /users/me/wallet`, `POST /users/me/wallet/topup` |
| Bookings | `POST /bookings/estimate`, `POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/pay`, `/cancel`, `/rate`; driver: `/start`, `/complete` |
| Tours | `GET /tours`, `GET /tours/:id`, `POST /tours/:id/book` |
| Parcels | `POST /parcels`, `GET /parcels`, `GET /parcels/:tracking_id` (public), driver: `POST /parcels/:id/pickup`, `/deliver` |
| Subscriptions | `GET /subscriptions/plans`, `POST /subscriptions`, `GET /subscriptions/me`, `POST /subscriptions/:id/cancel` |
| Drivers | `POST /drivers/login`, `GET /drivers/me`, `POST /drivers/shifts/start`, `/shifts/end`, `/location`, `GET /drivers/offers/current`, `POST /drivers/offers/:id/accept`, `/decline`, `GET /drivers/trips/current`, `GET /drivers/earnings` |
| Payments | `POST /payments/mpesa/stkpush`, `POST /payments/mpesa/callback`, `POST /payments/card/charge` (501 for now), `GET /payments/:id/receipt` |
| Admin | `GET /admin/fleet/live`, `GET/POST /admin/drivers`, `POST /admin/drivers/:id/approve`, `/suspend`, `/training`, `GET /admin/reports/revenue`, `GET/POST /admin/incidents`, `POST /admin/incidents/:id/resolve`, `GET/POST /admin/maintenance`, `PATCH /admin/maintenance/:id`, `POST /admin/vehicles`, `/vehicles/:id/disable` |

Errors always look like `{ "error": { "message": "...", "details": {...} } }` with 400, 401, 403, 404, 409 or 503 as in your error-handling flowchart.

## How the key flows work

- **Payment:** a booking starts `PENDING`. An M-Pesa prompt is sent; Safaricom calls `/payments/mpesa/callback` (guarded by `MPESA_CALLBACK_TOKEN`). On success the booking becomes `PAID` and dispatch runs. Timeouts are retried 3 times with backoff; payments with no callback after 2 minutes are checked against Daraja. After more than 3 failed attempts a booking is cancelled.
- **Dispatch:** the nearest free online driver (then rating, then fewest trips today) gets a 30-second offer. Decline or no answer moves to the next driver. If nobody is free the customer is told about high demand and the job retries every 10 seconds. Tours go only to tour-certified drivers.
- **Shifts:** the driver submits the checklist photos, fuel level, selfie and the vehicle's dashboard QR code. Only then do the driver and vehicle go `ONLINE`.
- **Parcels:** pay, nearest driver assigned, driver scans pickup, recipient gets a 4-digit code by SMS, driver enters it to complete delivery (5 attempts max).
- **Subscriptions:** organization code checked, first invoice created, paid via M-Pesa. An hourly job issues renewal invoices, allows 3 days of grace, then suspends.
- **GPS lost:** a driver on a trip with no ping for 90 seconds is flagged and admins are alerted. Customers then see the last known position marked as `estimated`.

## What is not done yet (be aware before launch)

- **Not run against a live Postgres, Daraja or an SMS provider.** Syntax and unit tests pass; the SQL and the integrations still need a real test run. Expect small fixes.
- Push notifications are logged only (TODO: Firebase Cloud Messaging; tokens are stored via `PATCH /users/me`).
- Photos and files are passed as URLs. Add an upload service (S3 or similar) with signed URLs.
- Card payments return 501. Weekly driver payouts (M-Pesa B2C) are not built.
- Group tours: one lead booking carries the total fare and extra tuktuks are dispatched with it, but there is no ops screen for groups that cannot be fully staffed.
- Prices, commission (20%), plan fees and the 25% road-distance factor are placeholders in `src/config.js`.
- Live tracking is polling (`GET /bookings/:id`). Add Socket.io later if you need push updates.
- No camera-footage storage, admin audit log or schema migration tool yet.
- The admin dashboard prototype uses different field names from these endpoints (for example `plate` vs `plate_number`), so it needs a small mapping layer when you connect it. A published claude.ai page cannot call your server, so host `admin-dashboard.html` yourself and set `API_BASE`.

## Added in the combined MVP

- `POST /api/uploads` (image bytes as the body, `Content-Type: image/jpeg|png|webp`, max 5 MB) returns `{ url: "/uploads/<name>" }`. The file type is checked from its first bytes. Files are served from `/uploads`. Run `npm run smoke` for an end-to-end check.
- `DELETE /api/users/me/push-token`, and `PATCH /api/users/me { push_token }` now registers an Expo push token (one phone belongs to one account).
- `GET /api/admin/shifts` lists recent shifts with checklist photos and selfies.
- The admin dashboard is served at `/dashboard` (see the root README).
