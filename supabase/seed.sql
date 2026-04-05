-- ============================================================
-- Poolyn — Local test fixtures only (not real companies)
--
-- Fictional orgs and users for development. Do not treat names
-- or domains as production data. In hosted environments, users
-- normally come from auth + app flows, not this file.
--
-- Run after migrations: supabase db reset (includes seed) or
-- pipe this file manually into a dev database.
--
-- Hosted Supabase / real sign-in: public.users rows require matching
-- auth.users. Use the repo script instead (service role):
--   npm run seed:test-users
--   See scripts/create-test-users.mjs for env vars and the account list.
-- ============================================================

-- ---------------------------------------------------------
-- Test organisations (marked active so invite/claim flows work locally)
-- ---------------------------------------------------------
INSERT INTO public.organisations (id, name, domain, org_type, plan, max_seats, allow_cross_org, status) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Meridian Tech',        'meridiantech.com',  'enterprise', 'business',   50, false, 'active'),
  ('a1000000-0000-0000-0000-000000000002', 'Greenleaf University', 'greenleaf.edu.au',  'enterprise', 'starter',   200, false, 'active'),
  ('a1000000-0000-0000-0000-000000000003', 'Nexus Community',      'nexusinc.com',      'community',  'free',     NULL, true, 'active');


-- ---------------------------------------------------------
-- Test users (fixed UUIDs; Melbourne-area sample coordinates)
-- ---------------------------------------------------------
INSERT INTO public.users (id, org_id, email, full_name, phone_number, role, org_role, registration_type, home_location, work_location, work_location_label, detour_tolerance_mins, points_balance, flex_credits_balance, license_verified, onboarding_completed, active) VALUES
  -- Meridian Tech employees
  ('b1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'sarah.chen@meridiantech.com', 'Sarah Chen', '+61412345001',
   'both', 'admin', 'enterprise',
   ST_MakePoint(144.9631, -37.8136)::geography,   -- CBD
   ST_MakePoint(144.9631, -37.8136)::geography,   -- Melbourne CBD hub (same as sample home here)
   'Meridian Tech — Melbourne CBD', 12, 150, 3, true, true, true),

  ('b1000000-0000-0000-0000-000000000002',
   'a1000000-0000-0000-0000-000000000001',
   'james.wilson@meridiantech.com', 'James Wilson', '+61412345002',
   'driver', 'member', 'enterprise',
   ST_MakePoint(145.0350, -37.7550)::geography,   -- Kew
   ST_MakePoint(144.9631, -37.8136)::geography,   -- Melbourne CBD hub
   'Meridian Tech — Melbourne CBD', 10, 80, 5, true, true, true),

  ('b1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   'priya.sharma@meridiantech.com', 'Priya Sharma', '+61412345003',
   'passenger', 'member', 'enterprise',
   ST_MakePoint(145.0000, -37.7800)::geography,   -- Hawthorn
   ST_MakePoint(144.9631, -37.8136)::geography,   -- Melbourne CBD hub
   'Meridian Tech — Melbourne CBD', 15, 30, 3, false, true, true),

  -- Greenleaf University
  ('b1000000-0000-0000-0000-000000000004',
   'a1000000-0000-0000-0000-000000000002',
   'dr.patel@greenleaf.edu.au', 'Dr. Arun Patel', '+61412345004',
   'both', 'admin', 'enterprise',
   ST_MakePoint(145.1300, -37.9100)::geography,   -- Clayton
   ST_MakePoint(145.1340, -37.9150)::geography,   -- Campus
   'Greenleaf Uni — Main Campus', 8, 200, 4, true, true, true),

  ('b1000000-0000-0000-0000-000000000005',
   'a1000000-0000-0000-0000-000000000002',
   'emma.nguyen@greenleaf.edu.au', 'Emma Nguyen', '+61412345005',
   'passenger', 'member', 'enterprise',
   ST_MakePoint(145.0600, -37.8800)::geography,   -- Caulfield
   ST_MakePoint(145.1340, -37.9150)::geography,   -- Campus
   'Greenleaf Uni — Main Campus', 20, 10, 3, false, true, true),

  -- Independent / community user
  ('b1000000-0000-0000-0000-000000000006',
   'a1000000-0000-0000-0000-000000000003',
   'tom.baker@nexusinc.com', 'Tom Baker', '+61412345006',
   'both', 'member', 'independent',
   ST_MakePoint(144.9500, -37.8400)::geography,   -- South Melbourne
   ST_MakePoint(144.9631, -37.8136)::geography,   -- CBD office
   'Nexus Inc — Collins St', 10, 50, 3, false, true, true);


-- ---------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------
INSERT INTO public.vehicles (id, user_id, make, model, colour, plate, seats, active) VALUES
  ('c1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'Toyota', 'Corolla', 'White', 'ABC123', 4, true),

  ('c1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000002',
   'Mazda', 'CX-5', 'Blue', 'XYZ789', 4, true),

  ('c1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000004',
   'Hyundai', 'Ioniq 5', 'Silver', 'EV2026', 4, true);


-- ---------------------------------------------------------
-- Driver preferences
-- ---------------------------------------------------------
INSERT INTO public.driver_preferences (user_id, max_detour_mins, max_passengers, auto_accept, quiet_ride, music_ok) VALUES
  ('b1000000-0000-0000-0000-000000000001', 12, 3, false, false, true),
  ('b1000000-0000-0000-0000-000000000002', 8,  2, true,  false, true),
  ('b1000000-0000-0000-0000-000000000004', 10, 3, false, true,  false);


-- ---------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------
INSERT INTO public.schedules (user_id, type, weekday_times, tolerance_mins, active) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'fixed_weekly',
   '{"mon":{"depart":"08:00","return":"17:30"},"tue":{"depart":"08:00","return":"17:30"},"wed":{"depart":"08:00","return":"17:30"},"thu":{"depart":"08:00","return":"17:30"},"fri":{"depart":"08:00","return":"16:00"}}',
   15, true),

  ('b1000000-0000-0000-0000-000000000002', 'fixed_weekly',
   '{"mon":{"depart":"07:30","return":"16:30"},"tue":{"depart":"07:30","return":"16:30"},"wed":{"depart":"07:30","return":"16:30"},"thu":{"depart":"07:30","return":"16:30"}}',
   10, true),

  ('b1000000-0000-0000-0000-000000000004', 'shift_window',
   NULL, 20, true);

