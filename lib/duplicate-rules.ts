import { formatDate } from "@/lib/format";

/**
 * What a number already is, in one set of words (Brief 31).
 *
 * Quick Add's grid, the import review table and the import report all describe
 * the same five situations, and until now all three described them
 * differently: "Open, never called" on one screen, "Existing — open, not
 * called yet" on the next, "Re-enquired" in the report afterwards. Somebody
 * checking whether the import did what the review promised had to translate.
 *
 * So the sentences live here, once, and every screen reads them from this
 * file. The rules that follow from them live here too, because a label and the
 * thing it causes drifting apart is the same bug wearing a different hat.
 *
 * No "server-only": the grid and the review table are client components, and a
 * second copy of the wording for them is exactly what this replaces.
 */

/**
 * §10.1's six states, as the lookup reports them. These drive the rules; the
 * five cases below are how they are spoken about — `wrong_number` and
 * `resolved` are two states and one sentence, because to somebody typing a
 * list they are the same thing: a call that is over.
 */
export type NumberState =
  | "new"
  | "open_uncalled"
  | "open_called_earlier"
  | "open_called_today"
  | "wrong_number"
  | "resolved";

export type NumberStatus = {
  mobile: string;
  studentId: string | null;
  studentName: string | null;
  state: NumberState;
  openEnquiryId: number | null;
  lastCallAt: string | null;
  lastCallDate: string | null;
  lastCallBy: string | null;
  enquiryCount: number;
  /** When the most recent closed enquiry closed, for case 2. */
  closedOn: string | null;
  closedAs: "won" | "lost" | "wrong_number" | null;
  /** Who holds the open lead today, for case 3. Null means the pool. */
  assignedTo: string | null;
  /**
   * The open after-sale ticket, for case 6 (Brief 33.5). Reported alongside
   * the purchase state rather than instead of it: a number can be a live lead
   * and a live complaint at the same time, and the screen has to say so.
   */
  ticketEnquiryId: number | null;
  ticketStatus: "open" | "escalated" | null;
  ticketNoteBy: string | null;
  ticketNoteOn: string | null;
};

/** The situations, numbered as the briefs number them. */
export type DuplicateCase = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * What happens to a row of each case when it is saved.
 *
 * `new_enquiry`  — cases 1 and 2: nothing is open, so a fresh lead in the pool.
 * `touch`        — case 3: the same enquiry takes the new source and stays
 *                  exactly where it is, in the pool or on somebody's list.
 * `return`       — case 4: the same enquiry, source updated, follow-up cleared,
 *                  re-enquired, and back in the pool for anyone to take.
 * `decide`       — case 5: nothing at all until a person chooses.
 * `ticket`       — case 6: the arrival is logged against the open ticket and
 *                  nothing new is made.
 */
export type DuplicateAction =
  | "new_enquiry"
  | "touch"
  | "return"
  | "decide"
  | "ticket";

export type DuplicateVerdict = {
  case: DuplicateCase;
  /** The sentence. Identical on every screen. */
  label: string;
  /** What saving this row will do, in words, for the row to state. */
  action: string;
  rule: DuplicateAction;
  tone: "ok" | "neutral" | "info" | "warn";
  /** Case 5 only: a person has to choose before anything can be saved. */
  needsDecision: boolean;
};

