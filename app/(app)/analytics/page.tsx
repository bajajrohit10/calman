import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { loadMasters } from "@/lib/masters";
import { isAdmin } from "@/lib/roles";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";
import { loadAnalytics } from "@/lib/analytics";
import { buildInsights } from "@/lib/analytics-insights";

import { AnalyticsView } from "./analytics-view";

export const metadata = { title: "Analytics · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

/**
 * §81. Analytics.
 *
 * Managers and super admins only, and 404 rather than a refusal for anybody
 * else: a counsellor who types the URL should not learn that the page exists.
 * The five SQL functions behind it each re-check the same role, so the gate
 * survives somebody calling the RPC directly.
 *
 * Read-only by construction — there is no action in this route and nothing it
 * imports writes to a counselling table.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) notFound();

  const sp = await searchParams;

  /**
   * Default: the last 30 days, in IST.
   *
   * Thirty rather than this month, because every rate on this page wants a
   * stable denominator and a month-to-date window shrinks to nothing on the
   * first of the month — which is exactly when somebody opens a report.
   */
  const today = istToday();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  const defaultFrom = d.toISOString().slice(0, 10);

  const filters = {
    from: one(sp.from) || defaultFrom,
    to: one(sp.to) || today,
    courseId: one(sp.course) || null,
    subjectId: one(sp.subject) || null,
    sourceId: one(sp.source) || null,
    counsellorId: one(sp.counsellor) || null,
  };

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

  // The query string that reproduces this view, for the insight links and the
  // tab switches. Built here rather than in the client so a card's link is the
  // same string whichever tab rendered it.
  const query = new URLSearchParams();
  query.set("from", filters.from);
  query.set("to", filters.to);
  if (filters.courseId) query.set("course", filters.courseId);
  if (filters.subjectId) query.set("subject", filters.subjectId);
  if (filters.sourceId) query.set("source", filters.sourceId);
  if (filters.counsellorId) query.set("counsellor", filters.counsellorId);

  const insights = data.scope
    ? buildInsights({
        scope: data.scope,
        teachers: data.teachers,
        institutes: data.institutes,
        pivot: data.pivot,
        query: query.toString(),
      })
    : [];

  logServerTiming("/analytics");

  return (
    <AnalyticsView
      filters={filters}
      query={query.toString()}
      tab={one(sp.tab) === "products" ? "products" : "teachers"}
      by={one(sp.by) === "institute" ? "institute" : "teacher"}
      metric={
        (["enquiries", "purchased", "revenue", "conversion"] as const).find(
          (m) => m === one(sp.metric),
        ) ?? "enquiries"
      }
      institute={one(sp.institute) || null}
      error={data.error}
      scope={data.scope ?? null}
      teachers={data.teachers}
      institutes={data.institutes}
      pivot={data.pivot}
      products={data.products}
      insights={insights}
      timings={data.timings}
      masters={{
        courses: masters.courses,
        subjects: masters.subjects,
        sources: masters.sources,
      }}
      staff={(staff.data ?? []) as { id: string; full_name: string | null }[]}
    />
  );
}
