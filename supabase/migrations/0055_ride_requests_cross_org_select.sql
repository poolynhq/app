-- Let drivers who opted into outer-network matching actually read pending pickup
-- requests from passengers outside their org, when organisation rules allow it.
-- (accept_ride_request_as_driver already enforces the same rules.)

CREATE POLICY "Drivers cross-network pending ride requests"
  ON public.ride_requests FOR SELECT
  TO authenticated
  USING (
    status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.users me
      WHERE me.id = auth.uid()
        AND me.role IN ('driver', 'both')
        AND me.active = true
    )
    AND (
      -- Org driver + passenger elsewhere: both sides allow cross-org; driver opted in.
      (
        EXISTS (
          SELECT 1
          FROM public.users d
          JOIN public.organisations od ON od.id = d.org_id
          WHERE d.id = auth.uid()
            AND d.org_id IS NOT NULL
            AND od.allow_cross_org = true
            AND COALESCE(d.driver_show_outer_network_riders, false) = true
        )
        AND EXISTS (
          SELECT 1
          FROM public.users p
          LEFT JOIN public.organisations po ON po.id = p.org_id
          WHERE p.id = ride_requests.passenger_id
            AND p.active = true
            AND p.org_id IS DISTINCT FROM (SELECT u.org_id FROM public.users u WHERE u.id = auth.uid())
            AND (
              p.org_id IS NULL
              OR COALESCE(po.allow_cross_org, false) = true
            )
        )
      )
      OR
      -- Independent driver + passenger in an org that allows outsiders
      (
        (SELECT u.org_id FROM public.users u WHERE u.id = auth.uid()) IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.users p
          JOIN public.organisations po ON po.id = p.org_id
          WHERE p.id = ride_requests.passenger_id
            AND p.active = true
            AND po.allow_cross_org = true
        )
      )
    )
  );