UPDATE public.schedules
SET shift_start = '07:00', shift_end = '19:00'
WHERE user_id = 'b1000000-0000-0000-0000-000000000004';


-- ---------------------------------------------------------
-- Badges
-- ---------------------------------------------------------
INSERT INTO public.badges (id, name, description, icon_url, criteria_type, criteria_value, active) VALUES
  ('d1000000-0000-0000-0000-000000000001',
   'First Ride',
   'Completed your very first carpool ride.',
   '/badges/first-ride.svg',
   'ride_count', '{"threshold": 1}', true),

  ('d1000000-0000-0000-0000-000000000002',
   'Road Regular',
   'Completed 10 rides — you''re part of the crew!',
   '/badges/road-regular.svg',
   'ride_count', '{"threshold": 10}', true),

  ('d1000000-0000-0000-0000-000000000003',
   'Century Club',
   'An incredible 100 rides. Legend.',
   '/badges/century-club.svg',
   'ride_count', '{"threshold": 100}', true),

  ('d1000000-0000-0000-0000-000000000004',
   'Smooth Operator',
   'Maintained a 4.8+ average rating over 10+ rides.',
   '/badges/smooth-operator.svg',
   'rating_avg', '{"min_rating": 4.8, "min_rides": 10}', true),

  ('d1000000-0000-0000-0000-000000000005',
   'Punctuality Pro',
   'Never late on 20 consecutive rides.',
   '/badges/punctuality-pro.svg',
   'streak', '{"type": "on_time", "threshold": 20}', true),

  ('d1000000-0000-0000-0000-000000000006',
   'Green Champion',
   'Saved over 100kg of CO₂ through carpooling.',
   '/badges/green-champion.svg',
   'points_milestone', '{"co2_saved_kg": 100}', true),

  ('d1000000-0000-0000-0000-000000000007',
   'Verified Driver',
   'Licence and insurance verified for extra trust.',
   '/badges/verified-driver.svg',
   'verification', '{"type": "driver_licence"}', true),

  ('d1000000-0000-0000-0000-000000000008',
   'Best DJ',
   'Voted best music taste by passengers.',
   '/badges/best-dj.svg',
   'manual', '{}', true),

  ('d1000000-0000-0000-0000-000000000009',
   'Connector',
   'Introduced 5+ new users to the platform.',
   '/badges/connector.svg',
   'manual', '{"referrals": 5}', true),

  ('d1000000-0000-0000-0000-000000000010',
   'Ride Streak',
   'Carpooled every work day for 4 weeks straight.',
   '/badges/ride-streak.svg',
   'streak', '{"type": "daily", "threshold": 20}', true);


-- ---------------------------------------------------------
-- Award some badges to seed users
-- ---------------------------------------------------------
INSERT INTO public.user_badges (user_id, badge_id) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000007'),
  ('b1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002'),
  ('b1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000008'),
  ('b1000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000007');


-- ---------------------------------------------------------
-- Sample subscription (enterprise org)
-- ---------------------------------------------------------
INSERT INTO public.subscriptions (org_id, plan, seat_count, status) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'business', 50, 'active'),
  ('a1000000-0000-0000-0000-000000000002', 'starter', 200, 'active');


-- ---------------------------------------------------------
-- Emergency contacts
-- ---------------------------------------------------------
INSERT INTO public.emergency_contacts (user_id, name, phone_number, relationship) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'David Chen',   '+61412999001', 'Spouse'),
  ('b1000000-0000-0000-0000-000000000003', 'Raj Sharma',   '+61412999003', 'Father'),
  ('b1000000-0000-0000-0000-000000000005', 'Linh Nguyen',  '+61412999005', 'Mother');


-- ---------------------------------------------------------
-- Org route groups (corridors / lines for planning)
-- ---------------------------------------------------------
INSERT INTO public.org_route_groups (id, org_id, name, description, created_by) VALUES
  ('f1000000-0000-4000-8000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'Eastern corridor',
   'Eastern suburbs line toward Melbourne CBD',
   'b1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-4000-8000-000000000002',
   'a1000000-0000-0000-0000-000000000002',
   'South & Clayton run',
   'Southern suburbs feeding main campus',
   'b1000000-0000-0000-0000-000000000004');

INSERT INTO public.org_route_group_members (group_id, user_id) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-4000-8000-000000000001', 'b1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-4000-8000-000000000001', 'b1000000-0000-0000-0000-000000000003'),
  ('f1000000-0000-4000-8000-000000000002', 'b1000000-0000-0000-0000-000000000004'),
  ('f1000000-0000-4000-8000-000000000002', 'b1000000-0000-0000-0000-000000000005');
