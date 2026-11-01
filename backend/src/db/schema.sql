-- Pwani Ride schema (PostgreSQL 13+). Safe to run more than once.
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  name text,
  email text UNIQUE,
  password_hash text,
  pin_hash text,
  profile_photo text,
  push_token text,
  emergency_contact_phone text,
  role text NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','DRIVER','ADMIN','OPS')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otps_phone_idx ON otps(phone, created_at DESC);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency text NOT NULL DEFAULT 'KES',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text UNIQUE NOT NULL,
  model text,
  year int,
  status text NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE','OFFLINE','ON_TRIP','MAINTENANCE','DISABLED')),
  qr_code text UNIQUE NOT NULL,
  last_maintenance timestamptz
);

CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_number text,
  badge_number text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','ONLINE','ON_TRIP','SUSPENDED')),
  rating numeric(3,2) NOT NULL DEFAULT 5,
  total_trips int NOT NULL DEFAULT 0,
  tour_certified boolean NOT NULL DEFAULT false,
  last_lat double precision,
  last_lng double precision,
  last_seen_at timestamptz,
  gps_lost boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  start_fuel numeric(6,2),
  end_fuel numeric(6,2),
  mileage numeric(8,1),
  checklist jsonb,
  selfie_url text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_driver ON shifts(driver_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_vehicle ON shifts(vehicle_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('COMPANY','SCHOOL','HOTEL')),
  monthly_fee numeric(10,2),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS tours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  stops jsonb NOT NULL DEFAULT '[]',
  duration_hours numeric(4,1) NOT NULL,
  price numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  plan_type text NOT NULL CHECK (plan_type IN ('EMPLOYEE','SCHOOL','HOTEL')),
  organization_code text NOT NULL,
  monthly_fee numeric(10,2) NOT NULL,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','GRACE','SUSPENDED','CANCELLED')),
  auto_renew boolean NOT NULL DEFAULT true,
  schedule jsonb,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PAID','VOID')),
  due_date date NOT NULL,
  paid_at timestamptz
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid REFERENCES drivers(id),
  vehicle_id uuid REFERENCES vehicles(id),
  service_type text NOT NULL CHECK (service_type IN ('RIDE','TOUR','SUBSCRIPTION')),
  tour_id uuid REFERENCES tours(id),
  subscription_id uuid REFERENCES subscriptions(id),
  group_id uuid,
  passengers int NOT NULL DEFAULT 1,
  pickup_address text, pickup_lat double precision NOT NULL, pickup_lng double precision NOT NULL,
  dropoff_address text, dropoff_lat double precision NOT NULL, dropoff_lng double precision NOT NULL,
  fare numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  payment_method text,
  payment_attempts int NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  offered_driver_id uuid REFERENCES drivers(id),
  offer_expires_at timestamptz,
  declined_driver_ids uuid[] NOT NULL DEFAULT '{}',
  demand_notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_driver_idx ON bookings(driver_id, status);
CREATE INDEX IF NOT EXISTS bookings_dispatch_idx ON bookings(status) WHERE driver_id IS NULL;

CREATE TABLE IF NOT EXISTS parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid REFERENCES drivers(id),
  tracking_id text UNIQUE NOT NULL,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  weight numeric(6,2) NOT NULL,
  size text NOT NULL CHECK (size IN ('SMALL','MEDIUM','LARGE')),
  description text,
  pickup_address text, pickup_lat double precision NOT NULL, pickup_lng double precision NOT NULL,
  dropoff_address text, dropoff_lat double precision NOT NULL, dropoff_lng double precision NOT NULL,
  fare numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','ASSIGNED','IN_TRANSIT','DELIVERED','CANCELLED')),
  delivery_code_hash text,
  delivery_attempts int NOT NULL DEFAULT 0,
  pickup_photo text,
  delivery_photo text,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('BOOKING','PARCEL','INVOICE','WALLET_TOPUP')),
  booking_id uuid REFERENCES bookings(id),
  parcel_id uuid REFERENCES parcels(id),
  subscription_id uuid REFERENCES subscriptions(id),
  invoice_id uuid REFERENCES invoices(id),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES',
  method text NOT NULL CHECK (method IN ('MPESA','CARD','WALLET')),
  transaction_ref text,
  receipt_ref text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCESS','FAILED')),
  refunded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_ref_idx ON payments(transaction_ref);
CREATE INDEX IF NOT EXISTS payments_pending_idx ON payments(created_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  booking_id uuid UNIQUE NOT NULL REFERENCES bookings(id),
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES drivers(id),
  booking_id uuid REFERENCES bookings(id),
  description text NOT NULL,
  evidence_url text,
  severity text NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','DONE')),
  assigned_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS gps_points (
  id bigserial PRIMARY KEY,
  driver_id uuid NOT NULL REFERENCES drivers(id),
  booking_id uuid REFERENCES bookings(id),
  parcel_id uuid REFERENCES parcels(id),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed real,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gps_booking_idx ON gps_points(booking_id, recorded_at);
CREATE INDEX IF NOT EXISTS gps_driver_idx ON gps_points(driver_id, recorded_at DESC);

-- ===== Added: language, payouts, camera footage =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','sw'));

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  trips int NOT NULL DEFAULT 0,
  gross numeric(12,2) NOT NULL,
  commission numeric(12,2) NOT NULL,
  net numeric(12,2) NOT NULL CHECK (net >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PAID','FAILED','CANCELLED')),
  conversation_id text,
  originator_id text,
  receipt_ref text,
  failure_reason text,
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON payouts(status);
CREATE INDEX IF NOT EXISTS payouts_conv_idx ON payouts(conversation_id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES payouts(id);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES payouts(id);

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS camera_key_hash text;
CREATE TABLE IF NOT EXISTS footage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  started_at timestamptz NOT NULL,
  duration_s int NOT NULL DEFAULT 0,
  bytes bigint NOT NULL,
  file text NOT NULL,
  hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS footage_vehicle_idx ON footage(vehicle_id, started_at);
CREATE TABLE IF NOT EXISTS footage_access (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  footage_id uuid,
  action text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
