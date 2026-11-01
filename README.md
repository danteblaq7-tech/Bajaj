# Pwani Ride: tuktuk ride-hailing MVP for the Kenyan coast

One repository, four parts:

| Folder | What it is |
|---|---|
| `backend/` | Node.js + Express + PostgreSQL API: auth, bookings, dispatch, M-Pesa, parcels, tours, subscriptions, photo uploads, push notifications |
| `dashboard/` | Operations web app (live Leaflet map, drivers, shifts with photos, revenue, maintenance, incidents). Served by the backend at `/dashboard` |
| `apps/customer/` | React Native (Expo) customer app: rides, tours, parcels, plans, wallet, live map |
| `apps/driver/` | React Native (Expo) driver app: shift checklist with photo upload and QR scan, ride offers, trips, parcels, map |

Everything is plain JavaScript. The three phone and web clients talk only to `backend/` over `/api`.

```
 customer app ─┐                                   ┌─ PostgreSQL
 driver app  ──┼──►  Express API  (/api, /uploads) ┼─ photo storage (disk volume)
 dashboard  ───┘     /dashboard (static)           ├─ M-Pesa Daraja (STK push + callback)
                                                   ├─ Expo push service ─► FCM / APNs
                                                   └─ Africa's Talking SMS
```

## 1. Start the backend and dashboard

**With Docker (easiest):**
```bash
docker compose up --build
```
Open http://localhost:4000 (goes to the dashboard). Sign in with `admin@pwaniride.test` / `ChangeMe123!`.

**Without Docker** (needs Node 18+ and PostgreSQL 13+):
```bash
cd backend
npm install
cp .env.example .env            # edit DATABASE_URL if needed
createdb pwani_ride
npm run migrate && npm run seed
npm run dev
```

In development, M-Pesa is mocked (a payment approves about 3 seconds after the prompt), SMS is printed in the server log, and the login code is always `123456`. Seeded data: admin, a demo driver (`0700000001`, PIN `1234`), five vehicles (QR text `PR-VEH-001` to `PR-VEH-005`), two tours and three partner codes (`DEMO-CO`, `DEMO-SCH`, `DEMO-HTL`).

**Check the whole flow automatically** (server running): `cd backend && npm run smoke`. It signs up a customer, uploads a photo, starts a driver shift, books and pays a ride, dispatches it, completes it, rates it and checks the admin reports. Fix anything it reports before testing on phones. `npm test` runs the unit tests (no database needed).

## 2. Set up the two phone apps

```bash
./scripts/setup-apps.sh      # creates package.json from the official Expo template and installs the native modules
```
Then edit both `apps/*/app.json`:
- `android.config.googleMaps.apiKey` and `ios.config.googleMapsApiKey`: Google Maps keys (Maps SDK for Android and iOS). Expo Go shows maps without them, but your own builds need them.
- `extra.eas.projectId`: your EAS project id (run `npx eas init` inside each app). Needed for push tokens.

