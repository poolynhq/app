-- ============================================================
-- Poolyn — Corporate Carpooling Platform
-- Migration: 0001_initial_schema.sql
--
-- Design decisions:
--   • Points system (not money) for driver compensation — avoids
--     rideshare/insurance/money-transmitter regulations entirely.
--   • Flex Credits — limited monthly allowance for guilt-free
--     schedule changes; earned through consistency.
--   • Two onboarding paths: Enterprise-managed and Independent.
--     Independent users auto-join a "community" org created from
--     their email domain, so colleagues discover each other.
--   • Three matching modes coexist: driver-posts, passenger-requests,
--     and system-suggested matches.
--   • PostGIS for all geo — proximity matching now, corridor
--     matching (LineString) when route geometry is available.
-- ============================================================

-- =========================
-- 1. Extensions
-- =========================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =========================
-- 2. Tables
-- =========================

-- ---------------------------------------------------------
-- 3.1 organisations
-- Enterprises register directly; community orgs are auto-
-- created from email domains when independent users sign up.
-- ---------------------------------------------------------
CREATE TABLE public.organisations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  domain          text NOT NULL UNIQUE,
  org_type        text NOT NULL DEFAULT 'community'
                    CHECK (org_type IN ('enterprise', 'community')),
  plan            text NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'starter', 'business', 'enterprise')),
  max_seats       integer,
  allow_cross_org boolean NOT NULL DEFAULT false,
  trial_ends_at   timestamptz,
  active          boolean NOT NULL DEFAULT true,
  settings        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.2 users
-- Extends auth.users via trigger. org_id is nullable only
-- briefly during the trigger — the handle_new_user trigger
-- resolves domain → org immediately.
-- ---------------------------------------------------------
CREATE TABLE public.users (
  id                    uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  org_id                uuid REFERENCES public.organisations ON DELETE SET NULL,
  email                 text NOT NULL UNIQUE,
  full_name             text,
  phone_number          text,
  avatar_url            text,
  role                  text NOT NULL DEFAULT 'both'
                          CHECK (role IN ('driver', 'passenger', 'both')),
  org_role              text NOT NULL DEFAULT 'member'
                          CHECK (org_role IN ('member', 'admin')),
  registration_type     text NOT NULL DEFAULT 'independent'
                          CHECK (registration_type IN ('enterprise', 'independent')),
  home_location         geography(Point, 4326),
  pickup_location       geography(Point, 4326),
  work_location         geography(Point, 4326),
  work_location_label   text,
  detour_tolerance_mins integer NOT NULL DEFAULT 10,
  points_balance        integer NOT NULL DEFAULT 0,
  flex_credits_balance  integer NOT NULL DEFAULT 3,
  license_verified      boolean NOT NULL DEFAULT false,
  onboarding_completed  boolean NOT NULL DEFAULT false,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.3 vehicles
-- ---------------------------------------------------------
CREATE TABLE public.vehicles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  make        text NOT NULL,
  model       text NOT NULL,
  colour      text,
  plate       text,
  seats       integer NOT NULL CHECK (seats >= 1 AND seats <= 9),
  photo_url   text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.4 driver_preferences
-- Core to "don't stress the driver" — these let the matching
-- engine respect driver boundaries.
-- ---------------------------------------------------------
CREATE TABLE public.driver_preferences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL UNIQUE REFERENCES public.users ON DELETE CASCADE,
  max_detour_mins  integer NOT NULL DEFAULT 10,
  max_passengers   integer NOT NULL DEFAULT 3,
  auto_accept      boolean NOT NULL DEFAULT false,
  gender_pref      text NOT NULL DEFAULT 'any'
                     CHECK (gender_pref IN ('any', 'same', 'male', 'female')),
  quiet_ride       boolean NOT NULL DEFAULT false,
  smoking_ok       boolean NOT NULL DEFAULT false,
  pets_ok          boolean NOT NULL DEFAULT false,
  music_ok         boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.5 schedules
-- Three modes: fixed weekly (9-5 M-F), shift windows
-- (rotating/flexible), and ad-hoc (one-off).
-- ---------------------------------------------------------
CREATE TABLE public.schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  type            text NOT NULL
                    CHECK (type IN ('fixed_weekly', 'shift_window', 'adhoc')),
  weekday_times   jsonb,
  shift_start     time,
  shift_end       time,
  tolerance_mins  integer NOT NULL DEFAULT 15,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.6 emergency_contacts
-- ---------------------------------------------------------
CREATE TABLE public.emergency_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  name          text NOT NULL,
  phone_number  text NOT NULL,
  relationship  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.7 rides
-- route_geometry stores the full Mapbox Directions polyline
-- for corridor matching (passengers along the route).
-- ---------------------------------------------------------
CREATE TABLE public.rides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  vehicle_id      uuid NOT NULL REFERENCES public.vehicles ON DELETE RESTRICT,
  depart_at       timestamptz NOT NULL,
  return_at       timestamptz,
  status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  ride_type       text NOT NULL DEFAULT 'adhoc'
                    CHECK (ride_type IN ('adhoc', 'recurring')),
  direction       text NOT NULL DEFAULT 'to_work'
                    CHECK (direction IN ('to_work', 'from_work', 'custom')),
  origin          geography(Point, 4326) NOT NULL,
  destination     geography(Point, 4326) NOT NULL,
  route_geometry  geography(LineString, 4326),
  seats_available integer NOT NULL CHECK (seats_available >= 0),
  recurrence_rule text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.8 ride_requests
-- Passengers post "I need a ride" — drivers or the system
-- can match them. Also used by system auto-matching.
-- ---------------------------------------------------------
CREATE TABLE public.ride_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id      uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  origin            geography(Point, 4326) NOT NULL,
  destination       geography(Point, 4326) NOT NULL,
  direction         text NOT NULL DEFAULT 'to_work'
                      CHECK (direction IN ('to_work', 'from_work', 'custom')),
  desired_depart_at timestamptz NOT NULL,
  flexibility_mins  integer NOT NULL DEFAULT 15,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'matched', 'expired', 'cancelled')),
  matched_ride_id   uuid REFERENCES public.rides ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.9 ride_passengers
