-- =============================================================
-- Migration 0004: gender, vehicle photos, RLS hardening,
--                 view security fixes
-- =============================================================


-- ---------------------------------------------------------
-- 1. Remove the broad INSERT policies from migration 0003.
-- ---------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can create community orgs"
  ON public.organisations;

DROP POLICY IF EXISTS "Authenticated users can look up orgs by domain"
  ON public.organisations;

DROP POLICY IF EXISTS "Users can insert own profile"
  ON public.users;


-- ---------------------------------------------------------
-- 2. bootstrap_user_profile()
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_user_profile()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id  uuid;
  _email    text;
  _name     text;
  _domain   text;
  _org_id   uuid;
  _org_type text;
  _reg_type text;
  _profile  public.users;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _profile FROM public.users WHERE id = _user_id;
  IF FOUND THEN
    RETURN row_to_json(_profile);
  END IF;

  SELECT email, raw_user_meta_data ->> 'full_name'
    INTO _email, _name
    FROM auth.users
   WHERE id = _user_id;

  _domain := split_part(_email, '@', 2);

  SELECT id, org_type INTO _org_id, _org_type
    FROM public.organisations
   WHERE domain = _domain
   LIMIT 1;

  IF _org_id IS NULL THEN
    INSERT INTO public.organisations (name, domain, org_type)
    VALUES (
      initcap(split_part(_domain, '.', 1)) || ' Community',
      _domain,
      'community'
    )
    RETURNING id INTO _org_id;
    _reg_type := 'independent';
  ELSE
    _reg_type := CASE
      WHEN _org_type = 'enterprise' THEN 'enterprise'
      ELSE 'independent'
    END;
  END IF;

  INSERT INTO public.users (id, email, org_id, registration_type, full_name)
  VALUES (_user_id, _email, _org_id, _reg_type, COALESCE(_name, ''))
  RETURNING * INTO _profile;

  RETURN row_to_json(_profile);
END;
$$;


-- ---------------------------------------------------------
-- 3. Gender column on users
-- ---------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gender text
    CHECK (gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say'));

COMMENT ON COLUMN public.users.gender IS
  'Self-reported gender. Used for same-gender matching when enabled.';


-- ---------------------------------------------------------
-- 4. Same-gender matching preference on users
-- ---------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS same_gender_pref boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.same_gender_pref IS
  'When true, matching engine restricts suggestions to same-gender users only.';


-- ---------------------------------------------------------
-- 5. Vehicle photos — Supabase Storage bucket
-- ---------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-photos',
  'vehicle-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Owner uploads vehicle photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owner updates vehicle photos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'vehicle-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owner deletes vehicle photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'vehicle-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Active pool members view vehicle photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'vehicle-photos'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
          FROM public.rides r
          JOIN public.ride_passengers rp ON rp.ride_id = r.id
         WHERE r.status IN ('scheduled', 'active')
           AND r.driver_id::text = (storage.foldername(name))[1]
           AND rp.passenger_id = auth.uid()
           AND rp.status IN ('pending', 'confirmed', 'picked_up')
      )
    )
  );


-- ---------------------------------------------------------
-- 6. Fix SECURITY DEFINER views → SECURITY INVOKER
-- ---------------------------------------------------------
DROP VIEW IF EXISTS public.user_rating_summary;
CREATE VIEW public.user_rating_summary
WITH (security_invoker = true)
AS
SELECT
  ratee_id AS user_id,
  count(*)::integer AS total_ratings,
  round(avg(score), 2) AS avg_score,
  count(*) FILTER (WHERE score = 5)::integer AS five_star_count
FROM public.ride_ratings
GROUP BY ratee_id;

DROP VIEW IF EXISTS public.user_ride_stats;
CREATE VIEW public.user_ride_stats
WITH (security_invoker = true)
AS
SELECT
  u.id AS user_id,
  count(DISTINCT r.id)
    FILTER (WHERE r.driver_id = u.id AND r.status = 'completed')::integer
    AS rides_as_driver,
  count(DISTINCT rp.ride_id)
    FILTER (WHERE rp.status = 'completed')::integer
    AS rides_as_passenger,
  (
    count(DISTINCT r.id)
      FILTER (WHERE r.driver_id = u.id AND r.status = 'completed')
    + count(DISTINCT rp.ride_id)
      FILTER (WHERE rp.status = 'completed')
  )::integer AS total_rides
FROM public.users u
LEFT JOIN public.rides r ON r.driver_id = u.id
LEFT JOIN public.ride_passengers rp ON rp.passenger_id = u.id
GROUP BY u.id;
