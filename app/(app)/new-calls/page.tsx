import {
  CALL_TYPES,
  CALL_TYPE_LABELS,
  isCallType,
  type CallType,
} from "@/lib/call-type";
import Link from "next/link";

import { PageHeader } from "@/components/ui";
import { loadEscalatees } from "@/lib/escalatees";
import { requireUser } from "@/lib/auth";
import { facetsAgreeWithList, loadNewCallsFacets } from "@/lib/facets";
import { loadMasters } from "@/lib/masters";
import { ServerTiming, logServerTiming, timed } from "@/lib/server-timing";
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
  const { page, sourceIds, teacherIds, contentIds, callTypes, filters } =
    parseNewCallsParams(read(sp));
  // §33.6. Two pipelines, one pool. They share nothing but the question — who
  // is waiting and nobody has picked them up — so they are sub-tabs rather
  // than one list with a type column.
  const pipeline = one(sp.pipeline) === "after_sale" ? "after_sale" : "purchase";

  const supabase = await createClient();

  const masters = await loadMasters();
  // §45.3: every active user, for the escalate-to picker in the call window.
  const escalatees = await loadEscalatees();


  // Both totals on every render: the sub-tabs carry counts, and a count that
  // only appears once you are on the tab is no use for deciding to go there.
  const afterSale = await timed("rpc:after_sale", () =>
    supabase.rpc("new_calls_after_sale", {
      p_limit: pipeline === "after_sale" ? PAGE_SIZE : 1,
      p_offset: pipeline === "after_sale" ? (page - 1) * PAGE_SIZE : 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  );
  const afterSaleRows = (afterSale.data ?? []) as unknown as AfterSaleRow[];
  const afterSaleTotal = afterSaleRows[0]?.total_count ?? 0;
  // §47.5. The tab counts describe the whole pool under the *other* filters,
  // so picking a tab narrows the list without zeroing the two counts beside
  // it. p_call_types is the one argument deliberately not passed on.
  const { p_call_types: _chosen, ...countFilters } = filters;
  const [list, facetResult, typeCounts] =
    await Promise.all([
      timed("rpc:pool", () =>
        supabase.rpc("new_calls_pool", {
          ...filters,
          p_limit: PAGE_SIZE,
          p_offset: (page - 1) * PAGE_SIZE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      ),
      timed("rpc:facets", () => loadNewCallsFacets(filters)),
      timed("rpc:type_counts", () =>
        supabase.rpc("new_calls_type_counts", {
          ...countFilters,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      ),
    ]);

  // The function returns a row only for a type that has leads, so the three
  // are seeded at zero rather than read straight out of the result.
  const byType: Record<CallType, number> = { video: 0, books: 0, unknown: 0 };
  for (const row of (typeCounts.data ?? []) as { call_type: string; n: number }[]) {
    if (isCallType(row.call_type)) byType[row.call_type] = Number(row.n ?? 0);
  }

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
      {/* §53.1. The phase breakdown, where a browser can read it. */}
      <ServerTiming route="/new-calls" />

      <NewCallsPipelineTabs
        pipeline={pipeline}
        search={search}
        purchase={purchaseTotal}
        afterSale={afterSaleTotal}
      />

      {pipeline === "purchase" ? (
        <CallTypeTabs chosen={callTypes} counts={byType} search={search} />
      ) : null}

      {pipeline === "after_sale" ? (
        <AfterSaleBoard
          escalatees={escalatees}
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
            prefetch={false}
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

/**
 * Video · Books · Unknown (§47.5).
 *
 * A filter, not a partition: the counts beside each name describe the pool
 * under every *other* filter, so they stay put as tabs are picked and a
 * counsellor can see where the work is before going there. Multi-select,
 * because "Books and Unknown" is a real morning's work and forcing two passes
 * over the same list to get it would be the wrong shape.
 *
 * Links rather than buttons, like every other filter on this screen, so a tab
 * is shareable and the back button means what it says.
 */
function CallTypeTabs({
  chosen,
  counts,
  search,
}: {
  chosen: CallType[];
  counts: Record<CallType, number>;
  search: string;
}) {
  const href = (key: CallType) => {
    const params = new URLSearchParams(search);
    // Clicking a chosen tab clears it, so the same control turns the filter
    // off. With none chosen the parameter goes altogether and the list is
    // everything, which is what "no tab selected" should mean.
    const next = chosen.includes(key)
      ? chosen.filter((c) => c !== key)
      : [...chosen, key];
    if (next.length) params.set("callType", next.join(","));
    else params.delete("callType");
    params.delete("page");
    return `/new-calls?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
        Type
      </span>
      <div className="inline-flex overflow-hidden rounded-md border border-line-2">
        {CALL_TYPES.map((key) => {
          const on = chosen.includes(key);
          return (
            <Link
              key={key}
              href={href(key)}
              // §51.1. Same reason as the rail: a dynamic route's prefetch is
              // stale on arrival, so this was two server renders per tab bought
              // on every load and spent on nothing.
              prefetch={false}
              aria-current={on ? "true" : undefined}
              className={
                on
                  ? "bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-ink"
                  : "bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:bg-surface-2"
              }
            >
              {CALL_TYPE_LABELS[key]}
              <span className="ml-1.5 tabular-nums opacity-80">{counts[key]}</span>
            </Link>
          );
        })}
      </div>
      <span className="text-[11.5px] text-ink-3">
        Worked out from the product text and the last call note.
      </span>
    </div>
  );
}
