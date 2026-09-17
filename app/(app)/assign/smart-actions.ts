"use server";

import { isAdmin, requireUser } from "@/lib/auth";
import { NO_DETAIL_ID, type FacetMap } from "@/lib/facet-shape";
import { loadDeskFacets } from "@/lib/facets";
import { loadTeamDay } from "@/lib/my-day-team";
import { loadRecommended, type RecommendedFilters } from "@/lib/recommended";

import { assignEnquiries } from "./actions";

/**
 * Smart Assign: one selection, six columns (Brief 34).
 *
 * Everything the panel can ask for is a list of chosen option ids per column,
 * plus the two things that are not options — the date, and whether the due
 * date is being ignored. The special ids travel as ids: "__none__" is the
 * option meaning nothing recorded, and "__never__" is nobody has called.
 * Keeping them in the same shape as a teacher id is what lets a column be one
 * loop on the screen and one array on the wire.
 *
 * Every column starts fully selected, and a fully selected column means "no
 * filter" — so what crosses the wire is only ever what somebody has narrowed.
 */
export type SmartSelection = {
  date: string;
  /** Campaign mode: take the whole board, not only what is due today. */
  campaign: boolean;
  content: string[];
  stage: string[];
  importance: string[];
  teacher: string[];
  institute: string[];
  /** §47.6. The seventh column: several sources at once, or none recorded. */
  source: string[];
  lastCalledBy: string[];
};

export type SmartRow = {
  enquiryId: number;
  mobile: string;
  studentName: string | null;
  bucket: string;
  importance: string | null;
  teacherNames: string[] | null;
  dueDate: string | null;
  stage: string | null;
};

export type SmartResult = {
  error: string | null;
  facets?: FacetMap | null;
  facetError?: string | null;
  total?: number;
  preview?: SmartRow[];
};

const PREVIEW = 10;
/** Above this the panel stops offering to assign in one go. */
const MAX_ASSIGN = 500;

/**
 * A column that still has every option ticked is not a filter.
 *
 * The panel cannot know that on its own — it does not hold the full option
 * list for the teacher column, only the ten it is showing — so it sends what
 * is selected and this decides. `all` is the count of options the column
 * offers; when the two match, the column is dropped.
 */
function narrowed(selected: string[], offered: number): string[] | null {
  if (!selected.length) return [];
  if (offered > 0 && selected.length >= offered) return null;
  return selected;
}

function toFilters(sel: SmartSelection, offered: Record<string, number>): RecommendedFilters {
  const pick = (key: keyof typeof offered, chosen: string[]) =>
    narrowed(chosen, offered[key] ?? 0);

  const content = pick("content", sel.content);
  const teacher = pick("teacher", sel.teacher);
  const institute = pick("institute", sel.institute);
  const source = pick("source", sel.source);
  const importance = pick("importance", sel.importance);
  const stage = pick("stage", sel.stage);
  const lastBy = pick("lastCalledBy", sel.lastCalledBy);

  // "Nothing recorded" is a facet name on the wire, not an id in the list.
  const noDetail: string[] = [];
  const strip = (list: string[] | null, facet: string) => {
    if (!list) return null;
    if (list.includes(NO_DETAIL_ID)) noDetail.push(facet);
    return list.filter((v) => v !== NO_DETAIL_ID);
  };

  const teacherIds = strip(teacher, "teacher");
  const instituteIds = strip(institute, "institute");
  const contentIds = strip(content, "content");
  const importanceIds = strip(importance, "importance");
  const sourceIds = strip(source, "source");
  const neverCalled = Boolean(lastBy?.includes("__never__"));
  const lastCalledBy = lastBy?.filter((v) => v !== "__never__") ?? null;

  return {
    date: sel.date,
    // Campaign mode is the desk's own "include not due", said in the words the
    // panel uses: take everything open, not only what today asks for.
    includeNotDue: sel.campaign,
    // The desk's own word for it. "unassigned" is not a value this filter
    // knows, and an unknown value falls through to no filter at all — which
    // silently made the panel count the entire open board, assigned work and
    // all. 'needs' is "nobody has it today, or somebody has it and has already
    // called it", which is what Needs assignment means on the desk.
    assignment: "needs",
    type: "purchase",
    contentIds,
    stages: stage,
    importance: importanceIds,
    teacherIds,
    instituteIds,
    sourceIds,
    lastCalledBy,
    neverCalled,
    noDetail: noDetail.length ? noDetail : null,
  };
}

/**
 * The counts, the total and the first ten rows, for one selection.
 *
 * One call rather than one per column: every click changes every other
 * column's count, so a per-column endpoint would be six round trips for one
 * tick — and the counts would be computed at six slightly different moments,
 * which is how a set of numbers stops adding up.
 */
