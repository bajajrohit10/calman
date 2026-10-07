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
 * §85.2. Who may read a report: every staff role except accounts.
 *
 * This was isAdmin() from §62.1 until §85, on the reasoning that numbers about the
 * team are a management view. That reasoning holds for *managing* the team and not
 * for reading the work — a counsellor who cannot see which teachers convert is being
 * asked to sell without the one report that would tell them what sells.
 *
 * Accounts stays out for the §50E.3 reason: it has no rows in any counselling table,
 * so every one of these screens would be empty by design and read as broken.
 *
 * One rule, three names. The names are what make each route gate readable; the
 * single body is what stops the three drifting apart, which is how §62.1's set ended
 * up meaning two different things in two files.
 */
export function showsReports(role: Role | null | undefined): boolean {
  return Boolean(role) && role !== "accounts";
}

/** §85.2: the Support reports and their CSV export. */
export function showsSupportReports(role: Role | null | undefined): boolean {
  return showsReports(role);
}

/** §85.2: /analytics and its Experiments tab. Writing events stays isAdmin(). */
export function showsAnalytics(role: Role | null | undefined): boolean {
  return showsReports(role);
}