-- ---------------------------------------------------------
CREATE TABLE public.ride_passengers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             uuid NOT NULL REFERENCES public.rides ON DELETE CASCADE,
  passenger_id        uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'confirmed', 'picked_up',
                          'dropped_off', 'completed', 'cancelled', 'no_show'
                        )),
  pickup_point        geography(Point, 4326),
  pickup_order        integer,
  estimated_pickup_at timestamptz,
  confirmed_at        timestamptz,
  picked_up_at        timestamptz,
  dropped_off_at      timestamptz,
  points_cost         integer NOT NULL DEFAULT 0,
  flex_credit_used    boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, passenger_id)
);

-- ---------------------------------------------------------
-- 3.10 match_suggestions
-- System-generated match proposals. Both parties must
-- accept for the match to become a ride_passenger row.
-- ---------------------------------------------------------
CREATE TABLE public.match_suggestions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id          uuid REFERENCES public.rides ON DELETE CASCADE,
  ride_request_id  uuid REFERENCES public.ride_requests ON DELETE CASCADE,
  driver_id        uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  passenger_id     uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  match_score      real NOT NULL DEFAULT 0,
  detour_mins      real,
  distance_meters  real,
  driver_status    text NOT NULL DEFAULT 'pending'
                     CHECK (driver_status IN ('pending', 'accepted', 'declined')),
  passenger_status text NOT NULL DEFAULT 'pending'
                     CHECK (passenger_status IN ('pending', 'accepted', 'declined')),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- ---------------------------------------------------------
-- 3.11 messages
-- Per-ride group chat. All ride participants can see messages.
-- ---------------------------------------------------------
CREATE TABLE public.messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    uuid NOT NULL REFERENCES public.rides ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  body       text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.12 live_locations
-- Only latest position per user per ride matters in practice.
-- ---------------------------------------------------------
CREATE TABLE public.live_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL REFERENCES public.rides ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  location    geography(Point, 4326) NOT NULL,
  heading     real,
  speed       real,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.13 points_ledger
-- Append-only audit trail. users.points_balance is the
-- denormalized running total for fast reads.
-- ---------------------------------------------------------
CREATE TABLE public.points_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  delta          integer NOT NULL,
  balance_after  integer NOT NULL,
  txn_type       text NOT NULL
                   CHECK (txn_type IN (
                     'ride_driver_earn', 'ride_passenger_spend',
                     'signup_bonus', 'referral_bonus',
                     'consistency_bonus', 'admin_adjustment'
                   )),
  reference_type text,
  reference_id   uuid,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.14 flex_credits_ledger
