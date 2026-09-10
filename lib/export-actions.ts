"use server";

import { parseDeskParams, parseEnquiriesParams } from "@/app/(app)/assign/filters";
import { isAdmin, requireUser } from "@/lib/auth";
import { loadEnquiries } from "@/lib/enquiries";
import { EXPORT_COLUMNS, loadExportRows, MAX_EXPORT, type ExportRow } from "@/lib/export";
import { loadAllMatching } from "@/lib/recommended";

export type ExportResult = {
  error: string | null;
  rows?: ExportRow[];
  columns?: { key: string; label: string }[];
  filename?: string;
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
    | { source: "myday"; date: string; counsellorId: string | null },
): Promise<ExportResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  let ids: number[] = [];
  let stem = "calman-export";

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
    const all = await loadEnquiries({ ...filters, limit: MAX_EXPORT, offset: 0 });
    if (all.error) return { error: all.error };
    ids = all.rows.map((r) => r.enquiry_id);
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
