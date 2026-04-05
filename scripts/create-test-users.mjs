/**
 * Poolyn — provision multi-domain test accounts (hosted or local Supabase).
 *
 * Why use this?
 * - Gmail addresses all share the domain "gmail.com", so they cannot represent different
 *   workplace organisations (orgs are keyed by email domain).
 * - This script creates fictional work domains (e.g. @meridiantech.com) with password login.
 *
 * Requirements:
 *   npm install   (uses @supabase/supabase-js from the repo)
 *
 * Run (PowerShell):
 *   $env:SUPABASE_URL="https://xxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."   # Dashboard → Settings → API → service_role (never ship to clients)
 *   $env:TEST_USER_PASSWORD="PoolynTest!2026"   # optional; default below
 *   node scripts/create-test-users.mjs
 *
 * Login in the app: Sign in with any printed email + the same password for every test user.
 *
 * Options (same shell):
 *   SKIP_VEHICLES=1     — skip vehicle rows for drivers
 *   RESET_PASSWORDS=1   — set every listed user’s password to TEST_USER_PASSWORD (fixes wrong password)
 *
 * Geography: Meridian Tech uses one Melbourne CBD workplace; members’ homes fan in on two
 * synthetic “train lines” (eastern suburbs corridor + northern corridor) for multi-vehicle tests.
 * Sydney cluster A shares CBD; cluster B (WestGrid) uses Parramatta for cross-city scenarios.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.TEST_USER_PASSWORD || "PoolynTest!2026";
const SKIP_VEHICLES = process.env.SKIP_VEHICLES === "1";
const RESET_PASSWORDS = process.env.RESET_PASSWORDS === "1";

function pointWkt(lng, lat) {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/** @type {const} */
const ORGS = [
  {
    id: "a1000000-0000-0000-0000-000000000001",
    name: "Meridian Tech",
    domain: "meridiantech.com",
    org_type: "enterprise",
    plan: "business",
    max_seats: 120,
    allow_cross_org: false,
    status: "active",
    active: true,
    invite_code_active: true,
    invite_code: "DEMO-MERIDIAN",
    work_locations: {},
    settings: {},
  },
  {
    id: "a1000000-0000-0000-0000-000000000002",
    name: "Greenleaf University",
    domain: "greenleaf.edu.au",
    org_type: "enterprise",
    plan: "starter",
    max_seats: 200,
    allow_cross_org: false,
    status: "active",
    active: true,
    invite_code_active: true,
    invite_code: "DEMO-GREENLEAF",
    work_locations: {},
    settings: {},
  },
  {
    id: "a1000000-0000-0000-0000-000000000003",
    name: "Nexus Community",
    domain: "nexusinc.com",
    org_type: "community",
    plan: "free",
    max_seats: null,
    allow_cross_org: true,
    status: "active",
    active: true,
    invite_code_active: true,
    invite_code: "DEMO-NEXUS",
    work_locations: {},
    settings: {},
  },
  {
    id: "a1000000-0000-0000-0000-000000000007",
    name: "Harbour Code",
    domain: "harbourcode.io",
    org_type: "enterprise",
    plan: "business",
    max_seats: 60,
    allow_cross_org: false,
    status: "active",
    active: true,
    invite_code_active: true,
    invite_code: "DEMO-HARBOUR",
    work_locations: {},
    settings: {},
  },
  {
    id: "a1000000-0000-0000-0000-000000000008",
    name: "WestGrid Energy",
    domain: "westgrid.net.au",
    org_type: "enterprise",
    plan: "starter",
    max_seats: 120,
    allow_cross_org: false,
    status: "active",
    active: true,
    invite_code_active: true,
    invite_code: "DEMO-WESTGRID",
    work_locations: {},
    settings: {},
  },
];