-- Append-only audit trail for flex credit changes.
-- users.flex_credits_balance is the denormalized total.
-- ---------------------------------------------------------
CREATE TABLE public.flex_credits_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  delta          integer NOT NULL,
  balance_after  integer NOT NULL,
  txn_type       text NOT NULL
                   CHECK (txn_type IN (
                     'monthly_grant', 'earned_consistency',
                     'used_late_cancel', 'used_no_show',
                     'used_schedule_change', 'employer_grant',
                     'admin_adjustment'
                   )),
  reference_type text,
  reference_id   uuid,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.15 reports
-- ---------------------------------------------------------
CREATE TABLE public.reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  reported_id  uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  ride_id      uuid REFERENCES public.rides ON DELETE SET NULL,
  reason       text NOT NULL
                 CHECK (reason IN (
                   'unsafe_driving', 'harassment', 'no_show',
                   'inappropriate_behaviour', 'vehicle_condition', 'other'
                 )),
  description  text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
  reviewed_by  uuid REFERENCES public.users ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

-- ---------------------------------------------------------
-- 3.16 blocks
-- Blocked users are excluded from each other's matching pool.
-- ---------------------------------------------------------
CREATE TABLE public.blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------
-- 3.17 notifications
-- ---------------------------------------------------------
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}',
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.18 badges
-- ---------------------------------------------------------
CREATE TABLE public.badges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  description    text,
  icon_url       text,
  criteria_type  text NOT NULL
                   CHECK (criteria_type IN (
                     'ride_count', 'rating_avg', 'streak',
                     'points_milestone', 'verification', 'manual'
                   )),
  criteria_value jsonb NOT NULL DEFAULT '{}',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 3.19 user_badges
-- ---------------------------------------------------------
CREATE TABLE public.user_badges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  badge_id        uuid NOT NULL REFERENCES public.badges ON DELETE CASCADE,
  awarded_at      timestamptz NOT NULL DEFAULT now(),
  awarded_by_ride uuid REFERENCES public.rides ON DELETE SET NULL,
  UNIQUE (user_id, badge_id)
);

-- ---------------------------------------------------------
-- 3.20 ride_ratings
-- ---------------------------------------------------------
CREATE TABLE public.ride_ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    uuid NOT NULL REFERENCES public.rides ON DELETE CASCADE,
  rater_id   uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  ratee_id   uuid NOT NULL REFERENCES public.users ON DELETE CASCADE,
  score      integer NOT NULL CHECK (score >= 1 AND score <= 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, rater_id, ratee_id),
  CHECK (rater_id <> ratee_id)
);

-- ---------------------------------------------------------
-- 3.21 subscriptions
-- Tracks Stripe billing for enterprise orgs AND individual
-- users. Exactly one of org_id / user_id is set.
-- ---------------------------------------------------------
CREATE TABLE public.subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid REFERENCES public.organisations ON DELETE CASCADE,
  user_id              uuid REFERENCES public.users ON DELETE CASCADE,
  stripe_customer_id   text,
  stripe_sub_id        text UNIQUE,
  plan                 text NOT NULL
                         CHECK (plan IN ('free', 'starter', 'business', 'enterprise')),
  seat_count           integer,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  current_period_end   timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (org_id IS NOT NULL AND user_id IS NULL)
    OR (org_id IS NULL AND user_id IS NOT NULL)
  )
);


-- =========================
-- 3. Helper functions (used by RLS policies)
-- Must come after table creation since they reference public.users.
-- =========================

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_org_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND org_role = 'admin'
  );
$$;


-- =========================
-- 4. Indexes
-- =========================

-- organisations
CREATE INDEX idx_organisations_domain ON public.organisations (domain);

-- users
CREATE INDEX idx_users_org_id ON public.users (org_id);
CREATE INDEX idx_users_email_trgm ON public.users USING gin (email gin_trgm_ops);
CREATE INDEX idx_users_role ON public.users (role) WHERE active = true;
CREATE INDEX idx_users_home_location ON public.users USING gist (home_location);
CREATE INDEX idx_users_work_location ON public.users USING gist (work_location);

-- vehicles
CREATE INDEX idx_vehicles_user_id ON public.vehicles (user_id);

-- driver_preferences
-- user_id is already UNIQUE (implicit unique index)

-- schedules
CREATE INDEX idx_schedules_user_id ON public.schedules (user_id);
CREATE INDEX idx_schedules_active ON public.schedules (user_id) WHERE active = true;

