import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { facetsAgreeWithList, loadNewCallsFacets } from "@/lib/facets";
import { loadMasters } from "@/lib/masters";
import { createClient } from "@/lib/supabase/server";

import { PAGE_SIZE, parseNewCallsParams } from "./filters";
import { NewCallsBoard, type PoolRow } from "./new-calls-board";

export const metadata = { title: "New Calls · Calman" };

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

/** §5.12. The unclaimed pool — all roles; anyone who calls can take work. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireUser();
  const sp = await searchParams;
  const { page, sourceIds, teacherIds, contentIds, filters } = parseNewCallsParams(read(sp));

  const supabase = await createClient();

  const masters = await loadMasters();
  const [list, facetResult] =
    await Promise.all([
      supabase.rpc("new_calls_pool", {
        ...filters,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      loadNewCallsFacets(filters),
    ]);

  const rows = (list.data ?? []) as unknown as PoolRow[];
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]],
    ),
  ).toString();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New Calls"
        description="Leads nobody has spoken to or claimed yet. Take what you can call."
      />
      <NewCallsBoard
        rows={rows}
        total={rows[0]?.total_count ?? 0}
        error={list.error?.message ?? null}
        facets={
          facetsAgreeWithList(facetResult.facets, rows[0]?.total_count ?? 0) ?? undefined
        }
        facetError={
          facetResult.error ??
          (facetResult.facets &&
          facetResult.facets.total !== (rows[0]?.total_count ?? 0)
            ? "Filter counts are out of step with the list and are not being shown."
            : null)
        }
        page={page}
        pageSize={PAGE_SIZE}
        search={search}
        sourceIds={sourceIds}
        teacherIds={teacherIds}
        contentIds={contentIds}
        masters={{
          teachers: masters.teachers,
          institutes: masters.institutes,
          courses: masters.courses,
          contents: masters.contents,
          terms: masters.terms,
          sources: masters.sources,
        }}
        selected={{
          course: one(sp.course) ?? "",
          teacher: one(sp.teacher) ?? "",
          institute: one(sp.institute) ?? "",
          importance: one(sp.importance) ?? "",
          term: one(sp.term) ?? "",
          createdFrom: one(sp.createdFrom) ?? "",
          createdTo: one(sp.createdTo) ?? "",
          product: one(sp.product) ?? "",
        }}
      />
    </div>
  );
}
