"use server";

import { parseDeskParams, parseEnquiriesParams } from "@/app/(app)/assign/filters";
import { isAdmin, requireUser } from "@/lib/auth";
import { loadEnquiries } from "@/lib/enquiries";
import type { CallReportRow } from "@/lib/report-shape";
import { EXPORT_COLUMNS, loadExportRows, MAX_EXPORT, type ExportRow } from "@/lib/export";
import { loadMyDayIds } from "@/lib/my-day";
import {
  myDayTabSlug,
  parseSubTab,
  subTabSlug,
  type MyDayTabKey,
  type MyDayView,
} from "@/lib/my-day-tabs";
import { loadAllMatching } from "@/lib/recommended";
import { CALL_REPORT_COLUMNS, loadCallReport } from "@/lib/reports";
import { loadOffers, loadOfferTargetNames } from "@/lib/offers";
import { ISSUE_CATEGORY_LABELS, ticketStateLabel } from "@/lib/enquiry-labels";
import { TICKET_EXPORT_COLUMNS, TICKET_TABS } from "@/lib/ticket-tabs";
import { createClient } from "@/lib/supabase/server";
import type { EnquiryStatus, IssueCategory } from "@/lib/enquiry-labels";

/** The shape tickets_list returns, narrowed to what the export prints. */
type TicketExportRow = {
  student_name: string | null;
  mobile: string;
  order_id: string | null;
  institute_name: string | null;
  teacher_name: string | null;
  issue_category: IssueCategory | null;
  status: EnquiryStatus;
  escalated_to_name: string | null;
  created_at: string;
  open_days: number | null;
  reminder_date: string | null;
  is_overdue: boolean;
  last_call_at: string | null;
  last_caller_name: string | null;
};

/** One screenful is fifty; an export is the set. Capped like the others. */
const EXPORT_CAP = 5000;
import {
  describeTargets,
  offerWindowFrom,
  OFFER_EXPORT_COLUMNS,
} from "@/lib/offer-shape";

export type ExportSheet = {
  name: string;
  rows: Record<string, unknown>[];
  columns: { key: string; label: string }[];
};

export type ExportResult = {
  error: string | null;
  rows?: ExportRow[];
  columns?: { key: string; label: string }[];
  filename?: string;
  /**
   * Extra sheets for the workbook (§9). XLSX gets one worksheet each; CSV
   * cannot hold more than one table, so each becomes its own file.
   */
  extraSheets?: ExportSheet[];
  /** Name for the first worksheet. Defaults to the enquiry export's own. */
  sheetName?: string;
};

/**
 * Export the current filtered view (§5.6), from whichever screen asked.
 *
 * Each source re-derives its own ids server-side from the query string, using
 * the same parser the screen rendered with — so "export what I am looking at"
 * cannot quietly mean something else. Export is open to all roles; it returns
 * only rows the caller's RLS would show them anyway.
 */