-- emergency_contacts
CREATE INDEX idx_emergency_contacts_user_id ON public.emergency_contacts (user_id);

-- rides
CREATE INDEX idx_rides_driver_id ON public.rides (driver_id);
CREATE INDEX idx_rides_status ON public.rides (status) WHERE status IN ('scheduled', 'active');
CREATE INDEX idx_rides_depart_at ON public.rides (depart_at);
CREATE INDEX idx_rides_origin ON public.rides USING gist (origin);
CREATE INDEX idx_rides_destination ON public.rides USING gist (destination);
CREATE INDEX idx_rides_route_geometry ON public.rides USING gist (route_geometry);
CREATE INDEX idx_rides_direction_depart ON public.rides (direction, depart_at)
  WHERE status = 'scheduled';

-- ride_requests
CREATE INDEX idx_ride_requests_passenger_id ON public.ride_requests (passenger_id);
CREATE INDEX idx_ride_requests_status ON public.ride_requests (status)
  WHERE status = 'pending';
CREATE INDEX idx_ride_requests_origin ON public.ride_requests USING gist (origin);
CREATE INDEX idx_ride_requests_desired_depart ON public.ride_requests (desired_depart_at)
  WHERE status = 'pending';

-- ride_passengers
CREATE INDEX idx_ride_passengers_ride_id ON public.ride_passengers (ride_id);
CREATE INDEX idx_ride_passengers_passenger_id ON public.ride_passengers (passenger_id);
CREATE INDEX idx_ride_passengers_status ON public.ride_passengers (status)
  WHERE status NOT IN ('cancelled', 'no_show');

-- match_suggestions
CREATE INDEX idx_match_suggestions_driver ON public.match_suggestions (driver_id)
  WHERE status = 'pending';
CREATE INDEX idx_match_suggestions_passenger ON public.match_suggestions (passenger_id)
  WHERE status = 'pending';
CREATE INDEX idx_match_suggestions_ride ON public.match_suggestions (ride_id);
CREATE INDEX idx_match_suggestions_request ON public.match_suggestions (ride_request_id);

-- messages
CREATE INDEX idx_messages_ride_id ON public.messages (ride_id, sent_at);

-- live_locations — we only ever query the latest position per user per ride
CREATE INDEX idx_live_locations_ride_latest ON public.live_locations (ride_id, recorded_at DESC);
CREATE INDEX idx_live_locations_user ON public.live_locations (user_id, recorded_at DESC);

-- points_ledger
CREATE INDEX idx_points_ledger_user ON public.points_ledger (user_id, created_at DESC);

-- flex_credits_ledger
CREATE INDEX idx_flex_credits_user ON public.flex_credits_ledger (user_id, created_at DESC);

-- reports
CREATE INDEX idx_reports_reported ON public.reports (reported_id);
CREATE INDEX idx_reports_status ON public.reports (status) WHERE status = 'pending';

-- blocks
CREATE INDEX idx_blocks_blocker ON public.blocks (blocker_id);
CREATE INDEX idx_blocks_blocked ON public.blocks (blocked_id);

-- notifications
CREATE INDEX idx_notifications_user ON public.notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications (user_id)
  WHERE read = false;

-- user_badges
CREATE INDEX idx_user_badges_user ON public.user_badges (user_id);

-- ride_ratings
CREATE INDEX idx_ride_ratings_ride ON public.ride_ratings (ride_id);
CREATE INDEX idx_ride_ratings_ratee ON public.ride_ratings (ratee_id);

-- subscriptions
CREATE INDEX idx_subscriptions_org ON public.subscriptions (org_id);
CREATE INDEX idx_subscriptions_user ON public.subscriptions (user_id);
CREATE INDEX idx_subscriptions_stripe ON public.subscriptions (stripe_customer_id);


-- =========================
-- 5. Row Level Security
-- =========================

ALTER TABLE public.organisations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_passengers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_suggestions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flex_credits_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_ratings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------
-- 5.1 organisations
-- ---------------------------------------------------------
CREATE POLICY "Members can view own org"
  ON public.organisations FOR SELECT
  USING (id = public.current_user_org_id());

CREATE POLICY "Admins can update own org"
  ON public.organisations FOR UPDATE
  USING (id = public.current_user_org_id() AND public.current_user_is_org_admin())
  WITH CHECK (id = public.current_user_org_id() AND public.current_user_is_org_admin());

