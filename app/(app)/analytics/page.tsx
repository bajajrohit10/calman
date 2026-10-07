import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { loadMasters } from "@/lib/masters";
import { showsAnalytics } from "@/lib/roles";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";
import { loadAnalytics, loadExperimentResults } from "@/lib/analytics";
import { buildHeads } from "@/lib/analytics-insights";
import {
  RANGE_PRESETS,
  SCOPE_LABELS,
  type Basis,
  type CompareMode,
  type RangePreset,
  type ScopeType,
} from "@/lib/analytics-shape";

import { AnalyticsView } from "./analytics-view";

export const metadata = { title: "Analytics · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

/** Days between two ISO dates, inclusive of both ends. */
function spanDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * §83.3. The range the presets resolve to, in IST.
 *
 * Resolved here rather than in SQL so the dates are in the URL: a manager who
 * sends somebody "the last 30 days" link should have them see the same thirty
 * days tomorrow, not a window that slid.
 */
function resolveRange(preset: RangePreset, sp: Params): { from: string; to: string } {
  const today = istToday();
  if (preset === "custom") {
    const from = one(sp.from) || shift(today, -29);
    const to = one(sp.to) || today;
    // A backwards range is a typo, not a request for no rows.
    return from <= to ? { from, to } : { from: to, to: from };
  }
  if (preset === "today") return { from: today, to: today };
  if (preset === "7") return { from: shift(today, -6), to: today };
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: shift(today, -29), to: today };
}

/**
 * §83. Analytics.
 *
 * Managers and super admins only, and 404 rather than a refusal for anybody else:
 * a counsellor who types the URL should not learn that the page exists. The SQL
 * functions behind it each re-check the same role, so the gate survives somebody
 * calling the RPC directly.
 *
 * Read-only by construction — nothing this route imports writes to a counselling
 * table. The one writer in §83 is Settings → Analytics events, which writes only
 * its own annotations.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireUser();
  // §85.2. Every staff role except accounts. The SQL functions behind the page
  // re-check the same set, so the gate survives somebody calling an RPC directly.
  if (!viewer.profile || !showsAnalytics(viewer.profile.role)) notFound();

  const sp = await searchParams;

  // An explicit from/to in the URL means a custom range, whatever preset says —
  // which is what makes a shared link reproduce its own window.
  const asked = one(sp.preset);
  const preset: RangePreset =
    (RANGE_PRESETS as readonly string[]).includes(asked)
      ? (asked as RangePreset)
      : one(sp.from) || one(sp.to)
        ? "custom"
        : "30";
  const { from, to } = resolveRange(preset, sp);

  const compareAsked = one(sp.compare);
  const compareMode: CompareMode =
    compareAsked === "none" || compareAsked === "custom" ? compareAsked : "previous";

  /** The same length of time immediately before the range. */
  let cmpFrom: string | null = null;
  let cmpTo: string | null = null;
  if (compareMode === "previous") {
    const len = spanDays(from, to);
    cmpTo = shift(from, -1);
    cmpFrom = shift(cmpTo, -(len - 1));
  } else if (compareMode === "custom") {
    cmpFrom = one(sp.cmpFrom) || null;
    cmpTo = one(sp.cmpTo) || null;
    // Half a custom range is no range: comparing against an open end would give
    // deltas nobody asked for.
    if (!cmpFrom || !cmpTo) {
      cmpFrom = null;
      cmpTo = null;
    } else if (cmpFrom > cmpTo) {
      [cmpFrom, cmpTo] = [cmpTo, cmpFrom];
    }
  }

  const filters = {
    from,
    to,
    cmpFrom,
    cmpTo,
    courseId: one(sp.course) || null,
    subjectId: one(sp.subject) || null,
    // §85.1. Comma-joined, the same shape every other multi-select on the site uses.
    sourceIds: (one(sp.source) || "").split(",").map((v) => v.trim()).filter(Boolean),
    counsellorId: one(sp.counsellor) || null,
    termId: one(sp.term) || null,
    // §84.4. The scope is a filter like any other, and an id without a shape — or a
    // shape without an id — narrows nothing rather than narrowing wrongly.
    scopeType: ((Object.keys(SCOPE_LABELS) as ScopeType[]).find(
      (k) => k === one(sp.scopeType),
    ) ?? "all") as ScopeType,
    scopeId: one(sp.scopeId) || null,
  };
  if (filters.scopeType === "all" || !filters.scopeId) {
    filters.scopeType = "all";
    filters.scopeId = null;
  }

  const supabase = await createClient();
  const [masters, data, staff] = await Promise.all([
    loadMasters(),
    loadAnalytics(filters),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  // The query string that reproduces this view, for the insight links and every
  // toggle. Built here so a card's link is the same string whichever tab made it.
  const query = new URLSearchParams();
  query.set("preset", preset);
  query.set("from", from);
  query.set("to", to);
  query.set("compare", compareMode);
  if (cmpFrom && compareMode === "custom") query.set("cmpFrom", cmpFrom);
  if (cmpTo && compareMode === "custom") query.set("cmpTo", cmpTo);
  if (filters.courseId) query.set("course", filters.courseId);
  if (filters.subjectId) query.set("subject", filters.subjectId);
  if (filters.sourceIds.length) query.set("source", filters.sourceIds.join(","));
  if (filters.counsellorId) query.set("counsellor", filters.counsellorId);
  if (filters.termId) query.set("term", filters.termId);
  if (filters.scopeType !== "all" && filters.scopeId) {
    query.set("scopeType", filters.scopeType);
    query.set("scopeId", filters.scopeId);
  }

  const heads = data.scope
    ? buildHeads({
        scope: data.scope,
        teachers: data.teachers,
        courses: data.courses,
        query: query.toString(),
      })
    : null;

  const tab =
    one(sp.tab) === "products"
      ? "products"
      : one(sp.tab) === "experiments"
        ? "experiments"
        : "teachers";

  // §84.3. Only the tab that shows them pays for them: four windows per experiment
  // is four reads, and the other two tabs have no use for any of it.
  const results =
    tab === "experiments"
      ? (await loadExperimentResults(data.experiments.map((e) => e.id))).results
      : [];

  logServerTiming("/analytics");

  const basis: Basis =
    (["closed", "open", "total"] as const).find((b) => b === one(sp.basis)) ?? "closed";

  return (
    <AnalyticsView
      filters={filters}
      preset={preset}
      compareMode={compareMode}
      query={query.toString()}
      tab={tab}
      by={one(sp.by) === "institute" ? "institute" : "teacher"}
      basis={basis}
      error={data.error}
      scope={data.scope ?? null}
      teachers={data.teachers}
      institutes={data.institutes}
      courses={data.courses}
      products={data.products}
      events={data.events}
      experiments={data.experiments}
      results={results}
      heads={heads}
      timings={data.timings}
      masters={{
        courses: masters.courses,
        subjects: masters.subjects,
        sources: masters.sources,
        terms: masters.terms,
        teachers: masters.teachers,
        institutes: masters.institutes,
      }}
      staff={(staff.data ?? []) as { id: string; full_name: string | null }[]}
    />
  );
}
