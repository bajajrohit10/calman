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
 * §62.1. Who may work Support Tickets: every staff role except accounts.
 *
 * It was the ticket team's screen alone until Brief 62. A counsellor now ends up
 * here whenever a student rings about an order rather than a purchase, so
 * keeping them out meant the person holding the phone could not see the ticket
 * they were raising.
 *
 * Kept beside isAdmin() rather than in lib/auth.ts because the rail is a client
 * component and that module is server-only. It must agree with app.is_support()
 * in the database; hiding a link is presentation, not permission.
 */
export function showsSupport(role: Role | null | undefined): boolean {
  return (
    role === "counsellor" ||
    role === "ticket_team" ||
    role === "manager" ||
    role === "super_admin"
  );
}

/**
 * §62.1. Who may see the Support reports and the CSV export.
 *
 * Narrower than showsSupport on purpose: the whole team works tickets, but the
 * numbers about the team — resolutions per person per day, average time to
 * resolve — are a management view, and the export is a bulk extract.
 *
 * Deliberately the same set as isAdmin() and written as a call to it, so the two
 * cannot drift; the separate name is what makes the reason readable at each
 * route gate.
 */
export function showsSupportReports(role: Role | null | undefined): boolean {
  return isAdmin(role);
}
