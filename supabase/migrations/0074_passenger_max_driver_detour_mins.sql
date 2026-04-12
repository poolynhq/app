-- Rider-specific cap: max minutes a driver may detour for this user's pickup (separate from detour_tolerance_mins when driving).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS passenger_max_driver_detour_mins integer;

UPDATE public.users u
SET passenger_max_driver_detour_mins = GREATEST(5, LEAST(35, u.detour_tolerance_mins))
WHERE u.passenger_max_driver_detour_mins IS NULL;

ALTER TABLE public.users
  ALTER COLUMN passenger_max_driver_detour_mins SET DEFAULT 12;

UPDATE public.users
SET passenger_max_driver_detour_mins = 12
WHERE passenger_max_driver_detour_mins IS NULL;

ALTER TABLE public.users
  ALTER COLUMN passenger_max_driver_detour_mins SET NOT NULL;

COMMENT ON COLUMN public.users.passenger_max_driver_detour_mins IS
  'When riding: max extra minutes the rider accepts for a driver detour to their pickup.';
