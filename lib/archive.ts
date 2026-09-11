import "server-only";

import { fetchAllRows } from "@/lib/paged";
import { createClient } from "@/lib/supabase/server";
import type { CloseReason, EnquiryStatus, EnquiryType, LostReason } from "@/lib/enquiry-labels";

/**
 * §9 Data management: reading the archive side of things.
 *
 * The filter is defined once, here, and used for the live count on the form,
 * for the export, for the archive and for the purge — so the number the
 * operator reads and the set that actually moves cannot be different things.
 */

export type ArchiveFilter = {
  createdFrom: string | null;
  createdTo: string | null;
  statuses: EnquiryStatus[];
  type: EnquiryType | null;
  lostReason: LostReason | null;
};

export const EMPTY_FILTER: ArchiveFilter = {
  createdFrom: null,
  createdTo: null,
  statuses: [],
  type: null,
  lostReason: null,
};

export type ArchivePreview = {
  enquiry_count: number;
  call_count: number;
  item_count: number;
  assignment_count: number;
  whatsapp_count: number;
};

export type ArchiveBatch = {
  id: string;
  created_at: string;
  created_by: string;
  created_by_name: string | null;
  filter: ArchiveFilter & { note?: string };
  enquiry_count: number;
  call_count: number;
  item_count: number;
  purged_at: string | null;
  purged_by_name: string | null;
  purged_enquiries: number | null;
  purged_calls: number | null;
  purged_items: number | null;
  purged_assignments: number | null;
  purged_whatsapp_sends: number | null;
  purged_import_rows: number | null;
  /** How many of the batch's enquiries are still there to re-export. */
  remaining: number;
};

/** Undefined rather than null, so the SQL defaults apply. */
function args(f: ArchiveFilter, archived: boolean) {
  return {
    p_created_from: f.createdFrom || undefined,
    p_created_to: f.createdTo || undefined,
    p_statuses: f.statuses.length ? f.statuses : undefined,
    p_type: f.type || undefined,
    p_lost_reason: f.lostReason || undefined,
    p_archived: archived,
  };
}

export async function loadArchivePreview(
  filter: ArchiveFilter,
  archived: boolean,
): Promise<{ preview: ArchivePreview; error: string | null }> {
  const zero: ArchivePreview = {
    enquiry_count: 0,
    call_count: 0,
    item_count: 0,
    assignment_count: 0,
    whatsapp_count: 0,
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "archive_preview",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args(filter, archived) as any,
  );
  if (error) return { preview: zero, error: error.message };
  const row = (data as unknown as ArchivePreview[] | null)?.[0];
  return { preview: row ?? zero, error: null };
}

/**
 * Every id the filter matches. Paged: a year of enquiries is far past the
 * 1,000-row cap, and the cap is silent — archiving 1,000 of 4,000 while
 * reporting success is exactly the failure this whole screen must not have.
 */
export async function loadArchiveIds(
  filter: ArchiveFilter,
  archived: boolean,
): Promise<{ ids: number[]; error: string | null; truncated?: boolean }> {
  const supabase = await createClient();
  const { rows, error, truncated } = await fetchAllRows<{ enquiry_id: number }>(
    (from, to) =>
      supabase
        .rpc(
          "archive_ids",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args(filter, archived) as any,
        )
        .range(from, to) as never,
  );
  if (error) return { ids: [], error };
  return { ids: rows.map((r) => r.enquiry_id), error: null, truncated };
}

export async function loadArchiveBatches(): Promise<{
  batches: ArchiveBatch[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("archive_batches")
    .select(
      `id, created_at, created_by, filter, enquiry_count, call_count, item_count,
       purged_at, purged_enquiries, purged_calls, purged_items,
       purged_assignments, purged_whatsapp_sends, purged_import_rows,
       creator:profiles!archive_batches_created_by_fkey ( full_name ),
       purger:profiles!archive_batches_purged_by_fkey ( full_name )`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return { batches: [], error: error.message };

  // How much of each batch survives, so the log can say whether "re-export"
  // will actually produce anything.
  const batches = await Promise.all(
    (data ?? []).map(async (b) => {
      const { count } = await supabase
        .from("enquiries")
        .select("*", { count: "exact", head: true })
        .eq("archive_batch_id", b.id);
      return {
        id: b.id,
        created_at: b.created_at,
        created_by: b.created_by,
        created_by_name:
          (b.creator as { full_name: string | null } | null)?.full_name ?? null,
        filter: b.filter as ArchiveBatch["filter"],
        enquiry_count: b.enquiry_count,
        call_count: b.call_count,
        item_count: b.item_count,
        purged_at: b.purged_at,
        purged_by_name:
          (b.purger as { full_name: string | null } | null)?.full_name ?? null,
        purged_enquiries: b.purged_enquiries,
        purged_calls: b.purged_calls,
        purged_items: b.purged_items,
        purged_assignments: b.purged_assignments,
        purged_whatsapp_sends: b.purged_whatsapp_sends,
        purged_import_rows: b.purged_import_rows,
        remaining: count ?? 0,
      };
    }),
  );

  return { batches, error: null };
}

export type { CloseReason };
