import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { buildFacetMap, type FacetRow } from "@/lib/facet-shape";
import { facetsAgreeWithList } from "@/lib/facets";
import { loadMasters } from "@/lib/masters";
import { showsSupport } from "@/lib/roles";
import { ServerTiming, logServerTiming, timed } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import { PAGE_SIZE, parseSupportParams, type SupportTab } from "./filters";
import { SupportBoard, type TicketRow } from "./support-board";

export const metadata = { title: "Support · Calman" };

type Params = Record<string, string | string[] | undefined>;

/** Repeated keys arrive comma-joined, as on every other filter bar. */
const read = (sp: Params) => (k: string): string | null => {
  const v = sp[k];
  if (Array.isArray(v)) return v.length ? v.join(",") : null;
  return v ?? null;
};

/** §58.0. Ticket team, managers and super admins. Counsellors get a 404. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  // notFound rather than a message: a counsellor has no business knowing what
  // lives at this path, and RLS would hand them an empty screen anyway.
  if (!viewer.profile || !showsSupport(viewer.profile.role)) notFound();

  const sp = await searchParams;
  const { page, tab, issues, assignedTo, sources, escalationKinds, statuses, filters, selected } =
    parseSupportParams(read(sp));

  const supabase = await createClient();
  const db = supabase.schema("support");

  const masters = await loadMasters();
  // Everybody active, all roles: escalation can land on anyone, and so can an
  // assignment.
  const staff = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name");

  // The tab counts describe the queue under every *other* filter, so choosing a
  // tab narrows the list without zeroing the numbers beside it.
  // p_escalation_kinds goes with p_tab: the chip exists only on the Escalated
  // tab, and narrowing every count by it would zero the New tab the moment
  // somebody picked Institute.
  const { p_tab: _tab, p_escalation_kinds: _kinds, ...countFilters } = filters;

  const [list, facetResult, tabCounts] = await Promise.all([
    timed("rpc:support_queue", () =>
      db.rpc("queue", {
        ...filters,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ),
    timed("rpc:support_facets", () =>
      db.rpc("queue_facets", {
        ...filters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ),
    timed("rpc:support_tabs", () =>
      db.rpc("tab_counts", {
        ...countFilters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ),
  ]);

  const rows = (list.data ?? []) as unknown as TicketRow[];
  const total = rows[0]?.total_count ?? 0;

  const counts: Record<string, number> = {};
  for (const row of (tabCounts.data ?? []) as unknown as { tab: string; n: number }[]) {
    counts[row.tab] = Number(row.n ?? 0);
  }

  const facets = buildFacetMap((facetResult.data ?? []) as unknown as FacetRow[]);

  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null
        ? []
        : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string]),
    ),
  ).toString();

  logServerTiming("/support");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Support"
        description="Student tickets from the form, plus anything the team raises by hand."
      />
      <ServerTiming route="/support" />

      <SupportBoard
        rows={rows}
        total={total}
        error={list.error?.message ?? null}
        tab={tab as SupportTab}
        counts={counts}
        page={page}
        pageSize={PAGE_SIZE}
        search={search}
        issues={issues}
        assignedTo={assignedTo}
        sources={sources}
        escalationKinds={escalationKinds}
        statuses={statuses}
        selected={selected}
        facets={facetsAgreeWithList(facets, total) ?? undefined}
        facetError={
          facetResult.error?.message ??
          (facets.total !== total
            ? "Filter counts are out of step with the list and are not being shown."
            : null)
        }
        masters={{
          institutes: masters.institutes,
          teachers: masters.teachers,
        }}
        staff={(staff.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
      />
    </div>
  );
}