export async function exportCurrentView(
  input:
    | { source: "enquiries"; search: string }
    | { source: "desk"; search: string }
    | {
        source: "myday";
        date: string;
        counsellorId: string | null;
        tab: MyDayTabKey;
        view: MyDayView;
        /** §24: which sub-tab, as "all" | "slot:N" | "offer:<id>". */
        subTab?: string;
        /** The offer's name, for the filename only. */
        subTabName?: string | null;
      }
    | { source: "report"; from: string; to: string; counsellorId: string | null }
    | { source: "offers" }
    /** §44b.2: the ticket queue, as the sub-tab and filters currently cut it. */
    | { source: "tickets"; search: string; state: string; date: string },
): Promise<ExportResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  let ids: number[] = [];
  let stem = "calman-export";

  // The report is a different row shape from an enquiry, so it returns
  // directly rather than collecting ids — but it still goes out through the
  // same client-side file builder.
  //
  // Both tables, with the same columns, because they are the same numbers cut
  // two ways: a workbook holding only one of them invites the reader to do the
  // other cut by hand and get it wrong.
  if (input.source === "report") {
    const admin = isAdmin(viewer.profile.role);
    const scope = admin ? input.counsellorId : viewer.userId!;
    const [byDay, byCounsellor] = await Promise.all([
      loadCallReport(input.from, input.to, scope, "day"),
      loadCallReport(input.from, input.to, scope, "counsellor"),
    ]);
    if (byDay.error || byCounsellor.error) {
      return { error: byDay.error ?? byCounsellor.error };
    }
    if (!byDay.rows.some((r) => Number(r.total_calls ?? 0) !== 0)) {
      return { error: "No calls in that range." };
    }

    const shape = (rows: CallReportRow[], firstKey: string) =>
      rows.map((r) => ({
        [firstKey]: r.is_total ? "Total" : r.grain_label,
        ...Object.fromEntries(CALL_REPORT_COLUMNS.map((c) => [c.key, r[c.key]])),
      }));
    const columns = (firstKey: string, firstLabel: string) => [
      { key: firstKey, label: firstLabel },
      ...CALL_REPORT_COLUMNS.map((c) => ({ key: c.key as string, label: c.label })),
    ];

    return {
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows: shape(byDay.rows, "date") as any,
      columns: columns("date", "Date"),
      sheetName: "By day",
      extraSheets: [
        {
          name: "By counsellor",
          rows: shape(byCounsellor.rows, "counsellor"),
          columns: columns("counsellor", "Counsellor"),
        },
      ],
      filename: `calman-report-${input.from}-to-${input.to}`,
    };
  }

  /**
   * §44b.2. The ticket queue.
   *
   * Re-run rather than handed the rows the screen drew: the export has to be
   * the whole filtered set, not the fifty on the page, and re-deriving it from
   * the same query string with the same function is what keeps "export what I
   * am looking at" honest.
   */
  if (input.source === "tickets") {
    const params = new URLSearchParams(input.search);
    const one = (k: string) => params.get(k) || null;
    const supabase = await createClient();
    const tab = TICKET_TABS.find((t) => t.key === input.state);
    const statusParam = one("status");

    const { data, error } = await supabase.rpc("tickets_list", {
      p_status:
        input.state === "resolved"
          ? undefined
          : ((statusParam ?? tab?.status) as never),
      p_resolved_on: input.state === "resolved" ? input.date : undefined,
      p_counsellor_id: one("counsellor") ?? undefined,
      p_issue_category: (one("issue") ?? undefined) as never,
      p_escalated_to: one("escalatedTo") ?? undefined,
      p_institute_id: one("institute") ?? undefined,
      p_open_since: one("openSince") ? Number(one("openSince")) : undefined,
      p_due: one("due") ?? undefined,
      p_due_within: one("due") === "within" ? 7 : undefined,
      p_from: one("from") ?? undefined,
      p_to: one("to") ?? undefined,
      p_sort: one("sort") ?? "reminder",
      p_dir: one("dir") ?? "asc",
      p_as_of: input.date,
      p_limit: EXPORT_CAP,
      p_offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (error) return { error: error.message };
    const list = (data ?? []) as unknown as TicketExportRow[];
    if (!list.length) return { error: "There are no tickets in this view to export." };

    return {
      error: null,
      rows: list.map((t) => ({
        student_name: t.student_name ?? "",
        mobile: t.mobile,
        order_id: t.order_id ?? "",
        institute_name: t.institute_name ?? "",
        teacher_name: t.teacher_name ?? "",
        issue_category: t.issue_category
          ? ISSUE_CATEGORY_LABELS[t.issue_category]
          : "",
        status: ticketStateLabel(t.status),
        escalated_to_name: t.escalated_to_name ?? "",
        opened: `${t.created_at.slice(0, 10)}${
          t.open_days == null ? "" : ` (${t.open_days} days)`
        }`,
        due: `${t.reminder_date ?? ""}${t.is_overdue ? " — overdue" : ""}`,
        last_call_at: t.last_call_at ? t.last_call_at.slice(0, 10) : "",
        last_caller_name: t.last_caller_name ?? "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any,
      columns: TICKET_EXPORT_COLUMNS.map((c) => ({ key: c.key as string, label: c.label })),
      sheetName: "Tickets",
      filename: `calman-tickets-${input.state}-${input.date}`,
    };
  }

  // The offers table with its performance numbers, exactly as Settings shows
  // it (§7). Admin-only, like the screen; the RLS on offers says so too.
  if (input.source === "offers") {
    if (!isAdmin(viewer.profile.role)) {
      return { error: "Only an admin or manager can export offers." };
    }
    const { offers, performance, error } = await loadOffers();
    if (error) return { error };
    if (!offers.length) return { error: "There are no offers to export." };

    const names = await loadOfferTargetNames();
    return {
      error: null,
      rows: offers.map((o) => {
        const p = performance[o.id];
        return {
          name: o.name,
          start_date: o.start_date,
          end_date: o.end_date,
          reminder_days: o.reminder_days,
          window_from:
            p?.window_from ??
            offerWindowFrom(o.start_date, o.end_date, o.reminder_days),
          is_active: o.is_active ? "Yes" : "No",
          targets: describeTargets(o.targets, names),
          matches_now: p?.matches_now ?? 0,
          reached: p?.reached ?? 0,
          called: p?.called ?? 0,
          won: p?.won ?? 0,
          won_amount: p?.won_amount ?? 0,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      columns: OFFER_EXPORT_COLUMNS.map((c) => ({
        key: c.key as string,
        label: c.label,
      })),
      sheetName: "Offers",
      filename: `calman-offers-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  if (input.source === "enquiries") {
    const params = new URLSearchParams(input.search);
    // §7.2. The same viewer the page parsed with, so "Called by" defaults the
    // same way here. Without it the export would silently widen a counsellor's
    // default view from their own calls to everybody's.
    const { filters } = parseEnquiriesParams((k) => params.get(k), {
      id: viewer.userId!,
      role: viewer.profile.role,
    });
    // One probe for the real total before pulling anything wide.
    const probe = await loadEnquiries({ ...filters, limit: 1, offset: 0 });
    if (probe.error) return { error: probe.error };
    if (probe.total > MAX_EXPORT) {
      return {
        error: `That is ${probe.total} enquiries — more than the ${MAX_EXPORT} that can be exported at once. Narrow the filter first.`,
      };
    }
    // Paged: PostgREST caps a response at 1000 rows, so asking for MAX_EXPORT
    // in one call would have quietly exported the first thousand of a set the
    // guard above had just declared small enough to export whole.
    const PAGE = 500;
    for (let offset = 0; offset < probe.total; offset += PAGE) {
      const page = await loadEnquiries({ ...filters, limit: PAGE, offset });
      if (page.error) return { error: page.error };
      ids.push(...page.rows.map((r) => r.enquiry_id));
      if (page.rows.length < PAGE) break;
    }
    stem = "calman-enquiries";
  } else if (input.source === "desk") {
    const params = new URLSearchParams(input.search);
    const { filters } = parseDeskParams((k) => params.get(k));
    const all = await loadAllMatching(filters);
    if (all.error) return { error: all.error };
    ids = all.rows.map((r) => r.enquiryId);
    stem = "calman-assignment-desk";
  } else {
    // A counsellor exports their own day whatever the query string says.
    const admin = isAdmin(viewer.profile.role);
    const counsellorId = admin ? (input.counsellorId ?? viewer.userId!) : viewer.userId!;
    // The same source the screen renders: the day's assignments, including the
    // ones whose enquiry has since closed. Reading recommended_calls() here
    // instead would export the tabs minus everything in Done.
    const sub = parseSubTab(input.subTab);
    const all = await loadMyDayIds({
      date: input.date,
      counsellorId,
      tab: input.tab,
      view: input.view,
      subTab: sub,
    });
    if (all.error) return { error: all.error };
    ids = all.ids;
    const slug = subTabSlug(sub, input.subTabName);
    stem = `calman-my-day-${myDayTabSlug(input.tab)}${slug ? `-${slug}` : ""}-${input.view}`;
  }

  if (!ids.length) return { error: "Nothing matches the current filter." };

  const { rows, error } = await loadExportRows(ids);
  if (error) return { error };

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    error: null,
    rows,
    columns: EXPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
    filename: `${stem}-${stamp}`,
  };
}
