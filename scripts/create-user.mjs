#!/usr/bin/env node
// Create a Calman login: the auth user and its profiles row, in one go.
//
// There is no self-signup (spec §8) and no SMTP on this project, so accounts
// are made here or in Settings → Users. Both paths use the service role key,
// which bypasses RLS — so this script only ever runs on a trusted machine.
//
//   node scripts/create-user.mjs <email> <password> <full name> <role>
//
// Roles: super_admin | manager | counsellor | ticket_team
//
// The very first Super Admin has to come from here, because Settings → Users
// requires an admin to already exist.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ROLES = ["super_admin", "manager", "counsellor", "ticket_team"];

function usage(problem) {
  if (problem) console.error(`\n  Error: ${problem}`);
  console.error(`
  Create a Calman login.

  Usage:
    node scripts/create-user.mjs <email> <password> <full name> <role> [--update]

  Arguments:
    email       Sign-in address. Must be unique.
    password    At least 6 characters (Supabase's default minimum).
    full name   Shown in the UI. Quote it if it contains spaces.
    role        One of: ${ROLES.join(" | ")}

  Options:
    --update    The email already exists: reset its password and update the
                name and role instead of failing.

  Examples:
    node scripts/create-user.mjs rohit@zeroinfy.in 'S3cret!' 'Rohit Bajaj' super_admin
    node scripts/create-user.mjs asha@zeroinfy.in 'N3wpass!' 'Asha' counsellor --update

  Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
`);
  process.exit(problem ? 1 : 0);
}

// Minimal .env.local reader so the script runs as plain `node script.mjs`
// without requiring --env-file. Real environment variables win.
function loadEnv(file = ".env.local") {
  let text = "";
  try {
    text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "").trim();
  }
}

const args = process.argv.slice(2);
const update = args.includes("--update");
const [email, password, fullName, role] = args.filter((a) => a !== "--update");

if (args.includes("--help") || args.includes("-h")) usage();
if (!email || !password || !fullName || !role) {
  usage("email, password, full name and role are all required");
}
if (!ROLES.includes(role)) usage(`unknown role "${role}"`);
if (!email.includes("@")) usage(`"${email}" does not look like an email address`);
if (password.length < 6) usage("password must be at least 6 characters");

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  usage("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findByEmail(address) {
  // listUsers is paginated; a counselling team is small, but page anyway
  // rather than assume everyone fits in the first 50.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email?.toLowerCase() === address.toLowerCase(),
    );
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  const existing = await findByEmail(email);

  if (existing && !update) {
    console.error(
      `\n  ${email} already exists (id ${existing.id}).` +
        `\n  Re-run with --update to reset the password and update the name and role.\n`,
    );
    process.exit(1);
  }

  let userId;

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updating auth user: ${error.message}`);
    userId = existing.id;
  } else {
    // email_confirm: true is what makes this work without SMTP. Without it the
    // account is created unconfirmed, no confirmation mail can be sent, and
    // the user is locked out at sign-in.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`creating auth user: ${error.message}`);
    userId = data.user.id;
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      { id: userId, full_name: fullName, role, is_active: true },
      { onConflict: "id" },
    );

  if (profileError) {
    // Never leave an auth user with no profile: they could sign in and land in
    // a shell where every RLS policy denies them. Undo the half-made account —
    // but only if this run created it.
    if (!existing) {
      await admin.auth.admin.deleteUser(userId);
      throw new Error(
        `creating profile: ${profileError.message} (auth user rolled back)`,
      );
    }
    throw new Error(`updating profile: ${profileError.message}`);
  }

  console.log(`
  ${existing ? "Updated" : "Created"} ${role} — ${fullName}
    email  ${email}
    id     ${userId}

  They can sign in immediately. No email was sent; none is needed.
`);
}

main().catch((error) => {
  console.error(`\n  Failed: ${error.message}\n`);
  process.exit(1);
});
