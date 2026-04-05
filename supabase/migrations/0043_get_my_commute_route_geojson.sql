-- GeoJSON LineString for the signed-in user's stored commute (Mapbox-derived), for discover/home maps.

CREATE OR REPLACE FUNCTION public.get_my_commute_route_geojson(p_direction text DEFAULT 'to_work')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (ST_AsGeoJSON(cr.route_geom::geometry))::jsonb
  FROM public.commute_routes cr
  WHERE cr.user_id = auth.uid()
    AND cr.direction = p_direction
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_commute_route_geojson(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_commute_route_geojson(text) TO authenticated;
