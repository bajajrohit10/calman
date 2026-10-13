import "server-only";

import { nextFollowUpLabel } from "@/lib/enquiry-labels";
import { formatSheetDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/**
 * The exported column set, defined once (§5.6). All three screens run through
 * public.export_enquiries, so a column added here shows up everywhere at once
 * rather than in whichever export someone remembered to update.
 */
export const EXPORT_COLUMNS = [
  { key: "enquiry_id", label: "Enquiry" },
  { key: "mobile", label: "Mobile" },
  { key: "student_name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "lost_reason", label: "Lost reason" },
  { key: "close_reason", label: "Close reason" },
  { key: "importance", label: "Importance" },
  { key: "lead_verification", label: "Lead verification" },
  { key: "term_name", label: "Term" },
  { key: "source_name", label: "Source" },
  { key: "product_text", label: "Product text" },
  { key: "teachers", label: "Teachers" },
  { key: "courses", label: "Courses" },
  { key: "subjects", label: "Subjects" },
  { key: "contents", label: "Contents" },
  { key: "item_statuses", label: "Item statuses" },
  { key: "order_ids", label: "Order IDs" },
  { key: "amount_total", label: "Amount" },
  { key: "next_follow_up_date", label: "Next follow-up" },
  { key: "fresh_call_date", label: "Fresh call" },
  { key: "follow_up_slots_used", label: "Next follow-up" },
  { key: "last_call_at", label: "Last call at" },
  { key: "last_outcome", label: "Last outcome" },
  { key: "last_discussion", label: "Last note" },
  { key: "assigned_to_name", label: "Assigned to" },
  { key: "assigned_date", label: "Assigned for" },
  { key: "assignment_label", label: "Campaign label" },
  // §87. Arrival beside creation, in that order because that is the order they
  // happen: the student checked out, then the import wrote the row. They are
  // the same instant on most leads and days apart on an abandoned checkout,
  // which is the case the sheet could not previously explain.
  { key: "arrived_at", label: "Arrived" },
  { key: "created_at", label: "Created" },
  { key: "closed_at", label: "Closed" },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];
export type ExportRow = Record<ExportColumnKey, string | number | null>;

/**
 * Same ceiling as select-all, for the same reason: handing someone a
 * spreadsheet that silently stops at row 2000 is worse than telling them to
 * narrow the filter.
 */
export const MAX_EXPORT = 2000;

const CHUNK = 500;

export async function loadExportRows(
  ids: number[],
): Promise<{ rows: ExportRow[]; error: string | null }> {
  if (!ids.length) return { rows: [], error: "Nothing to export." };
  if (ids.length > MAX_EXPORT) {
    return {
      rows: [],
      error: `That is ${ids.length} enquiries — more than the ${MAX_EXPORT} that can be exported at once. Narrow the filter first.`,
    };
  }

  const supabase = await createClient();
  const out: ExportRow[] = [];

  // Chunked so the id array never becomes an unreasonable statement parameter.
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.rpc("export_enquiries", {
      p_ids: ids.slice(i, i + CHUNK),
    });
    if (error) return { rows: [], error: error.message };
    out.push(...((data ?? []) as unknown as ExportRow[]));
  }

  return { rows: out.map(withFollowUpLabel).map(inIst), error: null };
}

/**
 * §87. Every timestamp in the sheet, in IST.
 *
 * Postgres hands back a timestamptz as UTC, and the sheet printed it verbatim:
 * "2026-10-10T16:10:00+00:00" against a screen that said 9:40 pm, and a call
 * logged after 6:30 pm IST landed on the previous day in the file. The dates
 * are left alone — a `date` column has no timezone to get wrong.
 *
 * Formatted here rather than in SQL, and with the same module every screen
 * formats with, so there is one place that decides what IST looks like.
 */
const SHEET_TIMESTAMPS = ["arrived_at", "created_at", "closed_at", "last_call_at"] as const;

function inIst(row: ExportRow): ExportRow {
  const out = { ...row };
  for (const key of SHEET_TIMESTAMPS) {
    const v = out[key];
    out[key] = formatSheetDateTime(typeof v === "string" ? v : null);
  }
  return out;
}

/**
 * §45.1, finished. The column header says "Next follow-up"; the cell used to
 * hold the raw counter, so the sheet read "Next follow-up: 0" — which is the
 * exact ambiguity the rename was about, preserved in the one place somebody
 * reads away from the app and cannot ask.
 *
 * The label is computed here rather than in SQL so the spreadsheet and the
 * screens cannot drift: there is one function that decides what a slot count
 * is called, and this is it. A ticket has no ladder, so its cell is blank.
 */
function withFollowUpLabel(row: ExportRow): ExportRow {
  const used = row.follow_up_slots_used;
  return {
    ...row,
    follow_up_slots_used:
      row.type === "after_sale"
        ? ""
        : nextFollowUpLabel(
            typeof used === "number" ? used : Number(used ?? 0),
            Boolean(row.fresh_call_date),
          ),
  };
}
