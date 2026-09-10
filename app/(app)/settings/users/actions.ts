"use server";

import { revalidatePath } from "next/cache";

import { ROLES, isAdmin, type Role } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null; ok?: string };

/**
 * Every action below runs with the service role, which bypasses RLS entirely.
 * So the caller's own authority is established here, from their cookie
 * session, before any privileged client is created. A server action is a
 * public HTTP endpoint: the fact that the UI hid the button proves nothing.
 *
 * Returns the caller's role, or a reason to refuse.
 */
async function authorise(): Promise<
  { role: Role; userId: string; error: null } | { role: null; userId: null; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { role: null, userId: null, error: "Not signed in." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !isAdmin(profile.role)) {
    return {
      role: null,
      userId: null,
      error: "You do not have permission to manage users.",
    };
  }

  return { role: profile.role, userId: user.id, error: null };
}

/**
 * A Manager may not create or touch a Super Admin (brief item 3). Checked
 * against the target's *current* role and the role being assigned, so a
 * manager can neither promote someone into super_admin nor edit one.
 */
function refusesSuperAdmin(
  callerRole: Role,
  targetRole: Role | null,
  nextRole?: Role,
): string | null {
  if (callerRole === "super_admin") return null;
  if (targetRole === "super_admin" || nextRole === "super_admin") {
    return "Only a Super Admin can create or change a Super Admin account.";
  }
  return null;
}

async function targetRoleOf(userId: string): Promise<Role | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role ?? null;
}

export async function createUser(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorise();
  if (auth.error !== null) return { error: auth.error };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "") as Role;

  if (!email || !password || !fullName || !role) {
    return { error: "Email, password, name and role are all required." };
  }
  if (!ROLES.includes(role)) return { error: "Unknown role." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };

  const refusal = refusesSuperAdmin(auth.role, null, role);
  if (refusal) return { error: refusal };

  const admin = createAdminClient();

  // email_confirm: true is what makes this work with no SMTP on the project.
  // Without it the account is created unconfirmed, no confirmation mail can be
  // sent, and the person is locked out at sign-in.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) return { error: `Could not create the account: ${error.message}` };

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: data.user.id, full_name: fullName, role, is_active: true });

  if (profileError) {
    // Never leave an auth user without a profile: they could sign in and land
    // in a shell where every policy denies them.
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: `Could not create the profile: ${profileError.message}` };
  }

  revalidatePath("/settings/users");
  return { error: null, ok: `${fullName} can sign in now.` };
}

export async function changeRole(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorise();
  if (auth.error !== null) return { error: auth.error };

  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!userId || !ROLES.includes(role)) return { error: "Unknown user or role." };

  const currentRole = await targetRoleOf(userId);
  const refusal = refusesSuperAdmin(auth.role, currentRole, role);
  if (refusal) return { error: refusal };

  // A Super Admin demoting themselves could leave the project with no admin
  // and no way back except the command-line script.
  if (userId === auth.userId && !isAdmin(role)) {
    return { error: "You cannot remove your own admin access." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return { error: null, ok: "Role updated." };
}

export async function setActive(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorise();
  if (auth.error !== null) return { error: auth.error };

  const userId = String(formData.get("user_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!userId) return { error: "Unknown user." };

  const currentRole = await targetRoleOf(userId);
  const refusal = refusesSuperAdmin(auth.role, currentRole);
  if (refusal) return { error: refusal };

  if (userId === auth.userId && !active) {
    return { error: "You cannot deactivate your own account." };
  }

  const admin = createAdminClient();

  // Two layers, because they fail differently. profiles.is_active is what
  // app.role() reads, so flipping it denies every RLS policy on the next
  // request — immediate, even for someone already signed in. ban_duration
  // stops them obtaining a *new* session at all. Neither alone is enough:
  // a ban leaves an existing access token working until it expires, and
  // is_active alone would still let them sign in to an empty shell.
  const { error } = await admin
    .from("profiles")
    .update({ is_active: active })
    .eq("id", userId);
  if (error) return { error: error.message };

  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) return { error: `Profile updated, but sign-in block failed: ${banError.message}` };

  revalidatePath("/settings/users");
  return { error: null, ok: active ? "Account reactivated." : "Account deactivated." };
}

export async function resetPassword(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorise();
  if (auth.error !== null) return { error: auth.error };

  const userId = String(formData.get("user_id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId) return { error: "Unknown user." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };

  const currentRole = await targetRoleOf(userId);
  const refusal = refusesSuperAdmin(auth.role, currentRole);
  if (refusal) return { error: refusal };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return {
    error: null,
    // Measured, not assumed: the reset revokes refresh tokens immediately, but
    // an access token already issued keeps working until it expires.
    ok: "Password set. Tell them the new password directly — no email is sent.",
  };
}
