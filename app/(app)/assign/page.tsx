import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { facetsAgreeWithList, loadDeskFacets } from "@/lib/facets";
import { loadRecommended } from "@/lib/recommended";
import { loadMasters } from "@/lib/masters";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import { AssignDesk } from "./assign-desk";
import { PAGE_SIZE, parseDeskParams } from "./filters";

export const metadata = { title: "Assignment Desk · Calman" };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || null;

/**
 * A native multi-select submits its values as repeated keys; a hand-built or
 * pasted link may comma-join them. Both shapes reach the parsers as one
 * comma-joined string, which is what the array filters expect — the old reader
 * took the first value and silently dropped the rest.
 */
const read = (sp: Params) => (k: string): string | null => {
  const v = sp[k];
  if (Array.isArray(v)) return v.length ? v.join(",") : null;
  return v ?? null;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAdminProfile();
  const sp = await searchParams;

  const { date, page, includeNotDue, filters } = parseDeskParams(read(sp));

  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]],
    ),
  ).toString();

  const supabase = await createClient();

  const masters = await loadMasters();
  // The facet counts are a second query over the same scope, issued alongside
  // the list rather than after it, so the page waits for the slower of the two
  // and not for their sum.
  const [list, facetResult, staff] =
    await Promise.all([
      loadRecommended(filters),
      loadDeskFacets(filters),
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("is_active", true)
        .neq("role", "ticket_team")
        .order("full_name"),
    ]);

  // Counted per counsellor by the database. Fetching the day's assignment rows
  // and tallying them in JS was wrong above a thousand rows on a busy day, and
  // wrong without saying so — an exact head count cannot truncate.
  const roster = await Promise.all(
    (staff.data ?? []).map(async (p) => {
      const { count } = await supabase
        .from("assignments")
        .select("*", { count: "exact", head: true })
        .eq("date", date)
        .eq("counsellor_id", p.id);
      return {
        id: p.id,
        name: p.full_name ?? "(no name)",
        role: p.role,
        count: count ?? 0,
      };
    }),
  );


  // One line per render, so the phase breakdown is in the server log.
  logServerTiming("/assign");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Assignment Desk"
        description="The recommended list for one day, and who is going to call it."
      />
      <AssignDesk
        rows={list.rows}
        total={list.total}
        error={list.error}
        facets={facetsAgreeWithList(facetResult.facets, list.total) ?? undefined}
        facetError={
          facetResult.error ??
          (facetResult.facets && facetResult.facets.total !== list.total
            ? "Filter counts are out of step with the list and are not being shown."
            : null)
        }
        date={date}
        page={page}
        pageSize={PAGE_SIZE}
        includeNotDue={includeNotDue}
        search={search}
        roster={roster}
        masters={{
          teachers: masters.teachers,
          institutes: masters.institutes,
          courses: masters.courses,
          subjects: masters.subjects,
          contents: masters.contents,
          terms: masters.terms,
          sources: masters.sources,
        }}
        multi={{
          teacher: filters.teacherIds ?? [],
          content: filters.contentIds ?? [],
          stage: filters.stages ?? [],
        }}
        selected={{
          counsellor: one(sp.counsellor) ?? "",
          teacher: one(sp.teacher) ?? "",
          institute: one(sp.institute) ?? "",
          course: one(sp.course) ?? "",
          subject: one(sp.subject) ?? "",
          content: one(sp.content) ?? "",
          term: one(sp.term) ?? "",
          source: one(sp.source) ?? "",
          importance: one(sp.importance) ?? "",
          type: one(sp.type) ?? "",
          status: one(sp.status) ?? "",
          createdFrom: one(sp.createdFrom) ?? "",
          createdTo: one(sp.createdTo) ?? "",
          followUpFrom: one(sp.followUpFrom) ?? "",
          followUpTo: one(sp.followUpTo) ?? "",
          q: one(sp.q) ?? "",
          lastCalledFrom: one(sp.lastCalledFrom) ?? "",
          lastCalledTo: one(sp.lastCalledTo) ?? "",
        }}
      />
    </div>
  );
}
