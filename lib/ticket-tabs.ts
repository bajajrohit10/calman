import type { EnquiryStatus } from "@/lib/enquiry-labels";

/**
 * The five states a ticket queue is read in (§33.3, §44.2).
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
export type TicketTabKey =
  | "open"
  | "working"
  | "escalated"
  | "pending_institute"
  | "resolved";

/**
 * §44.2 split the queue five ways. The tab key is the enquiry status it
 * filters on, except "resolved", which is `closed` in the database and
 * Resolved to anybody reading a ticket.
 */
export const TICKET_TABS: {
  key: TicketTabKey;
  label: string;
  dateBound: boolean;
  status: EnquiryStatus;
}[] = [
  { key: "open", label: "Open", dateBound: false, status: "open" },
  { key: "working", label: "Working on it", dateBound: false, status: "working" },
  { key: "escalated", label: "Escalated", dateBound: false, status: "escalated" },
  {
    key: "pending_institute",
    label: "Pending with Institute",
    dateBound: false,
    status: "pending_institute",
  },
  { key: "resolved", label: "Resolved", dateBound: true, status: "closed" },
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

/**
 * §44.5. What an employee's own Tickets tab shows: the two states that are
 * theirs to move. Escalated is somebody else's to move even when it came from
 * them, and Pending with Institute is nobody's until the institute answers.
 */
export const MY_TICKET_STATES: EnquiryStatus[] = ["open", "working"];

export const TICKET_OWNER_ALL = "all";
export const TICKET_OWNER_MINE = "mine";