Run against your computer (phone and computer on the same Wi-Fi; use the computer's LAN IP):
```bash
cd apps/customer && EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api npx expo start
cd apps/driver   && EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api npx expo start
```
Photo links come back from the server as `/uploads/...`; the dashboard displays them on the same server.

**Push notifications need a development build.** Remote push no longer works in Expo Go on Android. Build once with `npx eas build --profile development --platform android` (and iOS if you have an Apple developer account), install it, and the apps register their push token automatically after sign-in. Until then both apps still refresh by polling (rides every 3 to 4 seconds), so everything works, just without background alerts.

## 3. Try it with two phones

1. **Driver phone:** sign in `0700000001` / `1234`. Do the checklist (photos upload to the server), scan a QR code that contains `PR-VEH-001`, tap Go online and keep location on.
2. **Customer phone:** sign in with your number and code `123456`. Book a ride near the driver (within 8 km), pay with M-Pesa (mock), then watch the map.
3. **Driver phone:** accept the offer within 30 seconds, start the trip, end it.
4. **Dashboard:** see the driver on the map, the shift photos under Shifts, and the revenue.

## 4. What is configured where

| Setting | Where |
|---|---|
| Fares, commission, plan fees, dispatch radius and timings | `backend/src/config.js` (placeholders: replace with your real figures) |
| Driver pay for a subscription ride (the rider pays nothing per ride) | `SUBSCRIPTION_TRIP_PAY` (placeholder KES 150) |
| Secrets and provider keys | `backend/.env` (see `.env.example` for every variable) |
| Popular stops list | `apps/customer/src/places.js` (approximate coordinates: check them) |
| Swahili text | `apps/*/src/sw.js` (phone apps), `backend/src/services/i18n.js` (notifications and SMS) |

## 5. The newer features and how to switch them on

**Drawn routes and road-distance fares.** The server asks a routing service for the driving route (`GET /api/routes`), caches it, and uses the real road distance to price rides and parcels (falls back to straight-line distance if routing is down). Default is OSRM's public demo server, which is for testing only: self-host OSRM or OpenRouteService for production, or set `ROUTING_PROVIDER=google` with `GOOGLE_MAPS_SERVER_KEY`.

**Scheduled rides.** The customer app's "Later" option picks a day and time (30-minute steps, at least 15 minutes ahead, up to 60 days). The customer pays up front; the server starts looking for a driver about 30 minutes before pickup and sends a push notification when one is assigned.

**Card payments.** Uses Paystack's hosted checkout (card details never touch your app or server). Set `PAYSTACK_SECRET_KEY`, register `{PUBLIC_URL}/api/payments/card/webhook` in the Paystack dashboard, and confirm with Paystack that your account can take KES cards. Without a key, development uses a mock that approves after 4 seconds. Cards also work for wallet top-ups. To use another gateway, replace `backend/src/services/card.js` (three functions).

**Weekly driver payouts.** Every Monday (Nairobi time) the server groups each driver's unpaid completed trips and parcels into one payout and leaves it **pending**. In the dashboard (Payouts page) an **admin** (not ops staff) approves each one, which sends it by M-Pesa B2C. Payouts under `PAYOUT_MIN` roll into the next week. If M-Pesa gives an unclear answer (a timeout), the payout stays "processing" and you must check your M-Pesa statement before retrying, so nobody is paid twice. Needs a Daraja B2C shortcode, initiator name and password, Safaricom's public certificate file (`MPESA_CERT_PATH`) and a publicly reachable `PUBLIC_URL`. Test it in the sandbox first. The Daraja B2C request format was written from memory of the documentation: check it against the current Daraja docs.

**Background location (driver app).** After a one-time disclosure screen, the driver app keeps sending its location while online, even with the screen off or the app closed (Android shows a "Pwani Ride is online" notification). It needs a development or production build, not Expo Go. For Google Play you must complete the background-location declaration and review the disclosure wording; on Android 11+ the driver must pick "Allow all the time" in settings. It falls back to foreground-only if they decline. Expect higher battery use.

**Swahili.** Both apps switch between English and Kiswahili (toggle on the sign-in and account screens; default follows the phone's language). Notifications and SMS follow the user's saved language. The translations were written by an AI, not a professional translator: have a native speaker review `sw.js` and `i18n.js` before launch. Text built from several parts (for example some sentences with names or amounts) may still show in English.

**Camera footage.** The server stores and manages clips; it does not include camera hardware or an in-vehicle recorder. Cameras or a small gateway device push MP4 clips to `POST /api/footage/device` with the vehicle's camera key (created from the Fleet page, shown once). Many dashcams cannot do this on their own: you need a camera that can upload to a URL, or a small device (for example an Android tablet or Raspberry Pi) in each vehicle that records and uploads. Clips are never public: staff play them through links that expire after 5 minutes, and every viewing is logged. Clips are deleted after `FOOTAGE_RETENTION_DAYS` (30) unless held, and clips around a logged incident are held automatically. In-vehicle recording of passengers needs a visible notice and a data-protection policy (Kenya Data Protection Act): get legal advice.

## 6. Before real customers use it

1. **Run it yourself end to end** (smoke test, then two phones). Nothing here was run against a live database, phones, Safaricom or Paystack while it was written.
2. **Production mode** (`NODE_ENV=production`) refuses to start without real secrets and never uses mock M-Pesa. Put it behind HTTPS and set `PUBLIC_URL`, `CORS_ORIGINS`, `TRUST_PROXY`.
3. **M-Pesa go-live** (payments and payouts), **Paystack live keys**, and a reachable callback URL.
4. **Storage:** photos and footage are on one server's disk. Use persistent volumes with backups, or move to S3 (keep `save()` contracts in `storage.js` / `footage.js`).
5. **Dashboard:** it loads Leaflet from cdnjs and OpenStreetMap tiles. Fine for a pilot; for production vendor Leaflet and use a tile provider.
6. **Safety and legal:** NTSA rules for tuktuks and school pupils, insurance, driver vetting, camera privacy notice, and Google Play / App Store review for background location.
7. Change the seeded admin password and delete the demo driver.

## 7. Known limits

- **Untested in the real world.** Expect small fixes, especially in payment and payout integrations.
- Group tours dispatch one tuktuk per 3 people, but the extra tuktuks' drivers are not paid separately yet (the booking that carries the fare belongs to the first driver).
- Subscription ride pay is a flat placeholder, not tied to distance.
- Parcel delivery codes are sent by SMS, so the smoke test cannot complete a parcel delivery.
- No promo codes, no admin screens for tours, partner organizations or plan prices (use SQL), no audit log beyond footage access, no refunds to cards (refunds go to the wallet).
- Offers still use the 3-second check as a fallback next to push notifications.
