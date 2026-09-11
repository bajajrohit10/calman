import "server-only";

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
  { key: "follow_up_slots_used", label: "Slots used" },
  { key: "last_call_at", label: "Last call at" },
  { key: "last_outcome", label: "Last outcome" },
  { key: "last_discussion", label: "Last note" },
  { key: "assigned_to_name", label: "Assigned to" },
  { key: "assigned_date", label: "Assigned for" },
  { key: "assignment_label", label: "Campaign label" },
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

  return { rows: out, error: null };
}
