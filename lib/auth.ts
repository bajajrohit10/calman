import "server-only";

import { cache } from "react";

import { redirect } from "next/navigation";

import { isAdmin } from "@/lib/roles";
import { timed } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Re-exported so server modules have one import for both halves. Client
// components must import these from "@/lib/roles" instead.
export { ROLES, ROLE_LABELS, isAdmin } from "@/lib/roles";
export type { Role } from "@/lib/roles";

/**
 * The signed-in user and their profile.
 *
 * Wrapped in React's cache(): the layout asks for the viewer and then so does
 * the page. cache() dedupes it within one request; across requests nothing is
 * retained, so a deactivated account still loses access on its next
 * navigation.
 *
 * One network round trip, not two. This used to call auth.getUser(), which
 * asks the Supabase auth server to validate the JWT, and then read the profile
 * — two crossings to a database that Brief 15 found was on another continent.
 * getClaims() verifies the same token locally with WebCrypto against the
 * project's public signing key, because this project signs with ES256 and the
 * token carries a kid. It is the same verification, done here instead of over
 * the wire: a forged or tampered token fails the signature check and never
 * reaches the profile read.
 *
 * The key set is fetched once per server instance and cached in module memory
 * by auth-js, so only the first request after a cold start pays for it. If the
 * project ever moves back to a shared-secret HS256 key, getClaims() falls back
 * to getUser() on its own — correct, just slower, which is the right way round.
 *
 * `profile` is null in two different situations that look the same from here,
 * and should: no profile row was ever created, or the row exists with
 * is_active = false. In both cases app.role() returns null, so the RLS policy
 * on profiles denies the read. The database decides who is activated; this
 * function only reports what it said.
 */
export const getViewer = cache(async function getViewer(): Promise<{
  userId: string | null;
  email: string | null;
  profile: Profile | null;
}> {
  const supabase = await createClient();

  const { data, error } = await timed("auth", () => supabase.auth.getClaims());
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (error || !userId) return { userId: null, email: null, profile: null };

  const { data: profile } = await timed("profile", () =>
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
  );

  const email = typeof claims?.email === "string" ? claims.email : null;
  return { userId, email, profile: profile ?? null };
});

/** For pages behind the app shell. Sends anonymous visitors to the login page. */
export async function requireUser() {
  const viewer = await getViewer();
  if (!viewer.userId) redirect("/login");
  return viewer;
}

/**
 * For Settings and every server action that writes on someone's behalf.
 * Server actions are public HTTP endpoints, so this is checked there too and
 * never inferred from the fact that the UI hid a button.
 */
export async function requireAdminProfile(): Promise<{
  userId: string;
  profile: Profile;
}> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    redirect("/my-day");
  }
  return { userId: viewer.userId!, profile: viewer.profile };
}