// Shared workplaces (lng, lat) — many users aim here for easy route overlap.
/** Melbourne CBD hub (Swanston / Town Hall) — “all lines” converge here for org testing */
const MEL_CBD = [144.9631, -37.8136];
const SYD_CBD = [151.2093, -33.8688];
const SYD_PARRA = [151.007, -33.8152];
const GL_CAMPUS = [145.134, -37.915];

/**
 * @type {Array<{
 *   email: string;
 *   full_name: string;
 *   phone_number: string;
 *   orgDomain: string | null;
 *   org_role: "admin"|"member";
 *   registration_type: "enterprise"|"independent";
 *   role: "driver"|"passenger"|"both";
 *   home: [number, number];
 *   work: [number, number];
 *   work_label: string;
 *   detour_tolerance_mins?: number;
 *   license_verified?: boolean;
 *   vehicle?: { make: string; model: string; colour: string; plate: string; seats: number };
 * }>}
 */
const USERS = [
  // —— Melbourne / Meridian (CBD workplace; homes fan in like train corridors) ——
  {
    email: "sarah.chen@meridiantech.com",
    full_name: "Sarah Chen",
    phone_number: "+61400100001",
    orgDomain: "meridiantech.com",
    org_role: "admin",
    registration_type: "enterprise",
    role: "both",
    home: [144.9631, -37.8136],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Toyota", model: "Corolla", colour: "White", plate: "MT001", seats: 4 },
  },
  {
    email: "james.wilson@meridiantech.com",
    full_name: "James Wilson",
    phone_number: "+61400100002",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [145.035, -37.755],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Mazda", model: "CX-5", colour: "Blue", plate: "MT002", seats: 4 },
  },
  {
    email: "priya.sharma@meridiantech.com",
    full_name: "Priya Sharma",
    phone_number: "+61400100003",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.0, -37.78],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "chris.murray@meridiantech.com",
    full_name: "Chris Murray",
    phone_number: "+61400100004",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [144.986, -37.802],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    detour_tolerance_mins: 12,
    license_verified: true,
    vehicle: { make: "Hyundai", model: "Ioniq 6", colour: "Grey", plate: "MT004", seats: 4 },
  },
  {
    email: "alex.ortiz@meridiantech.com",
    full_name: "Alex Ortiz",
    phone_number: "+61400100005",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [144.978, -37.806],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },

  // —— Meridian “Eastern line” (~Lilydale/Belgrave corridor → CBD): 4 drivers + 6 passengers ——
  {
    email: "tessa.briggs@meridiantech.com",
    full_name: "Tessa Briggs",
    phone_number: "+61400101001",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [145.208, -37.814],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Toyota", model: "RAV4", colour: "Silver", plate: "MT101", seats: 5 },
  },
  {
    email: "oliver.hughes@meridiantech.com",
    full_name: "Oliver Hughes",
    phone_number: "+61400101002",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [145.175, -37.818],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Mazda", model: "CX-8", colour: "Grey", plate: "MT102", seats: 7 },
  },
  {
    email: "mia.costa@meridiantech.com",
    full_name: "Mia Costa",
    phone_number: "+61400101003",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [145.132, -37.819],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Kia", model: "Carnival", colour: "Black", plate: "MT103", seats: 8 },
  },
  {
    email: "noah.singh@meridiantech.com",
    full_name: "Noah Singh",
    phone_number: "+61400101004",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [145.082, -37.823],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Hyundai", model: "Tucson", colour: "White", plate: "MT104", seats: 5 },
  },
  {
    email: "ruby.fox@meridiantech.com",
    full_name: "Ruby Fox",
    phone_number: "+61400101005",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.192, -37.816],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "henry.vance@meridiantech.com",
    full_name: "Henry Vance",
    phone_number: "+61400101006",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.158, -37.818],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "willow.reid@meridiantech.com",
    full_name: "Willow Reid",
    phone_number: "+61400101007",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.118, -37.82],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "finn.doyle@meridiantech.com",
    full_name: "Finn Doyle",
    phone_number: "+61400101008",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.095, -37.821],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "chloe.patel@meridiantech.com",
    full_name: "Chloe Patel",
    phone_number: "+61400101009",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.068, -37.822],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "oscar.webb@meridiantech.com",
    full_name: "Oscar Webb",
    phone_number: "+61400101010",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.042, -37.821],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },

  // —— Meridian “Northern line” (~Upfield/Craigieburn corridor → CBD): 4 drivers + 6 passengers ——
  {
    email: "zoe.walsh@meridiantech.com",
    full_name: "Zoe Walsh",
    phone_number: "+61400102001",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [144.908, -37.702],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Subaru", model: "Forester", colour: "Green", plate: "MT201", seats: 5 },
  },
  {
    email: "ethan.morgan@meridiantech.com",
    full_name: "Ethan Morgan",
    phone_number: "+61400102002",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [144.918, -37.724],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Ford", model: "Everest", colour: "Blue", plate: "MT202", seats: 7 },
  },
  {
    email: "ivy.chen@meridiantech.com",
    full_name: "Ivy Chen",
    phone_number: "+61400102003",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [144.936, -37.742],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Tesla", model: "Model Y", colour: "Red", plate: "MT203", seats: 5 },
  },
  {
    email: "jack.obrien@meridiantech.com",
    full_name: "Jack O'Brien",
    phone_number: "+61400102004",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [144.958, -37.772],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
    license_verified: true,
    vehicle: { make: "Mitsubishi", model: "Outlander", colour: "White", plate: "MT204", seats: 7 },
  },
  {
    email: "amelia.hart@meridiantech.com",
    full_name: "Amelia Hart",
    phone_number: "+61400102005",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [144.912, -37.712],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "lucas.grant@meridiantech.com",
    full_name: "Lucas Grant",
    phone_number: "+61400102006",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [144.926, -37.732],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "sophie.ryan@meridiantech.com",
    full_name: "Sophie Ryan",
    phone_number: "+61400102007",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [144.948, -37.752],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "ben.taylor@meridiantech.com",
    full_name: "Ben Taylor",
    phone_number: "+61400102008",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [144.962, -37.762],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "grace.ellis@meridiantech.com",
    full_name: "Grace Ellis",
    phone_number: "+61400102009",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [144.964, -37.785],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },
  {
    email: "max.brooks@meridiantech.com",
    full_name: "Max Brooks",
    phone_number: "+61400102010",
    orgDomain: "meridiantech.com",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [144.952, -37.802],
    work: MEL_CBD,
    work_label: "Meridian Tech — Melbourne CBD",
  },

  // —— Sydney / Harbour Code → CBD ——
  {
    email: "nina.park@harbourcode.io",
    full_name: "Nina Park",
    phone_number: "+61400200001",
    orgDomain: "harbourcode.io",
    org_role: "admin",
    registration_type: "enterprise",
    role: "both",
    home: [151.2748, -33.8915],
    work: SYD_CBD,
    work_label: "Harbour Code — Sydney CBD",
    license_verified: true,
    vehicle: { make: "Tesla", model: "Model 3", colour: "Black", plate: "HC001", seats: 4 },
  },
  {
    email: "sam.oconnor@harbourcode.io",
    full_name: "Sam O'Connor",
    phone_number: "+61400200002",
    orgDomain: "harbourcode.io",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [151.0, -33.82],
    work: SYD_CBD,
    work_label: "Harbour Code — Sydney CBD",
    license_verified: true,
    vehicle: { make: "Subaru", model: "Outback", colour: "Green", plate: "HC002", seats: 4 },
  },
  {
    email: "ravi.iyer@harbourcode.io",
    full_name: "Ravi Iyer",
    phone_number: "+61400200003",
    orgDomain: "harbourcode.io",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [151.18, -33.896],
    work: SYD_CBD,
    work_label: "Harbour Code — Sydney CBD",
  },
  // —— Sydney west / WestGrid → Parramatta (overlap with Sam’s corridor) ——
  {
    email: "dana.nguyen@westgrid.net.au",
    full_name: "Dana Nguyen",
    phone_number: "+61400300001",
    orgDomain: "westgrid.net.au",
    org_role: "admin",
    registration_type: "enterprise",
    role: "both",
    home: [150.906, -33.769],
    work: SYD_PARRA,
    work_label: "WestGrid — Parramatta",
    license_verified: true,
    vehicle: { make: "Ford", model: "Escape", colour: "Silver", plate: "WG001", seats: 4 },
  },
  {
    email: "lee.kim@westgrid.net.au",
    full_name: "Lee Kim",
    phone_number: "+61400300002",
    orgDomain: "westgrid.net.au",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [150.987, -33.804],
    work: SYD_PARRA,
    work_label: "WestGrid — Parramatta",
    license_verified: true,
    vehicle: { make: "Kia", model: "Sportage", colour: "Red", plate: "WG002", seats: 4 },
  },
  {
    email: "kate.brown@westgrid.net.au",
    full_name: "Kate Brown",
    phone_number: "+61400300003",
    orgDomain: "westgrid.net.au",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [150.992, -33.808],
    work: SYD_PARRA,
    work_label: "WestGrid — Parramatta",
  },
  // —— Greenleaf (Clayton campus) ——
  {
    email: "dr.patel@greenleaf.edu.au",
    full_name: "Dr. Arun Patel",
    phone_number: "+61400400001",
    orgDomain: "greenleaf.edu.au",
    org_role: "admin",
    registration_type: "enterprise",
    role: "both",
    home: [145.13, -37.91],
    work: GL_CAMPUS,
    work_label: "Greenleaf Uni — Main Campus",
    license_verified: true,
    vehicle: { make: "Hyundai", model: "Ioniq 5", colour: "Silver", plate: "GL001", seats: 4 },
  },
  {
    email: "emma.nguyen@greenleaf.edu.au",
    full_name: "Emma Nguyen",
    phone_number: "+61400400002",
    orgDomain: "greenleaf.edu.au",
    org_role: "member",
    registration_type: "enterprise",
    role: "passenger",
    home: [145.06, -37.88],
    work: GL_CAMPUS,
    work_label: "Greenleaf Uni — Main Campus",
  },
  {
    email: "marcus.lee@greenleaf.edu.au",
    full_name: "Marcus Lee",
    phone_number: "+61400400003",
    orgDomain: "greenleaf.edu.au",
    org_role: "member",
    registration_type: "enterprise",
    role: "driver",
    home: [145.102, -37.895],
    work: GL_CAMPUS,
    work_label: "Greenleaf Uni — Main Campus",
    license_verified: true,
    vehicle: { make: "Volkswagen", model: "Golf", colour: "Blue", plate: "GL003", seats: 4 },
  },
  // —— Nexus community member ——
  {
    email: "tom.baker@nexusinc.com",
    full_name: "Tom Baker",
    phone_number: "+61400500001",
    orgDomain: "nexusinc.com",
    org_role: "member",
    registration_type: "independent",
    role: "both",
    home: [144.95, -37.84],
    work: [144.9631, -37.8136],
    work_label: "Nexus — Collins St hub",
    license_verified: false,
  },
  // —— True explorer (no org) — fictional personal-style domain not in PERSONAL blocklist ——
  {
    email: "river.jordan@poolyn-film.test",
    full_name: "River Jordan",
    phone_number: "+61400600001",
    orgDomain: null,
    org_role: "member",
    registration_type: "independent",
    role: "passenger",
    home: [151.2, -33.89],
    work: SYD_CBD,
    work_label: "Freelance — CBD",
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
      /already|registered|exists/i.test(error.message) ||
      error.status === 422;
    if (existsAgain) {
      const id = await findAuthUserId(adminAuth, email);
      if (id) return { id, created: false };
    }
    throw error;
  }
  return { id: data.user.id, created: true };
}

