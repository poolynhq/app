/**
 * Poolyn — seed 8 Meridian Tech passengers for Golden Grove → Edinburgh commute testing.
 *
 * Layout (aligned with Google’s “via The Grove Way” ~14.5 km fast route vs longer Golden Way):
 *   - 2 riders on the *common* early spine (The Grove Way out of Golden Grove, before the fork).
 *   - 3 riders on the *Salisbury / Main North / Purling* fast corridor (reuse commute.adl.on1–on3).
 *   - 3 riders on the *Elizabeth / Golden Way* longer corridor (reuse detour1–detour2 + one new account
 *     with workplace at RAAF Edinburgh, West Ave).
 *
 * Anchors (verify pins in-app after seeding):
 *   Driver home: 19 Emperor Ave, Golden Grove SA 5125   → ~138.6974, -34.7904
 *   Driver work: DST Group, Third Ave, Edinburgh SA 5111 → ~138.6240, -34.7070
 *   RAAF drop-off: West Ave, Edinburgh (visitor / gate area) → ~138.6290, -34.7045
 *
 * Optional — apply your real driver profile (same password as TEST_USER_PASSWORD if auth exists):
 *   $env:COMMUTE_DRIVER_EMAIL="you@yourdomain.com"
 *   $env:COMMUTE_DRIVER_VEHICLE_PLATE="ABC123"   # optional; default POOLYN5
 *
 * Mapbox note: the app now treats the *shortest returned distance* as the primary commute route when
 * alternatives exist (see mapboxCommutePreview + commuteRouteStorage). Matching still depends on each
 * user refreshing their stored `commute_routes` (open app / save commute).
 *
 * Run:
 *   npm run seed:adelaide-commute-riders
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.TEST_USER_PASSWORD || "PoolynTest!2026";
const ORG_DOMAIN = (process.env.SEED_ORG_DOMAIN || "meridiantech.com").toLowerCase();
const DRIVER_EMAIL = (process.env.COMMUTE_DRIVER_EMAIL || "").trim().toLowerCase();
const DRIVER_PLATE = (process.env.COMMUTE_DRIVER_VEHICLE_PLATE || "POOLYN5").trim();

/** DST Group — Third Ave */
const WORK_DST_LNG = 138.624;
const WORK_DST_LAT = -34.707;
const WORK_DST_LABEL = "DST Group — Third Ave, Edinburgh SA 5111";

/** RAAF Base Edinburgh — West Ave (approx. gate approach; not Third Ave DST pin) */
const WORK_RAAF_LNG = 138.629;
const WORK_RAAF_LAT = -34.7045;
const WORK_RAAF_LABEL = "RAAF Base Edinburgh — West Ave, Edinburgh SA 5111";

/** 19 Emperor Ave, Golden Grove (approx.) */
const DRIVER_HOME_LNG = 138.6974;
const DRIVER_HOME_LAT = -34.7904;

