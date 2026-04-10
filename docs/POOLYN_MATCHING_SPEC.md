# Poolyn — Matching, routing, reservation & cost-sharing

**Status:** Source of truth for implementation.  
**Replaces:** Proximity-only matching (`find_commuter_matches` / home–work distance scoring) and ride-posting as a prerequisite for daily commuting.

---

## Core principles

- Commute coordination: **no ride posting** required for daily matching.
- Matching is **automatic** (on-demand + periodic refresh).
- Drivers **do not** operate for profit; passengers contribute **fairly** by usage and impact.
- **Geometry-first:** real route polylines (Mapbox Directions), not point proximity.
- **V1:** No driver wallet or payout; **cost recovery + small capped margin only**.
- Amounts stored as **integer cents**; design for **real money** readiness.

---

## Route geometry (source of truth)

- Every user **must** have a stored **home → work** commute route (`commute_routes`).
- Generated with **Mapbox Directions API** only (single engine for baseline + detour).
- Default stored path is Mapbox’s **primary** route (`routes[0]` when using `mapbox/driving-traffic`); users may pick alternates by index in the same API order.
- Stored `duration_s` for commute rows uses **`duration_typical`** when the traffic profile returns it (usual travel time); live `duration` is kept for detours / ride hints. Distances prefer summed **leg** lengths when present.
- Store: encoded polyline (optional), `route_geom` (LineString), `distance_m`, `duration_s`, axis-aligned **bbox** for fast pre-filter.
- Generated: onboarding, when home/work changes, optional periodic refresh.
- **No valid route → excluded from matching** (no proximity fallback).

---

## Vehicle & trip cost

- **`total_trip_cost_cents`** = `round(baseline_route_distance_km × class_cost_per_km_cents)`  
  where **`class_cost_per_km_cents`** comes from **vehicle class** (not free-form user input).
- Classes: **compact, sedan, suv, large_suv, electric** — each has a global default cents/km; **optional org overrides**.
- Drivers **cannot** edit pricing parameters.

---

## Matching scope

- **Primary:** same organisation (`org_id`).
- **Secondary (optional):** “local pool” — route corridor / bbox intersection; **OFF by default** (`allow_cross_org` / profile toggle may enable — product-specific).

---

## Time model

- **Recurring schedule** + optional **daily override** (`daily_commute_overrides`).
- Match when **time windows overlap** (implemented in app layer or future RPC).
- **Pickup ETA:** Mapbox Directions with **traffic** (not static schedule-only).

---

## Roles

- Preferences: Always drive / Always ride / Flexible; **effective mode** per day (`users.active_mode` for flexible).
- Drivers need **valid vehicle** and **available seats** for supply.

---

## Pipeline (implementation)

1. **Pre-filter (SQL):** org (+ optional local pool), bbox overlap, both have `commute_routes`, role eligibility, vehicle present for drivers.
2. **Route compatibility (TS + Mapbox):** overlap ratio, corridor distance checks, pickup/drop-off snapped to driver route.
3. **Detour (Mapbox):** baseline driver route vs route with passenger stops; reject if over tolerance.
4. **Cost (TS):** distance share, detour cost, capped time penalty, pickup fee; enforce **Σ payments ≤ trip_cost + margin**.
5. **Score & rank:** weighted score, then **fairness** using `seed = hash(user_id + date)` for rotation within top bucket.

---

## Cost formulas (cents)

- **Distance (share):**  
  `distance_cost = (passenger_segment_distance / total_route_with_passenger_distance) × total_trip_cost_cents`  
  (with guards for division by zero.)
- **Detour:** `detour_extra_distance_m × class_cost_per_km` equivalent (assigned to that passenger).
- **Time penalty:** `min(detour_minutes × rate_cents_per_min, cap_cents)`.
- **Pickup fee:** fixed per passenger (org override allowed).
- **Constraint:** `total_passenger_payment_cents ≤ total_trip_cost_cents + margin_cents`.

---

## Reservations

- States: `available` → `reserved` (TTL **~120s**) → `confirmed` / `expired` / `cancelled`.
- **Seat model:** logical opportunity with **`seats_remaining` decremented atomically** under transaction (no double booking).

---

## Ride cards & privacy (UX)

- Users choose **ride opportunities**, not people.
- Before confirmation: **no** driver name, photo, or exact address; show overlap %, ETA band, vehicle class, seats, cost estimate, trust metrics.
- After confirmation: reveal identity and precise pickup.

### Driver-facing copy

- Use **“You saved $X”** / **“Your commute cost was reduced by $X”** — never “earnings”, “income”, “payout”, “balance”.

---

## Fairness rotation

- `seed = SHA-256( user_id canonical + "|" + YYYY-MM-DD UTC )` — use first 8 bytes as uint64 for ordering tie-break / bucket shuffle (document exact implementation in code).

---

## Legacy removal

- Do **not** use home/work **point distance** as the primary match.
- Do **not** require **ride posts** or **ride_requests** for daily commuter matching.

---

## Changelog

- **2026-04-02:** Initial locked spec + geometry-first implementation track.