async function ensureOrgSubscription(svc, orgId, plan) {
  const { count, error: cErr } = await svc
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (cErr) throw cErr;
  if (count && count > 0) return;

  const { error } = await svc.from("subscriptions").insert({
    org_id: orgId,
    plan,
    seat_count: plan === "business" ? 120 : 200,
    status: "active",
  });
  if (error) throw error;
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

  console.log("Upserting organisations…");
  for (const o of ORGS) {
    const { error } = await svc.from("organisations").upsert(o, { onConflict: "id" });
    if (error) {
      console.error("Org upsert failed:", o.domain, error.message);
      process.exit(1);
    }
  }

  for (const o of ORGS) {
    if (o.org_type === "enterprise") {
      await ensureOrgSubscription(svc, o.id, o.plan);
    }
  }

  const domainToOrgId = Object.fromEntries(ORGS.map((o) => [o.domain, o.id]));
  const adminAuth = svc.auth.admin;

  console.log("Creating / updating auth users and profiles…");
  const lines = [];
  let authCreated = 0;
  let authExisted = 0;

  for (const u of USERS) {
    const orgId = u.orgDomain ? domainToOrgId[u.orgDomain] : null;
    if (u.orgDomain && !orgId) {
      console.error("Unknown org domain:", u.orgDomain);
      process.exit(1);
    }

    const { id: userId, created } = await ensureAuthUser(adminAuth, u.email, u.full_name);
    if (created) authCreated += 1;
    else authExisted += 1;

    if (RESET_PASSWORDS) {
      const { error: pwErr } = await adminAuth.updateUserById(userId, { password: PASSWORD });
      if (pwErr) console.warn("  (password reset)", u.email, pwErr.message);
    }

    const homeWkt = pointWkt(u.home[0], u.home[1]);
    const workWkt = pointWkt(u.work[0], u.work[1]);

    const patch = {
      full_name: u.full_name,
      phone_number: u.phone_number,
      org_id: orgId,
      org_role: u.org_role,
      registration_type: u.registration_type,
      role: u.role,
      home_location: homeWkt,
      pickup_location: homeWkt,
      work_location: workWkt,
      work_location_label: u.work_label,
      detour_tolerance_mins: u.detour_tolerance_mins ?? 12,
      license_verified: u.license_verified ?? false,
      org_member_verified: orgId ? true : false,
      onboarding_completed: true,
      active: true,
      visibility_mode: "network",
      driver_show_outer_network_riders: true,
    };

    const { error: upErr } = await svc.from("users").update(patch).eq("id", userId);
    if (upErr) {
      console.error("users.update failed:", u.email, upErr.message);
      process.exit(1);
    }

    if (!SKIP_VEHICLES && u.vehicle && (u.role === "driver" || u.role === "both")) {
      await svc.from("vehicles").delete().eq("user_id", userId);
      const { error: vErr } = await svc.from("vehicles").insert({
        user_id: userId,
        make: u.vehicle.make,
        model: u.vehicle.model,
        colour: u.vehicle.colour,
        plate: u.vehicle.plate,
        seats: u.vehicle.seats,
        vehicle_class: "sedan",
        active: true,
      });
      if (vErr) {
        console.error("vehicles.insert:", u.email, vErr.message);
        process.exit(1);
      }
    }

    lines.push(
      `${u.email}  |  ${u.orgDomain ?? "Explorer"}  |  ${created ? "created" : "existed"}`
    );
  }

  console.log("\n=== Sign-in (email + password for every row) ===");
  console.log("Password:", PASSWORD);
  console.log("");
  for (const line of lines) console.log(line);
  console.log(
    `\nSummary: ${authCreated} new Auth user(s) created, ${authExisted} already existed (profile still updated). Total rows: ${USERS.length}.`
  );
  console.log(
    "\nTip: these domains are fictional. For real inboxes on your own domain, use Cloudflare Email Routing or an alias service so you still receive Supabase mails if needed."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
