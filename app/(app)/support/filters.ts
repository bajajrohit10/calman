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
  { id: "escalated", label: "Escalated" },
  { id: "future", label: "Future date" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
] as const;

export type SupportTab = (typeof SUPPORT_TABS)[number]["id"];

export const SUPPORT_SOURCES = [
  { id: "form", name: "Form" },
  { id: "mail", name: "Mail" },
  { id: "whatsapp", name: "WhatsApp" },
  { id: "calling_team", name: "Calling team" },
  { id: "counselling", name: "Counselling" },
  { id: "manual", name: "Manual" },
] as const;

/** The status labels, shared by the tabs, the badges and the outcome control. */
export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  working: "Working on it",
  escalated: "Escalated",
  future: "Future date",
  resolved: "Resolved",
};

/** "Nobody" is a real answer to "assigned to whom", so it is an option id. */
export const UNASSIGNED = "nobody";

export const ISSUE_FILTER_OPTIONS = ISSUE_OPTIONS.map((o) => ({ id: o, name: o }));

export type ParamReader = (key: string) => string | null;

const str = (get: ParamReader, key: string) => {
  const v = get(key);
  return v === null || v === "" ? null : v;
};

export type SupportQueueArgs = {
  p_tab: SupportTab;
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
  const opt = (v: string | null) => v ?? undefined;

  return {
    page,
    tab,
    issues,
    assignedTo,
    sources,
    filters: {
      p_tab: tab,
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
      q: str(get, "q") ?? "",
    },
  };
}
