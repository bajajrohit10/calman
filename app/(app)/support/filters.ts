import { ISSUE_OPTIONS } from "@/lib/support/normalise";

/**
 * §58.4. The support queue's filter bar, parsed once.
 *
 * Same shape and the same query-string habits as the counselling screens — a
 * comma-joined multi value, a `page` that is 1-based, and undefined rather than
 * null for "not filtering" so the values can be spread straight into an RPC
 * call.
 */
export const PAGE_SIZE = 50;

/** The six tabs, in the order they are worked. */
export const SUPPORT_TABS = [
  { id: "new", label: "New" },
  { id: "working", label: "Working on it" },
  // §64.2. Counselling's own work in progress, between Working and Escalated.
  // Working excludes these, so the six tabs still sum to All.
  { id: "counsellor", label: "Counsellor" },
  { id: "escalated", label: "Escalated" },
  { id: "future", label: "Future date" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
] as const;

export type SupportTab = (typeof SUPPORT_TABS)[number]["id"];

/**
 * Every source a ticket can have, in the order they are offered.
 *
 * 'form' and 'counselling' are never offered on the New-ticket form — the
 * webhook owns one and §62.2 owns the other — but both appear here because the
 * filter and the queue column have to be able to name them.
 */
export const SUPPORT_SOURCES = [
  { id: "form", name: "Form" },
  { id: "mail", name: "Mail" },
  { id: "whatsapp", name: "WhatsApp" },
  { id: "calling_team", name: "Calling team" },
  { id: "counselling", name: "Counselling" },
  { id: "manual", name: "Manual" },
] as const;

/**
 * §62.3. The label for each source, keyed by the stored value.
 *
 * Built from SUPPORT_SOURCES rather than written out again: the queue column,
 * the filter and the ticket header all read these names, and a second copy is
 * how "Calling team" becomes "Calling Team" on one screen only.
 */
export const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SUPPORT_SOURCES.map((s) => [s.id, s.name]),
);

/** The status labels, shared by the tabs, the badges and the outcome control. */
export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  working: "Working on it",
  counsellor: "Counsellor (working)",
  escalated: "Escalated",
  future: "Future date",
  resolved: "Resolved",
};

/** "Nobody" is a real answer to "assigned to whom", so it is an option id. */
export const UNASSIGNED = "nobody";

/** §63.2. The ageing bands, and the roll-up shown beside them. */
export const AGE_BANDS = ["0-3", "4-5", "6-10", "over-10", "over-3"] as const;
export const AGE_BAND_LABELS: Record<string, string> = {
  "0-3": "0–3 days",
  "4-5": "4–5 days",
  "6-10": "6–10 days",
  "over-10": "over 10 days",
  "over-3": "over 3 days",
};

/** §63.2. When a ticket is next due. */
export const DUE_BUCKETS = ["overdue", "today", "future", "none"] as const;
export const DUE_LABELS: Record<string, string> = {
  overdue: "Overdue",
  today: "Due today",
  future: "Future",
  none: "No date",
};

/** §61.2. The two kinds of escalation, as chips on the Escalated tab. */
export const ESCALATION_KINDS = [
  { id: "team", label: "Team" },
  { id: "institute", label: "Institute" },
] as const;

export const ESCALATION_KIND_LABELS: Record<string, string> = {
  team: "Team member",
  institute: "Institute",
};

export const ISSUE_FILTER_OPTIONS = ISSUE_OPTIONS.map((o) => ({ id: o, name: o }));

export type ParamReader = (key: string) => string | null;

const str = (get: ParamReader, key: string) => {
  const v = get(key);
  return v === null || v === "" ? null : v;
};

/** The five real statuses, for the `status` query param. */
export const TICKET_STATUSES = ["new", "working", "escalated", "future", "resolved"] as const;

/** Everything that is not resolved — what "open" means everywhere in Support. */
export const OPEN_STATUSES = ["new", "working", "escalated", "future"] as const;

