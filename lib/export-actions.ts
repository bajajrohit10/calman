"use server";

import { parseDeskParams, parseEnquiriesParams } from "@/app/(app)/assign/filters";
import { isAdmin, requireUser } from "@/lib/auth";
import { loadEnquiries } from "@/lib/enquiries";
import { EXPORT_COLUMNS, loadExportRows, MAX_EXPORT, type ExportRow } from "@/lib/export";
import { loadAllMatching } from "@/lib/recommended";
import {
  loadReport,
  loadStageReport,
  REPORT_COLUMNS,
  STAGE_COLUMNS,
  STAGE_MEMO_COLUMNS,
} from "@/lib/reports";

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
    | { source: "myday"; date: string; counsellorId: string | null }
    | { source: "report"; from: string; to: string; counsellorId: string | null }
    | { source: "stage"; from: string; to: string; counsellorId: string | null },
): Promise<ExportResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  let ids: number[] = [];
  let stem = "calman-export";

  // The report is a different row shape from an enquiry, so it returns
  // directly rather than collecting ids — but it still goes out through the
  // same client-side file builder.
  if (input.source === "report") {
    const admin = isAdmin(viewer.profile.role);
    const scope = admin ? input.counsellorId : viewer.userId!;
    const { rows, error } = await loadReport(input.from, input.to, scope);
    if (error) return { error };
    if (!rows.length) return { error: "No activity in that range." };

    return {
      error: null,
      rows: rows.map((r) => ({
        day: r.day,
        counsellor: r.counsellor_name,
        ...Object.fromEntries(REPORT_COLUMNS.map((c) => [c.key, r[c.key]])),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any,
      columns: [
        { key: "day", label: "Day" },
        { key: "counsellor", label: "Counsellor" },
        ...REPORT_COLUMNS.map((c) => ({ key: c.key as string, label: c.label })),
      ],
      filename: `calman-report-${input.from}-to-${input.to}`,
    };
  }

  // The stage table exports on the same terms, with the memo columns suffixed
  // so a spreadsheet reader cannot sum the row and get twice the calls.
  if (input.source === "stage") {
    const admin = isAdmin(viewer.profile.role);
    const scope = admin ? input.counsellorId : viewer.userId!;
    const { rows, error } = await loadStageReport(input.from, input.to, scope);
    if (error) return { error };

    const withCalls = rows.filter((r) => Number(r.total_calls ?? 0) !== 0);
    if (!withCalls.length) return { error: "No calls in that range." };

    return {
      error: null,
      rows: withCalls.map((r) => ({
        day: r.day,
        counsellor: r.counsellor_name,
        ...Object.fromEntries(
          [...STAGE_COLUMNS, ...STAGE_MEMO_COLUMNS].map((c) => [c.key, r[c.key]]),
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any,
      columns: [
        { key: "day", label: "Day" },
        { key: "counsellor", label: "Counsellor" },
        ...STAGE_COLUMNS.map((c) => ({ key: c.key as string, label: c.label })),
        ...STAGE_MEMO_COLUMNS.map((c) => ({
          key: c.key as string,
          label: `Of which: ${c.label}`,
        })),
      ],
      filename: `calman-stage-report-${input.from}-to-${input.to}`,
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
    const all = await loadAllMatching({
      date: input.date,
      counsellorId,
      includeNotDue: true,
    });
    if (all.error) return { error: all.error };
    ids = all.rows.map((r) => r.enquiryId);
    stem = "calman-my-day";
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
