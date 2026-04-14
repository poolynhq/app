-- ride_passengers policies used "ride_id IN (SELECT id FROM rides WHERE driver_id = ...)" which
-- re-evaluates all rides RLS policies, including "Passengers can view their rides" (subquery on
-- ride_passengers) → infinite recursion and 500 from PostgREST on rides / ride_passengers embeds.
-- SECURITY DEFINER helper reads driver_id without re-entering rides RLS (same pattern as 0060).

CREATE OR REPLACE FUNCTION public.poolyn_user_is_driver_of_ride(p_ride_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.id = p_ride_id
      AND r.driver_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.poolyn_user_is_driver_of_ride(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_user_is_driver_of_ride(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Drivers can view ride passengers" ON public.ride_passengers;
CREATE POLICY "Drivers can view ride passengers"
  ON public.ride_passengers FOR SELECT
  TO authenticated
  USING (public.poolyn_user_is_driver_of_ride(ride_id, auth.uid()));

DROP POLICY IF EXISTS "Drivers can update ride passengers" ON public.ride_passengers;
CREATE POLICY "Drivers can update ride passengers"
  ON public.ride_passengers FOR UPDATE
  TO authenticated
  USING (public.poolyn_user_is_driver_of_ride(ride_id, auth.uid()))
  WITH CHECK (public.poolyn_user_is_driver_of_ride(ride_id, auth.uid()));
