-- Crew Poolyn: optional daily schedule anchor (arrival vs start) and one-time departure readiness reminder.

ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS schedule_mode text NOT NULL DEFAULT 'arrival'
    CHECK (schedule_mode IN ('arrival', 'start')),
  ADD COLUMN IF NOT EXISTS schedule_anchor_minutes integer NOT NULL DEFAULT 540
    CHECK (schedule_anchor_minutes >= 0 AND schedule_anchor_minutes < 1440),
  ADD COLUMN IF NOT EXISTS estimated_pool_drive_minutes integer NOT NULL DEFAULT 45
    CHECK (estimated_pool_drive_minutes >= 1 AND estimated_pool_drive_minutes <= 600);

COMMENT ON COLUMN public.crews.schedule_mode IS
  'arrival: schedule_anchor_minutes is destination arrival; start: anchor is driver departure from origin.';
COMMENT ON COLUMN public.crews.schedule_anchor_minutes IS
  'Minutes from local midnight (0..1439) for the chosen anchor.';
COMMENT ON COLUMN public.crews.estimated_pool_drive_minutes IS
  'Client snapshot at crew creation: base corridor plus pickup detours for planning banners and reminders.';

ALTER TABLE public.crew_trip_instances
  ADD COLUMN IF NOT EXISTS departure_readiness_reminder_sent_at timestamptz NULL;

COMMENT ON COLUMN public.crew_trip_instances.departure_readiness_reminder_sent_at IS
  'When riders were notified to confirm readiness near planned driver departure (client-triggered RPC).';

-- ---------------------------------------------------------------------------
-- Departure readiness reminder (in-app notification, idempotent per trip day)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_try_departure_readiness_reminder(
  p_trip_instance_id uuid,
  p_local_minutes integer,
  p_trip_local_date date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_trip_date date;
  v_started timestamptz;
  v_finished timestamptz;
  v_sent timestamptz;
  v_mode text;
  v_anchor int;
  v_drive int;
  v_depart int;
  r RECORD;
  v_driver uuid;
  v_starter uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_local_minutes IS NULL OR p_local_minutes < 0 OR p_local_minutes >= 1440 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_local_minutes');
  END IF;

  SELECT
    cti.crew_id,
    cti.trip_date,
    cti.trip_started_at,
    cti.trip_finished_at,
    cti.departure_readiness_reminder_sent_at,
    cti.designated_driver_user_id,
    cti.trip_started_by_user_id
  INTO
    v_crew_id,
    v_trip_date,
    v_started,
    v_finished,
    v_sent,
    v_driver,
    v_starter
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_trip_date IS DISTINCT FROM p_trip_local_date THEN
    RETURN json_build_object('ok', false, 'reason', 'date_mismatch', 'skipped', true);
  END IF;

  IF v_started IS NOT NULL OR v_finished IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'skipped', true, 'reason', 'trip_not_pending');
  END IF;

  IF v_sent IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'skipped', true, 'reason', 'already_sent');
  END IF;

  SELECT c.schedule_mode, c.schedule_anchor_minutes, c.estimated_pool_drive_minutes
  INTO v_mode, v_anchor, v_drive
  FROM public.crews c
  WHERE c.id = v_crew_id;

  IF v_mode IS NULL OR v_anchor IS NULL OR v_drive IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'crew_schedule_missing');
  END IF;

  IF v_mode = 'arrival' THEN
    v_depart := ((v_anchor - v_drive) % 1440 + 1440) % 1440;
  ELSE
    v_depart := v_anchor;
  END IF;

  -- Only fire when local time is past departure but within 45 minutes after (first app open window).
  IF p_local_minutes < v_depart OR p_local_minutes > v_depart + 45 THEN
    RETURN json_build_object('ok', true, 'skipped', true, 'reason', 'outside_window');
  END IF;

  FOR r IN
    SELECT cm.user_id
    FROM public.crew_members cm
    WHERE cm.crew_id = v_crew_id
      AND cm.user_id IS DISTINCT FROM COALESCE(v_driver, v_starter)
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.user_id,
      'crew_departure_readiness',
      'Time to confirm pickup',
      'Your crew driver should be leaving soon. Open Poolyn and tap I am ready if you still need a ride.',
      jsonb_build_object('trip_instance_id', p_trip_instance_id, 'crew_id', v_crew_id)
    );
  END LOOP;

  UPDATE public.crew_trip_instances
  SET departure_readiness_reminder_sent_at = now(),
      updated_at = now()
  WHERE id = p_trip_instance_id;

  RETURN json_build_object('ok', true, 'sent', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_try_departure_readiness_reminder(uuid, integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_try_departure_readiness_reminder(uuid, integer, date) TO authenticated;

-- Richer copy when trip starts: include corridor duration hint when available.
CREATE OR REPLACE FUNCTION public.trg_notify_crew_riders_trip_started()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_label text;
  v_body text;
  v_dur int;
  v_mins int;
BEGIN
  IF OLD.trip_started_at IS NOT NULL OR NEW.trip_started_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(u.full_name), ''), 'Driver')
  INTO v_label
  FROM public.users u
  WHERE u.id = COALESCE(NEW.designated_driver_user_id, NEW.trip_started_by_user_id)
  LIMIT 1;

  IF v_label IS NULL THEN
    v_label := 'Driver';
  END IF;

  SELECT c.locked_route_duration_s
  INTO v_dur
  FROM public.crews c
  WHERE c.id = NEW.crew_id
  LIMIT 1;

  v_body := v_label || ' started your crew trip. Open Poolyn and tap I am ready when you want pickup.';
  IF v_dur IS NOT NULL AND v_dur > 0 THEN
    v_mins := GREATEST(1, (v_dur + 30) / 60);
    v_body := v_body || ' Corridor estimate about ' || v_mins::text || ' min (locked route).';
  END IF;

  FOR r IN
    SELECT cm.user_id
    FROM public.crew_members cm
    WHERE cm.crew_id = NEW.crew_id
      AND NOT (cm.user_id = ANY (COALESCE(NEW.excluded_pickup_user_ids, ARRAY[]::uuid[])))
      AND (
        (NEW.designated_driver_user_id IS NOT NULL AND cm.user_id <> NEW.designated_driver_user_id)
        OR (
          NEW.designated_driver_user_id IS NULL
          AND NEW.trip_started_by_user_id IS NOT NULL
          AND cm.user_id <> NEW.trip_started_by_user_id
        )
        OR (NEW.designated_driver_user_id IS NULL AND NEW.trip_started_by_user_id IS NULL)
      )
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.user_id,
      'crew_trip_driver_started',
      'Crew trip started',
      v_body,
      jsonb_build_object('trip_instance_id', NEW.id, 'crew_id', NEW.crew_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;