/** "14:32" — the brief asks for a clock, not "2:32 pm". */
export function istClock(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

const CLOSED_AS: Record<string, string> = {
  won: "Won",
  lost: "Lost",
  wrong_number: "Wrong number",
};

/**
 * Case 6 is not reachable from a state: it is a fact about the other pipeline,
 * decided by what the row is being entered as. Narrowing the return type here
 * is what keeps describeNumber's switch exhaustive.
 */
export function caseOf(state: NumberState): Exclude<DuplicateCase, 6> {
  switch (state) {
    case "new":
      return 1;
    case "resolved":
    case "wrong_number":
      return 2;
    case "open_uncalled":
      return 3;
    case "open_called_earlier":
      return 4;
    case "open_called_today":
      return 5;
  }
}

/** Does this verdict mean "nothing new is created"? */
export function touchesExisting(rule: DuplicateAction): boolean {
  return rule === "touch" || rule === "return" || rule === "ticket";
}

/**
 * The sentence and the rule for one number.
 *
 * Every branch says what it will do as well as what it found, because the
 * whole point of taking the choice away is that the screen owes the reader an
 * account of what it decided on their behalf.
 */
export function describeNumber(
  status: NumberStatus,
  /**
   * What the row is being entered as. Brief 33.5: an after-sale row meets the
   * ticket rules, a purchase row meets the purchase rules, and a number can be
   * in both pipelines at once — so the type is what decides which question is
   * being asked, not which pipeline happens to have something in it.
   */
  type: "purchase" | "after_sale" = "purchase",
): DuplicateVerdict {
  if (type === "after_sale") {
    if (status.ticketEnquiryId) {
      return {
        case: 6,
        label:
          `Open ticket · ${status.ticketStatus === "escalated" ? "Escalated" : "Open"}` +
          (status.ticketNoteBy || status.ticketNoteOn
            ? ` · last note${status.ticketNoteBy ? ` by ${status.ticketNoteBy}` : ""}` +
              (status.ticketNoteOn ? ` on ${formatDate(status.ticketNoteOn)}` : "")
            : " · no notes yet"),
        action: "Added to that ticket; no new enquiry",
        rule: "ticket",
        tone: "info",
        needsDecision: false,
      };
    }
    return {
      case: 1,
      label: "New ticket",
      action: "New after-sale enquiry in Tickets",
      rule: "new_enquiry",
      tone: "ok",
      needsDecision: false,
    };
  }

  const which = caseOf(status.state);

  switch (which) {
    case 1:
      return {
        case: 1,
        label: "New number",
        action: "New enquiry into New Calls",
        rule: "new_enquiry",
        tone: "ok",
        needsDecision: false,
      };

    case 2: {
      const how = status.closedAs ? CLOSED_AS[status.closedAs] : null;
      const parts = ["Closed call"];
      if (status.closedOn) parts.push(formatDate(status.closedOn));
      if (how) parts.push(how);
      return {
        case: 2,
        label: parts.join(" · "),
        action: "New enquiry into New Calls",
        rule: "new_enquiry",
        tone: "neutral",
        needsDecision: false,
      };
    }

    case 3:
      return {
        case: 3,
        label: `Already in New Calls · ${
          status.assignedTo ? `with ${status.assignedTo}` : "Unassigned"
        }`,
        action: status.assignedTo
          ? `Source updated and logged; stays with ${status.assignedTo}`
          : "Source updated and logged; stays in New Calls",
        rule: "touch",
        tone: "info",
        needsDecision: false,
      };

    case 4:
      return {
        case: 4,
        label:
          "Already in follow-up list · last called " +
          formatDate(status.lastCallDate) +
          (status.lastCallBy ? ` by ${status.lastCallBy}` : ""),
        action: "Source updated, follow-up cleared, back into New Calls",
        rule: "return",
        tone: "info",
        needsDecision: false,
      };

    case 5:
      return {
        case: 5,
        label:
          `Call done today${status.lastCallBy ? ` by ${status.lastCallBy}` : ""}` +
          ` at ${istClock(status.lastCallAt)}`,
        action: "Nothing yet — Dismiss, or add to New Calls anyway",
        rule: "decide",
        tone: "warn",
        needsDecision: true,
      };
  }
}

/**
 * The five situations as group headings, where a per-row sentence would be
 * wrong — a heading cannot carry one row's date or one row's caller.
 */
export const CASE_TITLES: Record<DuplicateCase, string> = {
  1: "New number",
  2: "Closed call",
  3: "Already in New Calls",
  4: "Already in follow-up list",
  5: "Call done today",
  6: "Open ticket",
};

/** The confirmation Dismiss asks for, in both places it is offered. */
export function dismissQuestion(mobile: string): string {
  return `Dismiss ${mobile}? The call made today stays as it is.`;
}
