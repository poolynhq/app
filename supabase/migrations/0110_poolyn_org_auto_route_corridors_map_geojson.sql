-- Extend poolyn_org_auto_route_corridors: same auth rules, richer JSON for org admin map
-- (member home heatmap + workplace-to-cluster axis lines).

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
    RETURN json_build_object(
      'corridors', '[]'::json,
      'homes_geojson', json_build_object('type', 'FeatureCollection', 'features', '[]'::json),
      'axis_lines_geojson', json_build_object('type', 'FeatureCollection', 'features', '[]'::json),
      'work_centroid', NULL::json
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.org_id = p_org_id
      AND u.org_role = 'admin'
  ) INTO ok;

  IF NOT ok THEN
    RETURN json_build_object(
      'corridors', '[]'::json,
      'homes_geojson', json_build_object('type', 'FeatureCollection', 'features', '[]'::json),
      'axis_lines_geojson', json_build_object('type', 'FeatureCollection', 'features', '[]'::json),
      'work_centroid', NULL::json
    );
  END IF;

  RETURN (
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
          ELSE degrees(ST_Azimuth(w.wc_geom, c.home_centroid::geometry))
        END AS az_deg
      FROM cl_ag c
      CROSS JOIN work_anchor w
    ),
    labeled AS (
      SELECT
        z.cid,
        z.member_count,
        z.home_centroid,
        CASE
          WHEN z.wc_geom IS NULL THEN
            'Homes cluster ' || (row_number() OVER (ORDER BY z.member_count DESC, z.cid))::text
          WHEN z.az_deg IS NULL THEN
            'Near-workplace homes corridor'
          WHEN z.az_deg >= 337.5 OR z.az_deg < 22.5 THEN
            'North of workplace corridor'
          WHEN z.az_deg < 67.5 THEN
            'Northeast of workplace corridor'
          WHEN z.az_deg < 112.5 THEN
            'East of workplace corridor'
          WHEN z.az_deg < 157.5 THEN
            'Southeast of workplace corridor'
          WHEN z.az_deg < 202.5 THEN
            'South of workplace corridor'
          WHEN z.az_deg < 247.5 THEN
            'Southwest of workplace corridor'
          WHEN z.az_deg < 292.5 THEN
            'West of workplace corridor'
          ELSE
            'Northwest of workplace corridor'
        END AS name,
        'Auto from home pins (about 10 km grouping).'::text AS subtitle
      FROM with_az z
    ),
    corridors_json AS (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'cluster_id', l.cid,
            'name', l.name,
            'member_count', l.member_count,
            'subtitle', l.subtitle,
            'centroid_lng', ST_X(l.home_centroid::geometry),
            'centroid_lat', ST_Y(l.home_centroid::geometry)
          )
          ORDER BY l.member_count DESC, l.cid
        ),
        '[]'::json
      ) AS j
      FROM labeled l
    ),
    home_points AS (
      SELECT m.id, m.home_g, c.cid
      FROM members m
      JOIN clustered c ON c.id = m.id
    ),
    homes_fc AS (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(ST_Transform(m.home_g, 4326), 5)::json,
            'properties', json_build_object('cluster_id', m.cid)
          )
        ),
        '[]'::json
      ) AS j
      FROM home_points m
    ),
    axis_fc AS (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(
              ST_MakeLine(w.wc_geom, l.home_centroid::geometry),
              5
            )::json,
            'properties', json_build_object('cluster_id', l.cid, 'name', l.name)
          )
        ),
        '[]'::json
      ) AS j
      FROM labeled l
      CROSS JOIN work_anchor w
      WHERE w.wc_geom IS NOT NULL
        AND l.home_centroid IS NOT NULL
    ),
    work_json AS (
      SELECT CASE
        WHEN w.wc_geom IS NULL THEN NULL::json
        ELSE json_build_object(
          'lng', ST_X(w.wc_geom::geometry),
          'lat', ST_Y(w.wc_geom::geometry)
        )
      END AS j
      FROM work_anchor w
    )
    SELECT json_build_object(
      'corridors', (SELECT j FROM corridors_json),
      'homes_geojson', json_build_object('type', 'FeatureCollection', 'features', (SELECT j FROM homes_fc)),
      'axis_lines_geojson', json_build_object(
        'type', 'FeatureCollection',
        'features', (SELECT j FROM axis_fc)
      ),
      'work_centroid', (SELECT j FROM work_json)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_auto_route_corridors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_auto_route_corridors(uuid) TO authenticated;

COMMENT ON FUNCTION public.poolyn_org_auto_route_corridors(uuid) IS
  'Org admins: corridors list + GeoJSON (member homes for heatmap, work-to-cluster axis lines, work_centroid).';
