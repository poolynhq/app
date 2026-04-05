# Ride request flow (manual test)

The **Discover** tab was removed; map + overlap snapshot + seat lists live on **Home** under “NETWORK & SEATS”. Deep link `?scrollTo=opportunities` scrolls to bookable seats.

Apply migrations in order:

- `0047_ride_request_notify_and_accept.sql`
- `0048_discover_snapshot_push_tokens.sql` (snapshot RPC, push tokens, Realtime on `notifications`)
- `0049_ride_request_targeted_notify_and_timing.sql` (Uber-style **Now** vs **In N min**, targeted driver alerts, optional org-wide fallback if no one matches geometry)
- `0050_ride_request_one_pending_and_richer_notifications.sql` (**one** pending pickup per passenger; clearer passenger notification on accept)
- `0051_ride_request_expiry_realtime.sql` (`expires_at` + auto-expire RPC; **Realtime** on `ride_requests`, `ride_passengers`, `rides` so passenger UI updates when a driver accepts)

Use `npx supabase db push` or run SQL in the dashboard.

## Accounts

1. **Passenger**: same org as driver, **Profile → Commute** with home and work, and a saved **to_work** commute route (geometry overlap counts need it).
2. **Driver**: same org, role driver or both (Driving mode if both), at least one **active vehicle** with **seats &gt; 1**.
3. Organisation **status** must be **active** or **grace** (inactive orgs do not match in geometry RPCs).

## Discover snapshot (why overlap was 0)

The big number is **geometry overlap** peers. It stays **0** until both sides have **`commute_routes`** (to_work) that **bbox-overlap** and the org gate passes. The row **Org · saved routes** counts colleagues in your org who already saved a route (so you can see signal before overlap exists). **Wider pool** is extra peers when the extended prefilter is on.

## Passenger: post a request

1. **Home → Post a request** (riding context).
2. **When**: **Now** (immediate) or **In 15 min** (advance notice). Optional 30 / 45 / 60 under “Other times”.
3. **Post**. **Now** also runs `auto_assign_driver_for_request` if you have trusted auto-accept set up.

The orange map dot is **demand heat**, not the driver alert. Drivers are notified by **push / in-app** when they match seats, route, time, or org fallback.

## Driver: alert (sound + banner)

1. Install a **dev build** or **EAS build** (not Expo Go) if you need a reliable **Expo push token**; the app still **schedules a local notification** when a matching row is **inserted** into `notifications` while the app is running and **Supabase Realtime** is enabled (migration adds `notifications` to `supabase_realtime` when missing).
2. Accept OS notification permission on first launch.
3. Driver should get a **high-priority** Android channel / sound for `ride_request_pending` and `ride_request_accepted`.

## Remote push when the app is killed

1. Deploy `supabase/functions/send-expo-push` and set secrets: `EXPO_ACCESS_TOKEN` (from [expo.dev](https://expo.dev) access tokens), plus default `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. Add a **Database Webhook** on `public.notifications` **INSERT** (filter `type = ride_request_pending` if you want) that POSTs the new row’s `user_id`, `title`, `body` to the function body expected by `send-expo-push/index.ts`.

## Driver: in-app

1. **Profile → Activity** shows **Pickup request**; tap opens **My Rides → Open requests**.
2. **Accept & create ride** → passenger gets **Ride confirmed** in Activity.

## Passenger: Find a ride

**Home → Find a ride** opens **Discover** and scrolls to **Ride opportunities** (`?scrollTo=opportunities`).

## Failure reasons (RPC)

- `commute_not_set`: passenger home/work missing.
- `no_vehicle`: driver has no active multi-seat vehicle.
- `not_pending`: request already matched.
- `org_mismatch`: passenger and driver not in the same org context.