function pointWkt(lng, lat) {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/**
 * @type {Array<{
 *   email: string;
 *   full_name: string;
 *   phone_number: string;
 *   band: "common" | "salisbury" | "elizabeth";
 *   home_label: string;
 *   home: [number, number];
 *   work?: "dst" | "raaf";
 * }>}
 */
const RIDERS = [
  {
    email: "commute.adl.common1@meridiantech.com",
    full_name: "Adelaide Rider Common1 (The Grove Way)",
    phone_number: "+61408001006",
    band: "common",
    home_label: "The Grove Way — Cobbler Creek / Salisbury Heights (shared early leg)",
    home: [138.7078, -34.7788],
  },
  {
    email: "commute.adl.common2@meridiantech.com",
    full_name: "Adelaide Rider Common2 (The Grove Way)",
    phone_number: "+61408001007",
    band: "common",
    home_label: "The Grove Way — Salisbury Heights (before Main North vs Golden Way fork)",
    home: [138.7012, -34.7715],
  },
  {
    email: "commute.adl.on1@meridiantech.com",
    full_name: "Adelaide Rider Salisbury1 (Main North)",
    phone_number: "+61408001001",
    band: "salisbury",
    home_label: "Main North Rd — Salisbury / Parabanks corridor (fast route)",
    home: [138.6795, -34.7615],
  },
  {
    email: "commute.adl.on2@meridiantech.com",
    full_name: "Adelaide Rider Salisbury2 (Main North)",
    phone_number: "+61408001002",
    band: "salisbury",
    home_label: "Main North Rd — Salisbury (fast route)",
    home: [138.6708, -34.7528],
  },
  {
    email: "commute.adl.on3@meridiantech.com",
    full_name: "Adelaide Rider Salisbury3 (toward Purling)",
    phone_number: "+61408001003",
    band: "salisbury",
    home_label: "Main North / Penfield approach (fast route toward Purling Ave)",
    home: [138.6565, -34.7368],
  },
  {
    email: "commute.adl.detour1@meridiantech.com",
    full_name: "Adelaide Rider Elizabeth1 (Golden Way corridor)",
    phone_number: "+61408001004",
    band: "elizabeth",
    home_label: "Elizabeth South — Golden Way / longer northern loop style corridor",
    home: [138.6905, -34.7475],
  },
  {
    email: "commute.adl.detour2@meridiantech.com",
    full_name: "Adelaide Rider Elizabeth2 (Golden Way corridor)",
    phone_number: "+61408001005",
    band: "elizabeth",
    home_label: "Elizabeth — Golden Way style corridor",
    home: [138.6688, -34.7255],
  },
  {
    email: "commute.adl.eliz.raaf@meridiantech.com",
    full_name: "Adelaide Rider Elizabeth3 (drop RAAF West Ave)",
    phone_number: "+61408001008",
    band: "elizabeth",
    home_label: "Greenwith / northern Golden Way side (longer route family)",
    home: [138.701, -34.712],
    work: "raaf",
  },
];

async function findAuthUserId(adminAuth, email) {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await adminAuth.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function ensureAuthUser(adminAuth, email, full_name) {
  const existing = await findAuthUserId(adminAuth, email);
  if (existing) return { id: existing, created: false };

  const { data, error } = await adminAuth.createUser({
    email: email.toLowerCase(),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) {
    const existsAgain =
      /already|registered|exists/i.test(error.message) || error.status === 422;
    if (existsAgain) {
      const id = await findAuthUserId(adminAuth, email);
      if (id) return { id, created: false };
    }
    throw error;
  }
  return { id: data.user.id, created: true };
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "Missing SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(1);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orgRow, error: orgErr } = await svc
    .from("organisations")
    .select("id")
    .eq("domain", ORG_DOMAIN)
    .maybeSingle();
  if (orgErr) throw orgErr;
  if (!orgRow?.id) {
    console.error(`No organisation with domain "${ORG_DOMAIN}". Run seed:test-users first or create the org.`);
    process.exit(1);
  }

  const orgId = orgRow.id;
  const adminAuth = svc.auth.admin;
  const workDstWkt = pointWkt(WORK_DST_LNG, WORK_DST_LAT);
  const workRaafWkt = pointWkt(WORK_RAAF_LNG, WORK_RAAF_LAT);

  console.log(`Organisation: ${ORG_DOMAIN} (${orgId})\n`);

  for (const r of RIDERS) {
    const { id: userId, created } = await ensureAuthUser(adminAuth, r.email, r.full_name);
    const homeWkt = pointWkt(r.home[0], r.home[1]);
    const useRaaf = r.work === "raaf";
    const workWkt = useRaaf ? workRaafWkt : workDstWkt;
    const workLabel = useRaaf ? WORK_RAAF_LABEL : WORK_DST_LABEL;

    const patch = {
      full_name: r.full_name,
      phone_number: r.phone_number,
      org_id: orgId,
      org_role: "member",
      registration_type: "enterprise",
      role: "passenger",
      home_location: homeWkt,
      pickup_location: homeWkt,
      work_location: workWkt,
      work_location_label: workLabel,
      detour_tolerance_mins: r.band === "elizabeth" ? 18 : 12,
      license_verified: false,
      org_member_verified: true,
      onboarding_completed: true,
      active: true,
      visibility_mode: "network",
      driver_show_outer_network_riders: true,
    };

    const { error: upErr } = await svc.from("users").update(patch).eq("id", userId);
    if (upErr) {
      console.error("users.update failed:", r.email, upErr.message);
      process.exit(1);
    }

    console.log(
      `${created ? "created" : "existed"}  ${r.email}  [${r.band}]  ${useRaaf ? "[work=RAAF] " : ""}${r.home_label}`
    );
  }

  if (DRIVER_EMAIL) {
    const driverId = await findAuthUserId(adminAuth, DRIVER_EMAIL);
    if (!driverId) {
      console.error("\nCOMMUTE_DRIVER_EMAIL set but no Auth user found:", DRIVER_EMAIL);
      process.exit(1);
    }
    const homeWkt = pointWkt(DRIVER_HOME_LNG, DRIVER_HOME_LAT);
    const driverPatch = {
      home_location: homeWkt,
      pickup_location: homeWkt,
      work_location: workDstWkt,
      work_location_label: WORK_DST_LABEL,
      role: "both",
      onboarding_completed: true,
      active: true,
      license_verified: true,
      detour_tolerance_mins: 15,
      visibility_mode: "network",
      driver_show_outer_network_riders: true,
    };
    const { error: dErr } = await svc.from("users").update(driverPatch).eq("id", driverId);
    if (dErr) {
      console.error("Driver users.update failed:", dErr.message);
      process.exit(1);
    }
    await svc.from("vehicles").delete().eq("user_id", driverId);
    const { error: vErr } = await svc.from("vehicles").insert({
      user_id: driverId,
      make: "Toyota",
      model: "Camry",
      colour: "Silver",
      plate: DRIVER_PLATE,
      seats: 5,
      vehicle_class: "sedan",
      active: true,
    });
    if (vErr) {
      console.error("Driver vehicle insert:", vErr.message);
      process.exit(1);
    }
    console.log(`\nDriver profile updated: ${DRIVER_EMAIL} (home Emperor Ave, work DST, 5 seats, plate ${DRIVER_PLATE})`);
  } else {
    console.log("\nTip: set COMMUTE_DRIVER_EMAIL to seed your own account’s home/work + 5-seat vehicle.");
  }

  console.log("\n=== Rider sign-in ===");
  console.log("Password:", PASSWORD);
  console.log("\nAfter seeding: open the app once per user so commute_routes can refresh with the new Mapbox logic.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
