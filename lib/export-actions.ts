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
    | { source: "offers" },
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
    const { filters } = parseEnquiriesParams((k) => params.get(k));
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
