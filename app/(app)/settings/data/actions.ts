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
 * The order is the whole safety story, and it runs archive-first:
 *
 *   1. archiveByFilter   marks the set archived, which takes it out of every
 *                        list and out of Quick Add, so no call can land on it
 *   2. reExportBatch     builds the workbook from that batch
 *   3. confirmBatchExport                once the browser actually has the file
 *      rollbackBatch     if it does not — enquiries and assignments both back
 *
 * Exporting first left a window where a call logged mid-export was in the
 * database but not in the file. Archiving first closes it, at the cost of the
 * archive being real before the file exists — so it has to be, and is, fully
 * reversible.
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
 * Step 1: archive the matching set.
 *
 * This runs BEFORE the export, on purpose. An archived enquiry is already out
 * of every list and out of Quick Add's "is anything open on this number?"
 * test, so no call can land on it while the workbook is being built. The old
 * order — export, then archive — left exactly that window, and a call that
 * fell in it was in the database but not in the file.
 *
 * The risk moves to the other side: the archive is real before the file
 * exists. Which is why it is fully undoable, assignments included, and why the
 * caller must roll it back if the export does not complete.
 */
export async function archiveByFilter(filter: ArchiveFilter): Promise<{
  error: string | null;
  batchId?: string;
  count?: number;
}> {
  await requireManager();

  const { ids, error, truncated } = await loadArchiveIds(filter, false);
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

  const supabase = await createClient();
  const { data, error: archiveError } = await supabase.rpc("archive_enquiries", {
    p_ids: ids,
    p_filter: filter as unknown as Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (archiveError) return { error: archiveError.message };

  revalidatePath("/settings/data");
  revalidatePath("/assign");
  revalidatePath("/enquiries");
  revalidatePath("/new-calls");
  revalidatePath("/my-day");
  revalidatePath("/tickets");

  return { error: null, batchId: data as unknown as string, count: ids.length };
}

/** Step 3: the browser has the file. Nothing else changes. */
export async function confirmBatchExport(
  batchId: string,
): Promise<{ error: string | null }> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_batch_export", {
    p_batch_id: batchId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (error) return { error: error.message };
  revalidatePath("/settings/data");
  return { error: null };
}

/**
 * Undo a whole batch — enquiries back in the lists, assignments back on their
 * day, batch row gone. Called automatically when the export fails, and from
 * the log for a batch whose export was never confirmed.
 */
export async function rollbackBatch(
  batchId: string,
): Promise<{ error: string | null; restored?: number }> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unarchive_batch", {
    p_batch_id: batchId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  revalidatePath("/settings/data");
  revalidatePath("/assign");
  revalidatePath("/enquiries");
  revalidatePath("/new-calls");
  revalidatePath("/my-day");
  revalidatePath("/tickets");

  return { error: null, restored: data as unknown as number };
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
