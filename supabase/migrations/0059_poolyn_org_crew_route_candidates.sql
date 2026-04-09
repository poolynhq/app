-- Crew formation: same-org users whose home lies near the viewer's home→work line,
-- and (when both have work pins) whose workplace is within metro distance.
-- Detour minutes scale the corridor buffer (~625 m per minute, clamped 500 m–25 km).

CREATE OR REPLACE FUNCTION public.poolyn_org_crew_route_candidates(
  p_detour_mins integer
)
RETURNS TABLE (id uuid, full_name text)
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
         COALESCE(NULLIF(trim(u.full_name), ''), 'Poolyn member')::text AS full_name
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
