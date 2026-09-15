import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import type { EnquiryStatus, IssueCategory } from "@/lib/enquiry-labels";
import { loadMasters } from "@/lib/masters";
import { istToday } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { TICKET_TABS, parseTicketTab } from "@/lib/ticket-tabs";

import { TicketsBoard, type TicketRow } from "./tickets-board";

export const metadata = { title: "Tickets · Calman" };

const PAGE_SIZE = 50;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/**
 * §5.11. The only place after-sale enquiries are worked. All roles — the
 * Ticket Team lives here, and a counsellor who took the original sale often
 * needs to see what happened next.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  const sp = await searchParams;

  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  // §33.3. The queue reads in three states. Open and escalated ignore the
  // date entirely; resolved is the one that needs one, and defaults to today.
  const state = parseTicketTab(one(sp.state));
  const on = one(sp.on) ?? istToday();
  const status = one(sp.status) as EnquiryStatus | null;
  const counsellor = one(sp.counsellor);
  const issue = one(sp.issue) as IssueCategory | null;
  const sort = one(sp.sort) ?? "reminder";
  const dir = one(sp.dir) === "desc" ? "desc" : "asc";

  const supabase = await createClient();

  const masters = await loadMasters();
  const [list, staff, counts] = await Promise.all([
    supabase.rpc("tickets_list", {
      p_status:
        state === "resolved"
          ? undefined
          : ((status ?? TICKET_TABS.find((t) => t.key === state)?.status) as
              | EnquiryStatus
              | undefined),
      p_resolved_on: state === "resolved" ? on : undefined,
      p_counsellor_id: counsellor ?? undefined,
      p_issue_category: issue ?? undefined,
      // §44.4's four. Each is undefined unless asked for, so an unset filter
      // costs the query nothing.
      p_escalated_to: one(sp.escalatedTo) ?? undefined,
      p_institute_id: one(sp.institute) ?? undefined,
      p_open_since: one(sp.openSince) ? Number(one(sp.openSince)) : undefined,
      p_due: one(sp.due) ?? undefined,
      p_due_within: one(sp.due) === "within" ? 7 : undefined,
      p_from: one(sp.from) ?? undefined,
      p_to: one(sp.to) ?? undefined,
      p_sort: sort,
      p_dir: dir,
      p_as_of: on,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name"),
    // Counted by the database rather than from the page of rows above, which
    // is one page of one state.
    supabase.rpc("tickets_counts", {
      p_date: on,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  ]);

  const tallies = (counts.data as unknown as {
    open_count: number;
    working_count: number;
    escalated_count: number;
    pending_institute_count: number;
    resolved_count: number;
  }[] | null)?.[0] ?? {
    open_count: 0,
    working_count: 0,
    escalated_count: 0,
    pending_institute_count: 0,
    resolved_count: 0,
  };

  const rows = (list.data ?? []) as unknown as TicketRow[];

  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]],
    ),
  ).toString();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tickets"
        description="After-sale work. These never enter the recommended call list."
      />
      <TicketsBoard
        rows={rows}
        total={rows[0]?.total_count ?? 0}
        error={list.error?.message ?? null}
        page={page}
        pageSize={PAGE_SIZE}
        sort={sort}
        dir={dir}
        search={search}
        state={state}
        on={on}
        counts={{
          open: tallies.open_count,
          working: tallies.working_count,
          escalated: tallies.escalated_count,
          pending_institute: tallies.pending_institute_count,
          resolved: tallies.resolved_count,
        }}
        counsellorName={viewer.profile?.full_name ?? null}
        institutes={masters.institutes}
        roster={(staff.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
        masters={{
          teachers: masters.teachers,
          courses: masters.courses,
          subjects: masters.subjects,
          contents: masters.contents,
          terms: masters.terms,
          sources: masters.sources,
        }}
        selected={{
          status: status ?? "",
          counsellor: counsellor ?? "",
          issue: issue ?? "",
          escalatedTo: one(sp.escalatedTo) ?? "",
          institute: one(sp.institute) ?? "",
          openSince: one(sp.openSince) ?? "",
          due: one(sp.due) ?? "",
          from: one(sp.from) ?? "",
          to: one(sp.to) ?? "",
        }}
      />
    </div>
  );
}
