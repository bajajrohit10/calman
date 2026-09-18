import { PageHeader } from "@/components/ui";
import { loadEscalatees } from "@/lib/escalatees";
import { facetsAgreeWithList, loadEnquiriesCalledByFacets } from "@/lib/facets";
import { requireUser } from "@/lib/auth";
import { loadEnquiries } from "@/lib/enquiries";
import { loadMasters } from "@/lib/masters";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import { PAGE_SIZE, parseEnquiriesParams } from "../assign/filters";
import { EnquiriesTable } from "./enquiries-table";

export const metadata = { title: "Enquiries · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

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

/** §5.6. Every enquiry, every role — no admin gate. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const { page, sort, dir, range, calledBy, filters } = parseEnquiriesParams(
    read(sp),
    viewer.userId && viewer.profile
      ? { id: viewer.userId, role: viewer.profile.role }
      : null,
  );
  const includeArchived = filters.includeArchived ?? false;

  // Passed down rather than read from window.location during render: on the
  // server that is empty, so the sort links hydrated with the filters missing
  // — and a click landing before hydration would have dropped them.
  // Every value of a repeated key, not the first: a multi-select posts its
  // name once per selection, and keeping only the first meant clicking a sort
  // header or Next quietly dropped all but one teacher, content or caller.
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null
        ? []
        : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string]),
    ),
  ).toString();

  const supabase = await createClient();

  const masters = await loadMasters();
  // §45.3: every active user, for the escalate-to picker in the call window.
  const escalatees = await loadEscalatees();
  const [list, staff, callers, facetResult] =
    await Promise.all([
      loadEnquiries(filters),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
      // §7.2. The people who make calls, which is not the same list as the
      // people who have logins: accounts never rings anybody, so offering the
      // name would be offering a filter that is always empty.
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .in("role", ["counsellor", "manager", "ticket_team", "super_admin"])
        .order("full_name"),
      loadEnquiriesCalledByFacets(filters),
    ]);


  // One line per render, so the phase breakdown is in the server log.
  logServerTiming("/enquiries");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Enquiries"
        description="Every enquiry in Calman, however it ended."
      />
      <EnquiriesTable
        escalatees={escalatees}
        rows={list.rows}
        total={list.total}
        includeArchived={includeArchived}
        error={list.error}
        page={page}
        pageSize={PAGE_SIZE}
        sort={sort}
        range={range}
        dir={dir}
        search={search}
        counsellorName={viewer.profile?.full_name ?? null}
        calledBy={{
          roster: (callers.data ?? []).map((p) => ({
            id: p.id,
            name: p.full_name ?? "(no name)",
          })),
          values: calledBy,
        }}
        // §5.5's guard, on the one facet this screen has: counts that no
        // longer agree with the list are not shown at all.
        facets={facetsAgreeWithList(facetResult.facets, list.total) ?? undefined}
        facetError={
          facetResult.error ??
          (facetResult.facets && facetResult.facets.total !== list.total
            ? "The filter counts disagreed with the list, so they are hidden."
            : null)
        }
        roster={(staff.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
        multi={{
          teacher: filters.teacherIds ?? [],
          content: filters.contentIds ?? [],
          stage: filters.stages ?? [],
          importance: filters.importance ?? [],
        }}
        masters={{
          teachers: masters.teachers,
          institutes: masters.institutes,
          courses: masters.courses,
          subjects: masters.subjects,
          contents: masters.contents,
          terms: masters.terms,
          sources: masters.sources,
        }}
        panelMasters={{
          teachers: masters.teachers,
          courses: masters.courses,
          subjects: masters.subjects,
          contents: masters.contents,
          terms: masters.terms,
          sources: masters.sources,
        }}
        selected={{
          counsellor: one(sp.counsellor) ?? "",
          teacher: one(sp.teacher) ?? "",
          course: one(sp.course) ?? "",
          subject: one(sp.subject) ?? "",
          content: one(sp.content) ?? "",
          term: one(sp.term) ?? "",
          source: one(sp.source) ?? "",
          importance: one(sp.importance) ?? "",
          type: one(sp.type) ?? "",
          status: one(sp.status) ?? "",
          lostReason: one(sp.lostReason) ?? "",
          closeReason: one(sp.closeReason) ?? "",
          mobile: one(sp.mobile) ?? "",
          // §50.1. The boxes show the window that is actually in force, not
          // the raw query string — otherwise the default view filters to today
          // while the two date fields sit empty, which reads as a bug.
          createdFrom: filters.createdFrom ?? "",
          createdTo: filters.createdTo ?? "",
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