-- ---------------------------------------------------------
-- 5.2 users
-- Users in the same org can see each other (needed for
-- matching). Independent users (null org) can see other
-- independent users. Everyone can update only themselves.
-- ---------------------------------------------------------
CREATE POLICY "Users can view themselves"
  ON public.users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Same-org users can view each other"
  ON public.users FOR SELECT
  USING (
    org_id IS NOT NULL
    AND org_id = public.current_user_org_id()
  );

CREATE POLICY "Independent users can discover each other"
  ON public.users FOR SELECT
  USING (
    org_id IS NULL
    AND public.current_user_org_id() IS NULL
    AND active = true
    AND onboarding_completed = true
  );

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Org admins can update org members"
  ON public.users FOR UPDATE
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_is_org_admin()
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.current_user_is_org_admin()
  );

CREATE POLICY "Org admins can deactivate members"
  ON public.users FOR DELETE
  USING (
    org_id = public.current_user_org_id()
    AND public.current_user_is_org_admin()
    AND id <> auth.uid()
  );

-- ---------------------------------------------------------
-- 5.3 vehicles
-- ---------------------------------------------------------
CREATE POLICY "Owners manage own vehicles"
  ON public.vehicles FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Same-org users can view vehicles"
  ON public.vehicles FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users
      WHERE org_id = public.current_user_org_id()
    )
  );

-- ---------------------------------------------------------
-- 5.4 driver_preferences
-- ---------------------------------------------------------
CREATE POLICY "Owners manage own preferences"
  ON public.driver_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Same-org users can read driver preferences"
  ON public.driver_preferences FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users
      WHERE org_id = public.current_user_org_id()
    )
  );

-- ---------------------------------------------------------
-- 5.5 schedules
-- ---------------------------------------------------------
CREATE POLICY "Owners manage own schedules"
  ON public.schedules FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Same-org users can read schedules"
  ON public.schedules FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users
      WHERE org_id = public.current_user_org_id()
    )
  );

-- ---------------------------------------------------------
-- 5.6 emergency_contacts
-- ---------------------------------------------------------
CREATE POLICY "Owners manage own emergency contacts"
  ON public.emergency_contacts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------
-- 5.7 rides
-- Same-org users can discover available rides.
-- Driver manages their own rides.
-- ---------------------------------------------------------
CREATE POLICY "Drivers manage own rides"
  ON public.rides FOR ALL
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Same-org users can discover rides"
  ON public.rides FOR SELECT
  USING (
    driver_id IN (
      SELECT id FROM public.users
      WHERE org_id = public.current_user_org_id()
    )
    AND status IN ('scheduled', 'active')
  );

CREATE POLICY "Passengers can view their rides"
  ON public.rides FOR SELECT
  USING (
    id IN (
      SELECT ride_id FROM public.ride_passengers
      WHERE passenger_id = auth.uid()
    )
  );

-- ---------------------------------------------------------
-- 5.8 ride_requests
-- ---------------------------------------------------------
CREATE POLICY "Passengers manage own requests"
  ON public.ride_requests FOR ALL
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Drivers in same org can view pending requests"
  ON public.ride_requests FOR SELECT
  USING (
    status = 'pending'
    AND passenger_id IN (
      SELECT id FROM public.users
      WHERE org_id = public.current_user_org_id()
    )
  );

-- ---------------------------------------------------------
-- 5.9 ride_passengers
-- ---------------------------------------------------------
CREATE POLICY "Passengers can view own entries"
  ON public.ride_passengers FOR SELECT
  USING (passenger_id = auth.uid());

CREATE POLICY "Passengers can insert own entries"
  ON public.ride_passengers FOR INSERT
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Passengers can update own entries"
  ON public.ride_passengers FOR UPDATE
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Drivers can view ride passengers"
  ON public.ride_passengers FOR SELECT
  USING (
    ride_id IN (
      SELECT id FROM public.rides WHERE driver_id = auth.uid()
    )
  );

CREATE POLICY "Drivers can update ride passengers"
  ON public.ride_passengers FOR UPDATE
  USING (
    ride_id IN (
      SELECT id FROM public.rides WHERE driver_id = auth.uid()
    )
  );

-- ---------------------------------------------------------
-- 5.10 match_suggestions
-- ---------------------------------------------------------
CREATE POLICY "Users can view own suggestions"
  ON public.match_suggestions FOR SELECT
  USING (driver_id = auth.uid() OR passenger_id = auth.uid());

