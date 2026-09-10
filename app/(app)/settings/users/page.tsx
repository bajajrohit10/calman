import { requireAdminProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { UsersTable } from "./users-table";

export const metadata = { title: "Users · Settings · Calman" };

export type UserRow = {
  id: string;
  email: string;
  fullName: string;
  role: "super_admin" | "manager" | "counsellor" | "ticket_team";
  isActive: boolean;
  banned: boolean;
  lastSignInAt: string | null;
  /** An auth user with no profiles row: created outside Calman, or half-made. */
  hasProfile: boolean;
};

export default async function UsersPage() {
  const { profile, userId } = await requireAdminProfile();

  // Email lives in auth.users, which PostgREST does not expose, so the list has
  // to be assembled server-side with the service role. Fine for a team of five;
  // if this ever grows past a page, listUsers() needs paging.
  const admin = createAdminClient();
  const [{ data: authUsers, error: authError }, { data: profiles }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.from("profiles").select("*"),
  ]);

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const users: UserRow[] = (authUsers?.users ?? [])
    .map((u) => {
      const p = byId.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "—",
        fullName: p?.full_name ?? "",
        role: p?.role ?? "counsellor",
        isActive: p?.is_active ?? false,
        // Supabase returns banned_until on the user record; typed loosely
        // because the field is not in the public UserResponse type.
        banned: Boolean((u as { banned_until?: string }).banned_until),
        lastSignInAt: u.last_sign_in_at ?? null,
        hasProfile: Boolean(p),
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.email.localeCompare(b.email));

  return (
    <div className="flex flex-col gap-4">
      {authError ? (
        <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          Could not load accounts: {authError.message}
        </p>
      ) : null}

      <UsersTable
        users={users}
        callerRole={profile.role}
        callerId={userId}
      />
    </div>
  );
}
