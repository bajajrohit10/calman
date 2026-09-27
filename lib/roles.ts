import type { Database } from "@/types/database";

/**
 * Role vocabulary, safe to import from Client Components.
 *
 * Deliberately separate from lib/auth.ts: that module is `server-only`
 * because it reads cookies, and a client component importing a label from it
 * would drag the whole server module into the browser bundle.
 */
export type Role = Database["public"]["Enums"]["user_role"];

export const ROLES: Role[] = ["super_admin", "manager", "counsellor", "ticket_team"];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  manager: "Manager",
  counsellor: "Counsellor",
  ticket_team: "Ticket Team",
  // §50A. Accounts-only: the remittance module and nothing in counselling.
  accounts: "Accounts",
};

export function isAdmin(role: Role | null | undefined): boolean {
  return role === "super_admin" || role === "manager";
}

/**
 * §58.0. Who may work Support Tickets.
 *
 * The ticket team is the point of the module; managers and super admins see
 * everything. Counsellors do not — support is a different job from selling, and
 * the schema refuses them too (app.is_support()), so a link would only ever
 * lead to an empty screen.
 *
 * Kept beside isAdmin() rather than in lib/auth.ts because the rail is a client
 * component and that module is server-only. It must agree with app.is_support()
 * in the database; hiding a link is presentation, not permission.
 */
export function showsSupport(role: Role | null | undefined): boolean {
  return role === "ticket_team" || role === "manager" || role === "super_admin";
}
