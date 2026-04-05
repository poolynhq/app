-- Richer Discover overlap snapshot + push token storage for Expo.

CREATE OR REPLACE FUNCTION public.get_discover_route_snapshot(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  geom_count integer;
  geom_ext integer;
  org_routes integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*)::integer INTO geom_count
  FROM public.prefilter_commute_match_pairs(p_user_id, false);

  SELECT COUNT(*)::integer INTO geom_ext
  FROM public.prefilter_commute_match_pairs(p_user_id, true);

  SELECT COUNT(DISTINCT cr.user_id)::integer INTO org_routes
  FROM public.commute_routes cr
  JOIN public.users u ON u.id = cr.user_id
  WHERE cr.direction = 'to_work'
    AND u.id <> p_user_id
    AND u.org_id IS NOT NULL
    AND u.org_id = (SELECT u2.org_id FROM public.users u2 WHERE u2.id = p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.organisations o
      WHERE o.id = u.org_id
        AND o.status IN ('active', 'grace')
    );

  RETURN json_build_object(
    'geometry_peers', COALESCE(geom_count, 0),
    'geometry_peers_extended', COALESCE(geom_ext, 0),
    'org_commuters_with_route', COALESCE(org_routes, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_discover_route_snapshot(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_discover_route_snapshot(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON public.user_push_tokens (user_id);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_push_tokens_own_rw ON public.user_push_tokens
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT ALL ON TABLE public.user_push_tokens TO authenticated;

COMMENT ON TABLE public.user_push_tokens IS
  'Expo push tokens for remote notifications (ride requests, etc.).';

-- Realtime: clients subscribe to INSERT on notifications for instant in-app alerts.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$do$;
