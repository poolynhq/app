# Poolyn QA Checklist: Matching + Maps + Admin Rollout

Date: 2026-03-30
Scope: Matching engine, discover visibility, map layers, supply balancing, admin monetization.

## 1) Automated Validation (Current Run)

- `npm run lint`
  - Result: PASS (no lint errors)
  - Existing warnings (non-blocking): 4
- `npx tsc --noEmit`
  - Result: FAIL (pre-existing baseline type errors in multiple files)
  - Key blocker theme: Supabase typed client schema mismatch causing `never`/`undefined` RPC arg signatures.

## 2) Critical Regression Checks

- [x] Discover map component prop type fix validated:
  - `src/components/maps/DiscoverMapLayers.tsx`
  - `MapView` now uses `mapStyle` instead of invalid `styleURL`.
- [x] Discover retains no-empty-state fallback cards even with zero matches.
- [x] Visibility toggle still persists to `users.visibility_mode`.

## 3) Entry + Onboarding (Ungated Flow)

### A. Auth entry
- [ ] Option text shows:
  - "Start a Network"
  - "Join or Explore"
- [ ] "Join or Explore" does not hard-gate behind invite code.

### B. Sign-up and onboarding progression
- [ ] New individual user can move through:
  - role -> location -> schedule -> vehicle optional -> completion
- [ ] Schedule save fallback works if `reliability_score` columns are missing.
- [ ] Vehicle step allows skip and still completes onboarding.

### C. Network association
- [ ] Domain-based org auto-link works when domain exists.
- [ ] User without org is still onboarded and sees nearby fallback.

## 4) Discover + Matching UX

### A. Sections and fallback
- [ ] "From your organization" section renders when org peers exist.
- [ ] "Nearby commuters" section always renders as fallback.
- [ ] Fallback copy appears when org has no peers:
  - "Be the first in your network - we found X nearby commuters instead"

### B. Match list payload
- [ ] Match cards show:
  - trust label
  - reliability
  - overlap signal
  - score
- [ ] Filters apply correctly:
  - verified drivers only
  - min reliability
  - gender preference
  - scope tabs (`all`, `network`, `nearby`)

### C. Backend matching RPCs
- [ ] `compute_match_candidates` returns scored candidates for user.
- [ ] `upsert_match_suggestions` inserts/updates pending suggestions.
- [ ] `get_discover_matches` returns sectioned rows with trust labels.

## 5) Supply Balancing + Auto-Assign

- [ ] `recompute_driver_assignment_stats` updates 30-day assignment stats.
- [ ] `auto_assign_driver_for_request`:
  - selects candidate using fairness + reliability + time/distance
  - confirms passenger
  - decrements seat count
  - marks request as matched
  - writes accepted suggestion record
- [ ] User profile toggle writes driver auto-assign preference.
- [ ] Admin settings toggle writes org auto-assign setting.

## 6) Map Layer QA (Native + Fallback)

### A. Backend payload
- [ ] `get_map_layers_for_discover` returns JSON object with:
  - `demand_points` (FeatureCollection)
  - `supply_points` (FeatureCollection)
  - `route_lines` (FeatureCollection)

### B. UI behavior
- [ ] Native (Android/iOS): heatmap + clusters + line overlay visible.
- [ ] Web: graceful fallback card shown (no crash).
- [ ] Empty data: informative overlay hint shown.

## 7) Admin Analytics + Monetization

- [ ] Dashboard shows:
  - total members
  - active users
  - active commuters
  - total rides
  - CO2 saved
  - peak commute window
  - demand/supply delta
- [ ] Plan usage panel shows:
  - active users
  - overage users
  - estimated overage cost
- [ ] Upgrade CTA routes to admin settings.
- [ ] Member page shows recent flex grant/campaign history.

## 8) Pricing + Messaging Verification

- [ ] Plan cards reflect:
  - Basic ($29)
  - Growth ($49)
  - Business ($99)
  - Enterprise (Custom)
- [ ] No paywall gating before onboarding completion.
- [ ] No pay-per-ride or driver earnings UI introduced.

## 9) Security + Policy Checks

- [ ] `SECURITY DEFINER` functions scoped to required operations only.
- [ ] Match visibility works for independent users without org gating.
- [ ] Existing RLS still prevents unauthorized direct data access.

## 10) Known Blockers To Resolve Next

1. Regenerate Supabase types and align schema:
   - Run `npm run db:types` with valid `SUPABASE_PROJECT_ID`.
   - Reconcile generated `src/types/database.ts` with custom aliases.
2. Resolve current TypeScript baseline errors in auth/onboarding/admin files.
3. Re-run:
   - `npx tsc --noEmit`
   - `npm run lint`
   - manual matrix above.

## Exit Criteria

Release is QA-ready when:
- `lint` has zero errors.
- `tsc --noEmit` passes.
- All manual checklist items above are completed.
