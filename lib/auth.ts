import "server-only";

import { redirect } from "next/navigation";

import { isAdmin } from "@/lib/roles";
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
 * `profile` is null in two different situations that look the same from here,
 * and should: no profile row was ever created, or the row exists with
 * is_active = false. In both cases app.role() returns null, so the RLS policy
 * on profiles denies the read. The database decides who is activated; this
 * function only reports what it said.
 */
export async function getViewer(): Promise<{
  userId: string | null;
  email: string | null;
  profile: Profile | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { userId: null, email: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return { userId: user.id, email: user.email ?? null, profile: profile ?? null };
}

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