CREATE POLICY "Users can update own suggestion status"
  ON public.match_suggestions FOR UPDATE
  USING (driver_id = auth.uid() OR passenger_id = auth.uid());

-- ---------------------------------------------------------
-- 5.11 messages
-- ---------------------------------------------------------
CREATE POLICY "Ride participants can read messages"
  ON public.messages FOR SELECT
  USING (
    ride_id IN (
      SELECT id FROM public.rides WHERE driver_id = auth.uid()
      UNION
      SELECT ride_id FROM public.ride_passengers WHERE passenger_id = auth.uid()
    )
  );

CREATE POLICY "Ride participants can send messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND ride_id IN (
      SELECT id FROM public.rides WHERE driver_id = auth.uid()
      UNION
      SELECT ride_id FROM public.ride_passengers WHERE passenger_id = auth.uid()
    )
  );

-- ---------------------------------------------------------
-- 5.12 live_locations
-- ---------------------------------------------------------
CREATE POLICY "Users can insert own location"
  ON public.live_locations FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Ride participants can view locations"
  ON public.live_locations FOR SELECT
  USING (
    ride_id IN (
      SELECT id FROM public.rides WHERE driver_id = auth.uid()
      UNION
      SELECT ride_id FROM public.ride_passengers WHERE passenger_id = auth.uid()
    )
  );

-- ---------------------------------------------------------
-- 5.13 points_ledger
-- ---------------------------------------------------------
CREATE POLICY "Users can view own points history"
  ON public.points_ledger FOR SELECT
  USING (user_id = auth.uid());

-- ---------------------------------------------------------
-- 5.14 flex_credits_ledger
-- ---------------------------------------------------------
CREATE POLICY "Users can view own flex credit history"
  ON public.flex_credits_ledger FOR SELECT
  USING (user_id = auth.uid());

-- ---------------------------------------------------------
-- 5.15 reports
-- ---------------------------------------------------------
CREATE POLICY "Users can create reports"
  ON public.reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Users can view own reports"
  ON public.reports FOR SELECT
  USING (reporter_id = auth.uid());

CREATE POLICY "Org admins can view org reports"
  ON public.reports FOR SELECT
  USING (
    public.current_user_is_org_admin()
    AND (
      reported_id IN (
        SELECT id FROM public.users WHERE org_id = public.current_user_org_id()
      )
    )
  );

CREATE POLICY "Org admins can update org reports"
  ON public.reports FOR UPDATE
  USING (
    public.current_user_is_org_admin()
    AND reported_id IN (
      SELECT id FROM public.users WHERE org_id = public.current_user_org_id()
    )
  );

-- ---------------------------------------------------------
-- 5.16 blocks
-- ---------------------------------------------------------
CREATE POLICY "Users manage own blocks"
  ON public.blocks FOR ALL
  USING (blocker_id = auth.uid())
  WITH CHECK (blocker_id = auth.uid());

-- ---------------------------------------------------------
-- 5.17 notifications
-- ---------------------------------------------------------
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can mark own notifications read"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------
-- 5.18 badges
-- ---------------------------------------------------------
CREATE POLICY "Anyone can view badges"
  ON public.badges FOR SELECT
  USING (true);

-- ---------------------------------------------------------
-- 5.19 user_badges
-- ---------------------------------------------------------
CREATE POLICY "Anyone can view user badges"
  ON public.user_badges FOR SELECT
  USING (true);

-- ---------------------------------------------------------
-- 5.20 ride_ratings
-- ---------------------------------------------------------
CREATE POLICY "Ride participants can view ratings"
  ON public.ride_ratings FOR SELECT
  USING (
    ride_id IN (
      SELECT id FROM public.rides WHERE driver_id = auth.uid()
      UNION
      SELECT ride_id FROM public.ride_passengers WHERE passenger_id = auth.uid()
    )
  );

CREATE POLICY "Users can view ratings about themselves"
  ON public.ride_ratings FOR SELECT
  USING (ratee_id = auth.uid());

CREATE POLICY "Users can rate after a ride"
  ON public.ride_ratings FOR INSERT
  WITH CHECK (
    rater_id = auth.uid()
    AND ride_id IN (
      SELECT id FROM public.rides
      WHERE driver_id = auth.uid() AND status = 'completed'
      UNION
      SELECT ride_id FROM public.ride_passengers
      WHERE passenger_id = auth.uid() AND status = 'completed'
    )
  );

