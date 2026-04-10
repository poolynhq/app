-- Crew commute pattern, sticker, per-day pickup exclusions; richer candidate RPC; owner may remove a member.

ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS commute_pattern text NOT NULL DEFAULT 'to_work'
    CHECK (commute_pattern IN ('to_work', 'to_home', 'round_trip')),
  ADD COLUMN IF NOT EXISTS sticker_emoji text NULL
    CHECK (sticker_emoji IS NULL OR char_length(sticker_emoji) <= 16);

ALTER TABLE public.crew_trip_instances
  ADD COLUMN IF NOT EXISTS excluded_pickup_user_ids uuid[] NOT NULL DEFAULT '{}';

-- Return type change: drop and recreate.
DROP FUNCTION IF EXISTS public.poolyn_org_crew_route_candidates(integer);

CREATE OR REPLACE FUNCTION public.poolyn_org_crew_route_candidates(
  p_detour_mins integer
)
RETURNS TABLE (
  id uuid,
  full_name text,
  home_lat double precision,
  home_lng double precision,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT u.org_id, u.home_location, u.work_location
    FROM public.users u
    WHERE u.id = auth.uid()
  ),
  buf AS (
    SELECT GREATEST(500::double precision, LEAST(25000::double precision, COALESCE(p_detour_mins, 12)::double precision * 625)) AS m
  )
  SELECT u.id,
         COALESCE(NULLIF(trim(u.full_name), ''), 'Poolyn member')::text AS full_name,
         ST_Y(u.home_location::geometry)::double precision AS home_lat,
         ST_X(u.home_location::geometry)::double precision AS home_lng,
         u.avatar_url::text AS avatar_url
  FROM public.users u
  CROSS JOIN me
  CROSS JOIN buf
  WHERE u.id <> auth.uid()
    AND u.active = true
    AND u.onboarding_completed = true
    AND u.home_location IS NOT NULL
    AND me.org_id IS NOT NULL
    AND u.org_id = me.org_id
    AND (
      (
        me.home_location IS NOT NULL
        AND me.work_location IS NOT NULL
        AND ST_DWithin(
          u.home_location,
          ST_MakeLine(me.home_location::geometry, me.work_location::geometry)::geography,
          (SELECT m FROM buf)
        )
      )
      OR (
        me.home_location IS NOT NULL
        AND me.work_location IS NULL
        AND ST_DWithin(u.home_location, me.home_location, (SELECT m * 1.5 FROM buf))
      )
    )
    AND (
      me.work_location IS NULL
      OR u.work_location IS NULL
      OR ST_DWithin(u.work_location, me.work_location, 15000)
    )
  ORDER BY u.full_name NULLS LAST
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_crew_route_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_crew_route_candidates(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_crew_owner_remove_member(
  p_crew_id uuid,
  p_target_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF NOT public.poolyn_user_is_crew_owner(p_crew_id, auth.uid()) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RETURN json_build_object('ok', false, 'reason', 'cannot_remove_self_here');
  END IF;
  DELETE FROM public.crew_members cm
  WHERE cm.crew_id = p_crew_id
    AND cm.user_id = p_target_user_id
    AND cm.role <> 'owner';
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found_or_owner');
  END IF;
  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_owner_remove_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_owner_remove_member(uuid, uuid) TO authenticated;