export async function smartAssignLoad(
  sel: SmartSelection,
  offered: Record<string, number>,
): Promise<SmartResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!isAdmin(viewer.profile.role)) {
    return { error: "Only an admin or manager can assign work." };
  }

  const filters = toFilters(sel, offered);
  const [facetResult, list] = await Promise.all([
    loadDeskFacets(filters),
    loadRecommended({ ...filters, limit: PREVIEW, offset: 0 }),
  ]);

  if (list.error) return { error: list.error };

  // The same drift guard the desk uses: the counts are computed by a second
  // query, and two queries that disagree about the size of the set are two
  // queries somebody should not be reading as one screen.
  const agree =
    facetResult.facets != null && facetResult.facets.total === list.total;

  return {
    error: null,
    facets: agree ? facetResult.facets : null,
    facetError:
      facetResult.error ??
      (facetResult.facets && !agree
        ? `The counts say ${facetResult.facets.total} and the list says ${list.total}. They are not being shown until they agree.`
        : null),
    total: list.total,
    preview: list.rows.map((r) => ({
      enquiryId: r.enquiry_id,
      mobile: r.mobile,
      studentName: r.student_name,
      bucket: r.bucket,
      importance: r.importance,
      teacherNames: r.teacher_names,
      dueDate: r.due_date,
      stage: r.stage,
    })),
  };
}

export type SmartAssignResult = {
  error: string | null;
  ok?: string;
  /** Who got how many, for the toast. */
  split?: { name: string; count: number }[];
};

/**
 * Hand the whole matching set out, to one person or shared round-robin.
 *
 * The rows are re-derived here from the same selection the counts came from,
 * never sent up from the browser: what gets assigned has to be what the total
 * said, and a list of ids that travelled to a browser and back is a list that
 * could have gone stale or been edited.
 *
 * Oldest follow-up first, which is the order the recommended list already
 * returns, so round-robin deals the most overdue work out evenly rather than
 * giving one person the whole backlog.
 */
export async function smartAssign(input: {
  selection: SmartSelection;
  offered: Record<string, number>;
  counsellorIds: string[];
  label: string | null;
}): Promise<SmartAssignResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!isAdmin(viewer.profile.role)) {
    return { error: "Only an admin or manager can assign work." };
  }
  if (!input.counsellorIds.length) return { error: "Choose at least one counsellor." };

  const filters = toFilters(input.selection, input.offered);
  const list = await loadRecommended({ ...filters, limit: MAX_ASSIGN, offset: 0 });
  if (list.error) return { error: list.error };
  if (!list.rows.length) return { error: "Nothing matches this selection." };
  if (list.total > MAX_ASSIGN) {
    return {
      error: `That is ${list.total} leads — more than the ${MAX_ASSIGN} that can be assigned in one go. Narrow the selection first.`,
    };
  }

  // Round-robin in the order the list came back: deal one each, then go round
  // again. Dealing in blocks would give the first counsellor every overdue
  // lead and the last every fresh one.
  const buckets = new Map<string, { enquiryId: number; bucket: "campaign" | string }[]>();
  for (const id of input.counsellorIds) buckets.set(id, []);
  list.rows.forEach((row, i) => {
    const who = input.counsellorIds[i % input.counsellorIds.length];
    buckets.get(who)!.push({
      enquiryId: row.enquiry_id,
      // Campaign mode files everything under one heading with a label; the
      // ordinary modes keep the bucket §6 derived per row.
      bucket: input.selection.campaign ? "campaign" : row.bucket,
    });
  });

  const split: { name: string; count: number }[] = [];
  for (const [counsellorId, rows] of buckets) {
    if (!rows.length) continue;
    const res = await assignEnquiries({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows: rows as any,
      counsellorId,
      date: input.selection.date,
      label: input.selection.campaign ? input.label : null,
    });
    if (res.error) return { error: res.error };
    split.push({ name: counsellorId, count: rows.length });
  }

  const total = split.reduce((n, s) => n + s.count, 0);
  return { error: null, ok: `Assigned ${total}`, split };
}

/**
 * Each counsellor's total pending for a day (§50.2).
 *
 * The session tally answers "what have I handed out just now"; this answers
 * "what are they already carrying". Side by side they are the question a
 * manager is actually asking — a counsellor who has been given twelve today
 * and still has thirty outstanding is not the one to give the next batch to.
 *
 * my_day_team already computes it per counsellor for the whole day, so this is
 * a projection of a function that exists rather than a second count that could
 * disagree with the one My Day shows.
 */
export async function pendingByCounsellor(
  date: string,
): Promise<{ error: string | null; pending?: Record<string, number> }> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!isAdmin(viewer.profile.role)) {
    return { error: "Only an admin or manager can see the team's load." };
  }

  const team = await loadTeamDay(date);
  if (team.error) return { error: team.error };

  const pending: Record<string, number> = {};
  for (const row of team.rows) pending[row.counsellorId] = row.total.pending;
  return { error: null, pending };
}
