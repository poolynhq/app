-- Corridor "Who's on my route" intros: one pending request per direction until accepted; then DM thread.

CREATE TABLE IF NOT EXISTS public.poolyn_corridor_intro_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  intro_body text NOT NULL CHECK (char_length(trim(intro_body)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT poolyn_corridor_intro_no_self CHECK (from_user_id <> to_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS poolyn_corridor_intro_one_pending_out
  ON public.poolyn_corridor_intro_requests (from_user_id, to_user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.poolyn_corridor_dm_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT poolyn_corridor_dm_pair_ordered CHECK (user_low < user_high),
  UNIQUE (user_low, user_high)
);

CREATE TABLE IF NOT EXISTS public.poolyn_corridor_dm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.poolyn_corridor_dm_threads (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poolyn_corridor_dm_messages_thread ON public.poolyn_corridor_dm_messages (thread_id, created_at);

ALTER TABLE public.poolyn_corridor_intro_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poolyn_corridor_dm_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poolyn_corridor_dm_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poolyn_corridor_intro_select_own ON public.poolyn_corridor_intro_requests;
CREATE POLICY poolyn_corridor_intro_select_own
  ON public.poolyn_corridor_intro_requests FOR SELECT TO authenticated
  USING (from_user_id = (SELECT auth.uid()) OR to_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS poolyn_corridor_dm_threads_select_member ON public.poolyn_corridor_dm_threads;
CREATE POLICY poolyn_corridor_dm_threads_select_member
  ON public.poolyn_corridor_dm_threads FOR SELECT TO authenticated
  USING (user_low = (SELECT auth.uid()) OR user_high = (SELECT auth.uid()));

DROP POLICY IF EXISTS poolyn_corridor_dm_messages_select_member ON public.poolyn_corridor_dm_messages;
CREATE POLICY poolyn_corridor_dm_messages_select_member
  ON public.poolyn_corridor_dm_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.poolyn_corridor_dm_threads t
      WHERE t.id = poolyn_corridor_dm_messages.thread_id
        AND (t.user_low = (SELECT auth.uid()) OR t.user_high = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS poolyn_corridor_dm_messages_insert_member ON public.poolyn_corridor_dm_messages;
CREATE POLICY poolyn_corridor_dm_messages_insert_member
  ON public.poolyn_corridor_dm_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.poolyn_corridor_dm_threads t
      WHERE t.id = thread_id
        AND (t.user_low = (SELECT auth.uid()) OR t.user_high = (SELECT auth.uid()))
    )
  );

-- ── RPC: send intro (first message only until accepted) ──────────────────────
CREATE OR REPLACE FUNCTION public.poolyn_send_corridor_intro_request(p_to_user_id uuid, p_intro_body text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text;
  v_from_name text;
  v_req_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_to_user_id = v_uid THEN
    RETURN json_build_object('ok', false, 'error', 'self');
  END IF;

  v_body := left(trim(COALESCE(p_intro_body, '')), 500);
  IF char_length(v_body) < 1 THEN
    RETURN json_build_object('ok', false, 'error', 'empty_body');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.poolyn_corridor_dm_threads t
    WHERE t.user_low = LEAST(v_uid, p_to_user_id)
      AND t.user_high = GREATEST(v_uid, p_to_user_id)
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'already_connected');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.poolyn_corridor_intro_requests r
    WHERE r.from_user_id = v_uid AND r.to_user_id = p_to_user_id AND r.status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'already_pending');
  END IF;

  INSERT INTO public.poolyn_corridor_intro_requests (from_user_id, to_user_id, intro_body)
  VALUES (v_uid, p_to_user_id, v_body)
  RETURNING id INTO v_req_id;

  SELECT trim(COALESCE(full_name, '')) INTO v_from_name FROM public.users WHERE id = v_uid;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_to_user_id,
    'corridor_intro_request',
    'Route intro request',
    COALESCE(NULLIF(v_from_name, ''), 'Someone') || ' wants to connect from Who''s on my route.',
    jsonb_build_object(
      'request_id', v_req_id::text,
      'from_user_id', v_uid::text,
      'preview', v_body
    )
  );

  RETURN json_build_object('ok', true, 'request_id', v_req_id);
END;
$$;

-- ── RPC: accept / decline ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.poolyn_respond_corridor_intro_request(p_request_id uuid, p_accept boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.poolyn_corridor_intro_requests%ROWTYPE;
  v_peer uuid;
  v_peer_name text;
  v_me_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.poolyn_corridor_intro_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF r.to_user_id <> v_uid THEN
    RETURN json_build_object('ok', false, 'error', 'not_recipient');
  END IF;
  IF r.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.poolyn_corridor_intro_requests
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      responded_at = now()
  WHERE id = p_request_id;

  v_peer := r.from_user_id;
  SELECT trim(COALESCE(full_name, '')) INTO v_peer_name FROM public.users WHERE id = v_peer;
  SELECT trim(COALESCE(full_name, '')) INTO v_me_name FROM public.users WHERE id = v_uid;

  IF p_accept THEN
    INSERT INTO public.poolyn_corridor_dm_threads (user_low, user_high)
    VALUES (LEAST(r.from_user_id, r.to_user_id), GREATEST(r.from_user_id, r.to_user_id))
    ON CONFLICT (user_low, user_high) DO NOTHING;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.from_user_id,
      'corridor_intro_accepted',
      'Intro accepted',
      COALESCE(NULLIF(v_me_name, ''), 'Your match') || ' accepted your route intro. You can message in Profile.',
      jsonb_build_object('peer_user_id', v_uid::text)
    );
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.from_user_id,
      'corridor_intro_declined',
      'Intro declined',
      COALESCE(NULLIF(v_me_name, ''), 'Your match') || ' declined your route intro.',
      jsonb_build_object('request_id', p_request_id::text)
    );
  END IF;

  RETURN json_build_object('ok', true, 'accepted', p_accept);
END;
$$;

-- ── RPC: post-accept messages (no sends until thread exists) ─────────────────
CREATE OR REPLACE FUNCTION public.poolyn_send_corridor_dm_message(p_to_user_id uuid, p_body text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text;
  v_tid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_to_user_id = v_uid THEN
    RETURN json_build_object('ok', false, 'error', 'self');
  END IF;

  v_body := left(trim(COALESCE(p_body, '')), 2000);
  IF char_length(v_body) < 1 THEN
    RETURN json_build_object('ok', false, 'error', 'empty_body');
  END IF;

  SELECT t.id INTO v_tid
  FROM public.poolyn_corridor_dm_threads t
  WHERE t.user_low = LEAST(v_uid, p_to_user_id)
    AND t.user_high = GREATEST(v_uid, p_to_user_id);

  IF v_tid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_thread');
  END IF;

  INSERT INTO public.poolyn_corridor_dm_messages (thread_id, sender_id, body)
  VALUES (v_tid, v_uid, v_body);

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_to_user_id,
    'corridor_dm_message',
    'New message',
    left(v_body, 140),
    jsonb_build_object('from_user_id', v_uid::text)
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_send_corridor_intro_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_send_corridor_intro_request(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.poolyn_respond_corridor_intro_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_respond_corridor_intro_request(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.poolyn_send_corridor_dm_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_send_corridor_dm_message(uuid, text) TO authenticated;

-- ── Directory: include avatar_url for list + map chrome ─────────────────────
CREATE OR REPLACE FUNCTION public.poolyn_route_people_directory(
  p_pool_scope text DEFAULT 'team',
  p_sort text DEFAULT 'nearest',
  p_max_distance_m integer DEFAULT 50000
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_home geography;
  v_org_id uuid;
  v_net_ok boolean;
  v_corridor geography;
  v_scope text;
  v_sort text;
  v_max_m integer;
  v_allow_cross boolean;
  v_restricted boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_scope := lower(trim(COALESCE(p_pool_scope, 'team')));
  IF v_scope NOT IN ('team', 'open') THEN
    v_scope := 'team';
  END IF;

  v_sort := lower(trim(COALESCE(p_sort, 'nearest')));
  IF v_sort NOT IN ('nearest', 'farthest') THEN
    v_sort := 'nearest';
  END IF;

  v_max_m := GREATEST(1000, LEAST(COALESCE(p_max_distance_m, 50000), 200000));

  SELECT u.home_location, u.org_id,
    EXISTS (
      SELECT 1 FROM public.organisations o
      WHERE o.id = u.org_id AND o.status IN ('active', 'grace')
    )
  INTO v_home, v_org_id, v_net_ok
  FROM public.users u
  WHERE u.id = v_uid;

  IF v_home IS NULL THEN
    RETURN json_build_object(
      'ok', true,
      'restricted', false,
      'people', '[]'::json,
      'reason', 'no_home'
    );
  END IF;

  SELECT COALESCE(o.allow_cross_org, false)
  INTO v_allow_cross
  FROM public.organisations o
  WHERE o.id = v_org_id;

  IF v_org_id IS NOT NULL AND NOT COALESCE(v_allow_cross, false) AND v_scope = 'open' THEN
    v_restricted := true;
  END IF;

  SELECT
    CASE
      WHEN uh.home_location IS NOT NULL AND uh.work_location IS NOT NULL THEN
        ST_Buffer(
          ST_MakeLine(uh.home_location::geometry, uh.work_location::geometry)::geography,
          35000
        )
      WHEN uh.home_location IS NOT NULL THEN
        ST_Buffer(uh.home_location, 45000)
      ELSE NULL
    END
  INTO v_corridor
  FROM public.users uh
  WHERE uh.id = v_uid;

  RETURN (
    WITH peers AS (
      SELECT
        u.id AS user_id,
        u.full_name,
        u.role::text AS user_role,
        u.org_id AS peer_org_id,
        o.name AS org_name,
        (o.settings->>'logo_path')::text AS org_logo_path,
        NULLIF(trim(u.avatar_url), '') AS avatar_url,
        ROUND(
          ST_Distance(
            v_home,
            COALESCE(u.home_location, u.work_location)::geography
          )
        )::integer AS distance_m,
        CASE
          WHEN u.role IN ('driver', 'both') AND u.work_location IS NOT NULL THEN 'driver_pin'
          ELSE 'rider_pin'
        END AS pin_kind,
        ST_X(COALESCE(u.home_location, u.work_location)::geometry)::double precision AS pin_lng,
        ST_Y(COALESCE(u.home_location, u.work_location)::geometry)::double precision AS pin_lat
      FROM public.users u
      LEFT JOIN public.organisations o ON o.id = u.org_id
      WHERE u.id <> v_uid
        AND u.active = true
        AND COALESCE(u.onboarding_completed, false) = true
        AND COALESCE(u.home_location, u.work_location) IS NOT NULL
        AND ST_Distance(
          v_home,
          COALESCE(u.home_location, u.work_location)::geography
        ) <= v_max_m
        AND (
          (
            v_scope = 'team'
            AND v_net_ok
            AND v_org_id IS NOT NULL
            AND u.org_id IS NOT DISTINCT FROM v_org_id
            AND (
              v_corridor IS NULL
              OR (
                (u.home_location IS NOT NULL AND ST_Intersects(u.home_location::geometry, v_corridor::geometry))
                OR (u.work_location IS NOT NULL AND ST_Intersects(u.work_location::geometry, v_corridor::geometry))
              )
            )
          )
          OR (
            v_scope = 'open'
            AND NOT v_restricted
            AND v_corridor IS NOT NULL
            AND (
              u.org_id IS NULL
              OR COALESCE(o.allow_cross_org, false) = true
            )
            AND (
              (u.home_location IS NOT NULL AND ST_Intersects(u.home_location::geometry, v_corridor::geometry))
              OR (u.work_location IS NOT NULL AND ST_Intersects(u.work_location::geometry, v_corridor::geometry))
            )
          )
        )
    ),
    ranked AS (
      SELECT *
      FROM peers
      ORDER BY
        CASE WHEN v_sort = 'farthest' THEN -distance_m ELSE distance_m END ASC,
        full_name ASC
    )
    SELECT json_build_object(
      'ok', true,
      'restricted', v_restricted,
      'people', COALESCE(
        (SELECT json_agg(
          json_build_object(
            'user_id', user_id,
            'full_name', full_name,
            'user_role', user_role,
            'org_id', peer_org_id,
            'org_name', org_name,
            'org_logo_path', NULLIF(trim(org_logo_path), ''),
            'avatar_url', avatar_url,
            'distance_m', distance_m,
            'pin_kind', pin_kind,
            'pin_lng', pin_lng,
            'pin_lat', pin_lat
          )
        ) FROM ranked),
        '[]'::json
      )
    )
  );
END;
$$;