-- ---------------------------------------------------------
-- 5.21 subscriptions
-- ---------------------------------------------------------
CREATE POLICY "Org admins can view org subscription"
  ON public.subscriptions FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_user_org_id() AND public.current_user_is_org_admin())
    OR (user_id IS NOT NULL AND user_id = auth.uid())
  );


-- =========================
-- 6. Trigger functions
-- =========================

-- ---------------------------------------------------------
-- 6.1 handle_updated_at
-- Generic trigger: sets updated_at = now() before update.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------
-- 6.2 handle_new_user
-- Fires after auth.users insert. Creates public.users row
-- and auto-resolves the org from the email domain.
-- If no org exists for that domain, creates a community org.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _domain text;
  _org_id uuid;
  _org_type text;
  _reg_type text;
BEGIN
  _domain := split_part(NEW.email, '@', 2);

  SELECT id, org_type INTO _org_id, _org_type
  FROM public.organisations
  WHERE domain = _domain
  LIMIT 1;

  IF _org_id IS NULL THEN
    INSERT INTO public.organisations (name, domain, org_type)
    VALUES (initcap(split_part(_domain, '.', 1)) || ' Community', _domain, 'community')
    RETURNING id INTO _org_id;
    _reg_type := 'independent';
  ELSE
    _reg_type := CASE WHEN _org_type = 'enterprise' THEN 'enterprise' ELSE 'independent' END;
  END IF;

  INSERT INTO public.users (id, email, org_id, registration_type, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    _org_id,
    _reg_type,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
  );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------
-- 6.3 handle_points_balance
-- Keeps users.points_balance in sync with ledger inserts.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_points_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET points_balance = points_balance + NEW.delta
  WHERE id = NEW.user_id;

  NEW.balance_after := (
    SELECT points_balance FROM public.users WHERE id = NEW.user_id
  );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------
-- 6.4 handle_flex_credits_balance
-- Keeps users.flex_credits_balance in sync with ledger inserts.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_flex_credits_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET flex_credits_balance = flex_credits_balance + NEW.delta
  WHERE id = NEW.user_id;

  NEW.balance_after := (
    SELECT flex_credits_balance FROM public.users WHERE id = NEW.user_id
  );

  RETURN NEW;
END;
$$;


-- =========================
-- 7. Triggers
-- =========================

-- updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.driver_preferences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- new user auto-provisioning
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- balance sync triggers
CREATE TRIGGER sync_points_balance
  BEFORE INSERT ON public.points_ledger
  FOR EACH ROW EXECUTE FUNCTION public.handle_points_balance();

CREATE TRIGGER sync_flex_credits_balance
  BEFORE INSERT ON public.flex_credits_ledger
  FOR EACH ROW EXECUTE FUNCTION public.handle_flex_credits_balance();


-- =========================
-- 8. Utility views
-- =========================

-- Aggregated rating per user (for display and badge criteria)
-- security_invoker = true so RLS of the querying user applies
CREATE OR REPLACE VIEW public.user_rating_summary
WITH (security_invoker = true)
AS
SELECT
  ratee_id AS user_id,
  count(*)::integer AS total_ratings,
  round(avg(score), 2) AS avg_score,
  count(*) FILTER (WHERE score = 5)::integer AS five_star_count
FROM public.ride_ratings
GROUP BY ratee_id;

-- Active ride count per user (for badge criteria)
CREATE OR REPLACE VIEW public.user_ride_stats
WITH (security_invoker = true)
AS
SELECT
  u.id AS user_id,
  count(DISTINCT r.id) FILTER (WHERE r.driver_id = u.id AND r.status = 'completed')::integer AS rides_as_driver,
  count(DISTINCT rp.ride_id) FILTER (WHERE rp.status = 'completed')::integer AS rides_as_passenger,
  (
    count(DISTINCT r.id) FILTER (WHERE r.driver_id = u.id AND r.status = 'completed')
    + count(DISTINCT rp.ride_id) FILTER (WHERE rp.status = 'completed')
  )::integer AS total_rides
FROM public.users u
LEFT JOIN public.rides r ON r.driver_id = u.id
LEFT JOIN public.ride_passengers rp ON rp.passenger_id = u.id
GROUP BY u.id;

