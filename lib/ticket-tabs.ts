/**
 * The three states a ticket queue is read in (§33.3).
 *
 * Shared, and deliberately not the Pending/Done toggle every other list uses.
 * Pending/Done is a question about a day — did we get to this one today — and
 * a ticket does not belong to a day. It is open until somebody closes it, so
 * the states are the ticket's own: waiting, waiting on somebody else, done.
 *
 * Open and Escalated are not bound to the selected date at all. Resolved is,
 * because "what did we finish on Tuesday" is the one ticket question a date
 * can answer.
 */
export type TicketTabKey = "open" | "escalated" | "resolved";

export const TICKET_TABS: { key: TicketTabKey; label: string; dateBound: boolean }[] = [
  { key: "open", label: "Open", dateBound: false },
  { key: "escalated", label: "Escalated", dateBound: false },
  { key: "resolved", label: "Resolved", dateBound: true },
];

export function parseTicketTab(value: string | null | undefined): TicketTabKey {
  const found = TICKET_TABS.find((t) => t.key === value);
  return found ? found.key : "open";
}

/**
 * Who the queue is being read as (§33.7).
 *
 * A ticket is never assigned, so "mine" cannot mean "handed to me". It means
 * the two ways a person ends up responsible for one: they raised it, or they
 * were the last to speak on it.
 */
export type TicketOwner = "all" | "mine" | string;

export const TICKET_OWNER_ALL = "all";
export const TICKET_OWNER_MINE = "mine";
