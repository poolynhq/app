-- Org admin: auto "corridor" clusters from member home locations (no org_route_groups rows required).
-- Uses ST_ClusterDBSCAN in Web Mercator (~10 km). Names use compass vs workplace centroid when work pins exist.

CREATE OR REPLACE FUNCTION public.poolyn_org_auto_route_corridors(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.org_id = p_org_id
      AND u.org_role = 'admin'
  ) INTO ok;

  IF NOT ok THEN
    RETURN '[]'::json;
  END IF;

  RETURN COALESCE(
    (
      WITH members AS (
        SELECT u.id, u.home_location::geometry AS home_g
        FROM public.users u
        WHERE u.org_id = p_org_id
          AND u.active = true
          AND COALESCE(u.onboarding_completed, false) = true
          AND u.home_location IS NOT NULL
      ),
      pts AS (
        SELECT id, ST_Transform(home_g, 3857) AS g3857
        FROM members
      ),
      clustered AS (
        SELECT
          id,
          ST_ClusterDBSCAN(g3857, 10000::double precision, 1) OVER () AS cid
        FROM pts
      ),
      cl_ag AS (
        SELECT
          c.cid,
          count(*)::integer AS member_count,
          ST_Transform(ST_Centroid(ST_Collect(p.g3857)), 4326) AS home_centroid
        FROM clustered c
        JOIN pts p ON p.id = c.id
        GROUP BY c.cid
      ),
      work_anchor AS (
        SELECT
          CASE
            WHEN count(*) FILTER (WHERE u.work_location IS NOT NULL) = 0 THEN NULL
            ELSE ST_Centroid(ST_Collect(u.work_location::geometry))
          END AS wc_geom
        FROM public.users u
        WHERE u.org_id = p_org_id
      ),
      with_az AS (
        SELECT
          c.cid,
          c.member_count,
          c.home_centroid,
          w.wc_geom,
          CASE
            WHEN w.wc_geom IS NULL OR c.home_centroid IS NULL THEN NULL
            ELSE degrees(ST_Azimuth(w.wc_geom, c.home_centroid))
          END AS az_deg
        FROM cl_ag c
        CROSS JOIN work_anchor w
      ),
      labeled AS (
        SELECT
          cid,
          member_count,
          CASE
            WHEN wc_geom IS NULL THEN
              'Homes cluster ' || (row_number() OVER (ORDER BY member_count DESC, cid))::text
            WHEN az_deg IS NULL THEN
              'Near-workplace homes corridor'
            WHEN az_deg >= 337.5 OR az_deg < 22.5 THEN
              'North of workplace corridor'
            WHEN az_deg < 67.5 THEN
              'Northeast of workplace corridor'
            WHEN az_deg < 112.5 THEN
              'East of workplace corridor'
            WHEN az_deg < 157.5 THEN
              'Southeast of workplace corridor'
            WHEN az_deg < 202.5 THEN
              'South of workplace corridor'
            WHEN az_deg < 247.5 THEN
              'Southwest of workplace corridor'
            WHEN az_deg < 292.5 THEN
              'West of workplace corridor'
            ELSE
              'Northwest of workplace corridor'
          END AS name,
          'Auto from home pins (about 10 km grouping).'::text AS subtitle
        FROM with_az
      )
      SELECT json_agg(
        json_build_object(
          'cluster_id', cid,
          'name', name,
          'member_count', member_count,
          'subtitle', subtitle
        )
        ORDER BY member_count DESC, cid
      )
      FROM labeled
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_auto_route_corridors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_auto_route_corridors(uuid) TO authenticated;

COMMENT ON FUNCTION public.poolyn_org_auto_route_corridors(uuid) IS
  'Org admins: JSON array of auto corridor clusters from member home locations (ST_ClusterDBSCAN ~10 km).';