export type SupportQueueArgs = {
  p_tab: SupportTab;
  /**
   * §61.3. An explicit status list, which is how the reports link through to
   * "all open tickets". There is deliberately no `open` tab: the six tabs are
   * fixed, and an unrecognised tab value falls back to New — which is exactly
   * the bug this replaced, a report card claiming 24 and its own link showing 21.
   */
  p_statuses: string[] | undefined;
  /** §61.2: narrows the Escalated tab only. */
  p_escalation_kinds: string[] | undefined;
  /** §61.3: the reports link through with a raised-date window. */
  p_raised_from: string | undefined;
  p_raised_to: string | undefined;
  /** §63.2: an ageing band, from the reports. */
  p_age_band: string | undefined;
  /** §63.2: overdue | today | future | none, from the reports. */
  p_due: string | undefined;
  p_institute_id: string | undefined;
  p_teacher_id: string | undefined;
  p_issues: string[] | undefined;
  p_follow_from: string | undefined;
  p_follow_to: string | undefined;
  p_assigned_to: string[] | undefined;
  p_sources: string[] | undefined;
  p_search: string | undefined;
};

function isTab(v: string | null): v is SupportTab {
  return SUPPORT_TABS.some((t) => t.id === v);
}

export function parseSupportParams(get: ParamReader): {
  page: number;
  tab: SupportTab;
  issues: string[];
  assignedTo: string[];
  sources: string[];
  escalationKinds: string[];
  statuses: string[];
  filters: SupportQueueArgs;
  selected: Record<string, string>;
} {
  const page = Math.max(1, Number(str(get, "page") ?? 1) || 1);
  const many = (key: string) =>
    (str(get, key) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  const asked = str(get, "tab");
  // Anything unrecognised is the working default rather than an error: a stale
  // or hand-edited link should land somewhere useful.
  const tab: SupportTab = isTab(asked) ? asked : "new";

  const issues = many("issue");
  const assignedTo = many("assignedTo");
  const sources = many("source");
  // Anything not one of the two is dropped rather than passed on, so a stale
  // link cannot ask the function for a kind that does not exist.
  const escalationKinds = many("kind").filter((k) =>
    ESCALATION_KINDS.some((e) => e.id === k),
  );
  const statuses = many("status").filter((v) =>
    (TICKET_STATUSES as readonly string[]).includes(v),
  );
  const opt = (v: string | null) => v ?? undefined;

  return {
    page,
    tab,
    issues,
    assignedTo,
    sources,
    escalationKinds,
    statuses,
    filters: {
      p_tab: tab,
      p_statuses: statuses.length ? statuses : undefined,
      p_escalation_kinds: escalationKinds.length ? escalationKinds : undefined,
      p_raised_from: opt(str(get, "raisedFrom")),
      p_raised_to: opt(str(get, "raisedTo")),
      p_age_band: AGE_BANDS.includes(str(get, "age") as never)
        ? (str(get, "age") as string)
        : undefined,
      p_due: DUE_BUCKETS.includes(str(get, "due") as never)
        ? (str(get, "due") as string)
        : undefined,
      p_institute_id: opt(str(get, "institute")),
      p_teacher_id: opt(str(get, "teacher")),
      p_issues: issues.length ? issues : undefined,
      p_follow_from: opt(str(get, "followFrom")),
      p_follow_to: opt(str(get, "followTo")),
      p_assigned_to: assignedTo.length ? assignedTo : undefined,
      p_sources: sources.length ? sources : undefined,
      p_search: opt(str(get, "q")),
    },
    selected: {
      institute: str(get, "institute") ?? "",
      teacher: str(get, "teacher") ?? "",
      followFrom: str(get, "followFrom") ?? "",
      followTo: str(get, "followTo") ?? "",
      raisedFrom: str(get, "raisedFrom") ?? "",
      raisedTo: str(get, "raisedTo") ?? "",
      q: str(get, "q") ?? "",
    },
  };
}
