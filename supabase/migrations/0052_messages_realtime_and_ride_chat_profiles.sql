-- Realtime inserts for in-app ride chat; allow ride participants to read each other's
-- profiles (for display names in the thread) without broadening global user visibility.

-- ---------------------------------------------------------------------------
-- 1) Realtime: messages
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Co-riders on active/scheduled rides can SELECT each other's user row
--    (RLS on users OR-combines with existing policies.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_shares_active_ride_with(p_subject uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.status IN ('scheduled', 'active')
      AND (
        (
          r.driver_id = auth.uid()
          AND EXISTS (
            SELECT 1
            FROM public.ride_passengers rp
            WHERE rp.ride_id = r.id
              AND rp.passenger_id = p_subject
              AND rp.status = 'confirmed'
          )
        )
        OR (
          r.driver_id = p_subject
          AND EXISTS (
            SELECT 1
            FROM public.ride_passengers rp
            WHERE rp.ride_id = r.id
              AND rp.passenger_id = auth.uid()
              AND rp.status = 'confirmed'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM public.ride_passengers rp1
          JOIN public.ride_passengers rp2 ON rp2.ride_id = rp1.ride_id
          WHERE rp1.passenger_id = auth.uid()
            AND rp2.passenger_id = p_subject
            AND rp1.status = 'confirmed'
            AND rp2.status = 'confirmed'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_shares_active_ride_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_shares_active_ride_with(uuid) TO authenticated;

CREATE POLICY "Ride chat participants can view co-rider profiles"
  ON public.users FOR SELECT
  USING (public.user_shares_active_ride_with(id));
