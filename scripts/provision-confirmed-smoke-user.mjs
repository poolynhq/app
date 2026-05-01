/**
 * Create one Auth user with email already confirmed (no inbox step).
 * public.users row is created by DB trigger handle_new_user; onboarding_completed stays false.
 *
 * PowerShell:
 *   $env:SUPABASE_URL="https://xxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."   # Dashboard → Settings → API → service_role
 *   $env:TEST_USER_PASSWORD="YourLocalSecret"   # optional
 *   $env:SMOKE_USER_EMAIL="you@poolyn-film.test"   # optional
 *   node scripts/provision-confirmed-smoke-user.mjs
 *
 * App dev: set EXPO_PUBLIC_POOLYN_SIGNUP_OPEN=1 so Sign up is not replaced by signup-closed.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.TEST_USER_PASSWORD || "PoolynTest!2026";
const EMAIL = (
  process.env.SMOKE_USER_EMAIL || "poolyn-onboarding-smoke@poolyn-film.test"
).toLowerCase();
const FULL_NAME = process.env.SMOKE_USER_FULL_NAME || "Onboarding Smoke";
/** Set to 1 to clear org_id after trigger (explorer-style row). */
const EXPLORER_NO_ORG = process.env.EXPLORER_NO_ORG === "1";

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
  const adminAuth = svc.auth.admin;

  let userId = await findAuthUserId(adminAuth, EMAIL);
  let created = false;

  if (!userId) {
    const { data, error } = await adminAuth.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME },
    });
    if (error) throw error;
    userId = data.user.id;
    created = true;
  } else {
    const { error: upErr } = await adminAuth.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
    });
    if (upErr) console.warn("User update:", upErr.message);
  }

  if (EXPLORER_NO_ORG) {
    const { error: uErr } = await svc
      .from("users")
      .update({
        org_id: null,
        org_role: "member",
        registration_type: "independent",
        org_member_verified: false,
      })
      .eq("id", userId);
    if (uErr) throw uErr;
  }

  console.log("");
  console.log(created ? "Created confirmed Auth user." : "User already existed; password reset to TEST_USER_PASSWORD.");
  console.log("Email:   ", EMAIL);
  console.log("Password:", PASSWORD);
  console.log(
    EXPLORER_NO_ORG
      ? "Profile: org_id cleared (explorer-style)."
      : "Profile: left as trigger default (domain org)."
  );
  console.log("");
  console.log("In the app: Sign in (not Sign up). In __DEV__, set EXPO_PUBLIC_POOLYN_SIGNUP_OPEN=1 if you need the sign-up UI.");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
