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
};

export function isAdmin(role: Role | null | undefined): boolean {
  return role === "super_admin" || role === "manager";
}
