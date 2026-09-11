"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { loadArchiveIds, type ArchiveFilter } from "@/lib/archive";
import { EXPORT_COLUMNS, loadExportRows } from "@/lib/export";
import type { ExportResult } from "@/lib/export-actions";
import { createClient } from "@/lib/supabase/server";

/**
 * §9 Data management server actions.
 *
 * The order matters and is the whole safety story: resolve the ids, build the
 * export from those exact ids, hand it to the browser, and only once the file
 * exists does a second call mark that same id list archived. If the browser
 * dies in between, nothing is archived and the operator simply runs it again —
 * the failure mode is "nothing happened", never "archived but never exported".
 */

const CALL_COLUMNS = [
  { key: "enquiry_id", label: "Enquiry" },
  { key: "mobile", label: "Mobile" },
  { key: "student_name", label: "Name" },
  { key: "call_date", label: "Call date" },
  { key: "called_at", label: "Called at" },
  { key: "called_by_name", label: "Counsellor" },
  { key: "outcome", label: "Outcome" },
  { key: "discussion", label: "Note" },
  { key: "next_follow_up_date", label: "Next follow-up" },
  { key: "order_id", label: "Order ID" },
  { key: "issue_category", label: "Issue" },
];

/** A hard ceiling, for the same reason select-all has one. */
const MAX_BATCH = 20000;

async function requireManager() {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    throw new Error("Not authorised.");
  }
  return viewer;
}

/**
 * Build the archive export for a filter: the 29-column enquiry sheet plus a
 * second sheet with every call flattened, one row each. Archives nothing.
 */
export async function buildArchiveExport(
  filter: ArchiveFilter,
  archived: boolean,
): Promise<ExportResult & { ids?: number[] }> {
  await requireManager();

  const { ids, error, truncated } = await loadArchiveIds(filter, archived);
  if (error) return { error };
  if (truncated) {
    return { error: "The matching set could not be read in full. Narrow the filter." };
  }
  if (!ids.length) return { error: "Nothing matches that filter." };
  if (ids.length > MAX_BATCH) {
    return {
      error: `That is ${ids.length} enquiries — more than the ${MAX_BATCH} that can go in one batch. Narrow the date range.`,
    };
  }

  const { rows, error: exportError } = await loadExportRows(ids);
  if (exportError) return { error: exportError };

  const supabase = await createClient();
  const { data: calls, error: callsError } = await supabase.rpc("export_calls", {
    p_ids: ids,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (callsError) return { error: callsError.message };

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    error: null,
    rows,
    columns: EXPORT_COLUMNS.map((c) => ({ key: c.key as string, label: c.label })),
    extraSheets: [
      {
        name: "Calls",
        rows: (calls ?? []) as unknown as Record<string, unknown>[],
        columns: CALL_COLUMNS,
      },
    ],
    filename: `calman-archive-${stamp}`,
    ids,
  };
}

/** Mark an already-exported id list archived, and open a batch for it. */
export async function archiveBatch(
  ids: number[],
  filter: ArchiveFilter,
): Promise<{ error: string | null; ok?: string; batchId?: string }> {
  await requireManager();
  if (!ids.length) return { error: "Nothing to archive." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_enquiries", {
    p_ids: ids,
    p_filter: filter as unknown as Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  revalidatePath("/settings/data");
  revalidatePath("/assign");
  revalidatePath("/enquiries");
  revalidatePath("/new-calls");
  revalidatePath("/my-day");
  revalidatePath("/tickets");

  return {
    error: null,
    ok: `Archived ${ids.length} enquir${ids.length === 1 ? "y" : "ies"}.`,
    batchId: data as unknown as string,
  };
}

/** Re-export one batch, whatever is left of it. */
export async function reExportBatch(batchId: string): Promise<ExportResult> {
  await requireManager();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enquiries")
    .select("id")
    .eq("archive_batch_id", batchId)
    .order("id")
    .limit(MAX_BATCH);

  if (error) return { error: error.message };
  const ids = (data ?? []).map((r) => r.id);
  if (!ids.length) {
    return { error: "Nothing left in that batch — it has been purged." };
  }

  const { rows, error: exportError } = await loadExportRows(ids);
  if (exportError) return { error: exportError };

  const { data: calls, error: callsError } = await supabase.rpc("export_calls", {
    p_ids: ids,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (callsError) return { error: callsError.message };

  return {
    error: null,
    rows,
    columns: EXPORT_COLUMNS.map((c) => ({ key: c.key as string, label: c.label })),
    extraSheets: [
      {
        name: "Calls",
        rows: (calls ?? []) as unknown as Record<string, unknown>[],
        columns: CALL_COLUMNS,
      },
    ],
    filename: `calman-archive-batch-${batchId.slice(0, 8)}`,
  };
}

/**
 * Purge. Super admin only — enforced in the function too, because a route
 * guard is not a permission.
 */
export async function purgeArchived(
  filter: ArchiveFilter,
  expectedCount: number,
): Promise<{ error: string | null; ok?: string }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") {
    return { error: "Only a super admin may purge." };
  }

  const { ids, error, truncated } = await loadArchiveIds(filter, true);
  if (error) return { error };
  if (truncated) {
    return { error: "The matching set could not be read in full. Narrow the filter." };
  }
  if (ids.length !== expectedCount) {
    return {
      error: `The set changed: ${ids.length} archived enquiries match now, not ${expectedCount}. Check the count and try again.`,
    };
  }

  const supabase = await createClient();
  const { data, error: purgeError } = await supabase.rpc("purge_archived", {
    p_ids: ids,
    p_expected_count: expectedCount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (purgeError) return { error: purgeError.message };

  const r = (data as unknown as { purged_enquiries: number; purged_calls: number }[])?.[0];

  revalidatePath("/settings/data");
  revalidatePath("/enquiries");

  return {
    error: null,
    ok: `Purged ${r?.purged_enquiries ?? 0} enquiries and ${r?.purged_calls ?? 0} calls. The export is now the only copy.`,
  };
}

/** Unarchive one enquiry, from the student history page. */
export async function unarchiveEnquiry(
  enquiryId: number,
): Promise<{ error: string | null; ok?: string }> {
  await requireManager();

  const supabase = await createClient();
  const { error } = await supabase.rpc("unarchive_enquiry", {
    p_id: enquiryId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  revalidatePath("/enquiries");
  revalidatePath("/assign");

  return { error: null, ok: "Unarchived." };
}
