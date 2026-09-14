import Link from "next/link";

import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { facetsAgreeWithList, loadNewCallsFacets } from "@/lib/facets";
import { loadMasters } from "@/lib/masters";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import { PAGE_SIZE, parseNewCallsParams } from "./filters";
import { AfterSaleBoard, type AfterSaleRow } from "./after-sale-board";
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
  const viewer = await requireUser();
  const sp = await searchParams;
  const { page, sourceIds, teacherIds, contentIds, filters } = parseNewCallsParams(read(sp));
  // §33.6. Two pipelines, one pool. They share nothing but the question — who
  // is waiting and nobody has picked them up — so they are sub-tabs rather
  // than one list with a type column.
  const pipeline = one(sp.pipeline) === "after_sale" ? "after_sale" : "purchase";

  const supabase = await createClient();

  const masters = await loadMasters();

  // Both totals on every render: the sub-tabs carry counts, and a count that
  // only appears once you are on the tab is no use for deciding to go there.
  const afterSale = await supabase.rpc("new_calls_after_sale", {
    p_limit: pipeline === "after_sale" ? PAGE_SIZE : 1,
    p_offset: pipeline === "after_sale" ? (page - 1) * PAGE_SIZE : 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const afterSaleRows = (afterSale.data ?? []) as unknown as AfterSaleRow[];
  const afterSaleTotal = afterSaleRows[0]?.total_count ?? 0;
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


  // One line per render, so the phase breakdown is in the server log.
  logServerTiming("/new-calls");
  const purchaseTotal = rows[0]?.total_count ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New Calls"
        description="Leads nobody has spoken to or claimed yet. Take what you can call."
      />

      <NewCallsPipelineTabs
        pipeline={pipeline}
        search={search}
        purchase={purchaseTotal}
        afterSale={afterSaleTotal}
      />

      {pipeline === "after_sale" ? (
        <AfterSaleBoard
          rows={afterSaleRows}
          total={afterSaleTotal}
          error={afterSale.error?.message ?? null}
          counsellorName={viewer.profile?.full_name ?? null}
          masters={{
            teachers: masters.teachers,
            courses: masters.courses,
            subjects: masters.subjects,
            contents: masters.contents,
            terms: masters.terms,
            sources: masters.sources,
          }}
        />
      ) : (
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
        importanceIds={filters.p_importance ?? []}
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
      )}
    </div>
  );
}

/**
 * The two halves of the pool, with their counts.
 *
 * Links rather than client state: the boards below are server-rendered from
 * different functions with different filters, and a tab that only changed what
 * was on screen would have to hold both.
 */
function NewCallsPipelineTabs({
  pipeline,
  search,
  purchase,
  afterSale,
}: {
  pipeline: "purchase" | "after_sale";
  search: string;
  purchase: number;
  afterSale: number;
}) {
  const href = (key: "purchase" | "after_sale") => {
    const params = new URLSearchParams(search);
    params.set("pipeline", key);
    params.delete("page");
    return `/new-calls?${params.toString()}`;
  };
  const tabs = [
    { key: "purchase" as const, label: "Purchase", count: purchase },
    { key: "after_sale" as const, label: "After Sale", count: afterSale },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-md border border-line-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={pipeline === t.key ? "page" : undefined}
            className={
              pipeline === t.key
                ? "bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-ink"
                : "bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:bg-surface-2"
            }
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-80">{t.count}</span>
          </Link>
        ))}
      </div>
      <span className="text-[11.5px] text-ink-3">
        {pipeline === "after_sale"
          ? "Tickets never called, and open tickets whose number has come in again."
          : "Open leads nobody has called or claimed today."}
      </span>
    </div>
  );
}
