/**
 * One-time bootstrap script for a REAL (hosted) Supabase project.
 *
 * There's no public sign-up in OCRS — every account is created via the
 * `create-user-account` Edge Function, which itself requires an existing
 * admin. This script breaks that chicken-and-egg problem using the
 * service role key directly (never expose that key to the browser).
 *
 * Usage:
 *   1. Supabase Dashboard > Project Settings > API — copy the
 *      "Project URL" and the "service_role" secret key.
 *   2. cd seed && npm install
 *   3. SUPABASE_URL=https://xxxx.supabase.co \
 *      SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *      ADMIN_EMAIL=registrar@slsu.edu.ph \
 *      ADMIN_PASSWORD='ChangeMe123!' \
 *      node seed.js
 *   4. Sign in with that admin account and change the password
 *      immediately (or use "Forgot password?" on the login screen).
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_NAME || "Registrar Administrator";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, and ADMIN_PASSWORD environment variables before running this script.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log(`Creating admin account for ${ADMIN_EMAIL} …`);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD, email_confirm: true,
    user_metadata: { full_name: ADMIN_NAME, role: "admin" },
  });
  if (createErr) throw createErr;

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id, full_name: ADMIN_NAME, email: ADMIN_EMAIL, role: "admin", status: "active",
  });
  if (profileErr) throw profileErr;
  console.log(`✔ Admin account created (uid: ${created.user.id})`);

  console.log("Seeding baseline academic structure …");
  const { data: ayr, error: ayrErr } = await admin.from("academic_years")
    .insert({ year: "2026-2027", is_active: true }).select().single();
  if (ayrErr) throw ayrErr;

  await admin.from("semesters").insert([
    { name: "1st Semester", academic_year_id: ayr.id, is_active: true },
    { name: "2nd Semester", academic_year_id: ayr.id, is_active: false },
  ]);

  await admin.from("subjects").insert([
    { code: "IT101", title: "Introduction to Computing", units: 3, program: "BSIT" },
    { code: "IT102", title: "Computer Programming 1", units: 3, program: "BSIT" },
    { code: "GE101", title: "Purposive Communication", units: 3, program: "All Programs" },
  ]);

  await admin.from("sections").insert([
    { name: "BSIT-1A", program: "BSIT", year_level: "1st Year" },
    { name: "BSIT-1B", program: "BSIT", year_level: "1st Year" },
  ]);

  console.log("✔ Baseline academic structure created.");
  console.log("\nDone. Sign in at your Netlify URL with:");
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: (the one you set via ADMIN_PASSWORD)`);
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
