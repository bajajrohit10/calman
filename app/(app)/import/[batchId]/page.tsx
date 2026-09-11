import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { fetchAllRows } from "@/lib/paged";
import { createClient } from "@/lib/supabase/server";

import { BatchReport, type ReportRow } from "./report";

export const metadata = { title: "Import report · Calman" };

/** §5.7: "The import report is kept; skipped rows stay actionable." */
export default async function Page({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireUser();
  const { batchId } = await params;
  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, filename, uploaded_at, total_rows, warnings, uploader:profiles ( full_name )")
    .eq("id", batchId)
    .maybeSingle();

  if (!batch) notFound();

  // Paged: a 3,000-row import would otherwise render its first thousand rows
  // and, worse, compute its summary counts from that same truncated array.
  const { rows, error: rowsError, truncated } = await fetchAllRows<ReportRow>(
    (from, to) =>
      supabase
        .from("import_rows")
        .select(
          "id, row_number, normalised_mobile, outcome, skip_reason, enquiry_id, resolved_at, raw",
        )
        .eq("batch_id", batchId)
        .order("row_number")
        .range(from, to) as never,
  );

  // Counted by the database rather than derived from the array, so the summary
  // is right even if the listing above ever hits its ceiling.
  const OUTCOMES = [
    "imported",
    "re_enquired",
    "duplicate_new_enquiry",
    "dismissed",
    "skipped",
    // Nothing writes this any more (§10.1), but historical batches carry it.
    "duplicate_updated",
  ] as const;
  const counted = await Promise.all(
    OUTCOMES.map(async (outcome) => {
      const { count } = await supabase
        .from("import_rows")
        .select("*", { count: "exact", head: true })
        .eq("batch_id", batchId)
        .eq("outcome", outcome);
      return [outcome, count ?? 0] as const;
    }),
  );
  const counts = Object.fromEntries(counted);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={batch.filename || "Import report"}
        description={`${batch.total_rows ?? 0} rows, uploaded ${formatDateTime(batch.uploaded_at)} by ${
          (batch.uploader as { full_name: string | null } | null)?.full_name ?? "unknown"
        }.`}
      />

      <div>
        <Link
          href="/import"
          className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
        >
          ← All imports
        </Link>
      </div>

      <BatchReport
        rows={rows}
        counts={counts}
        warnings={(batch.warnings ?? []) as string[]}
        note={
          rowsError
            ? `Could not load every row: ${rowsError}`
            : truncated
              ? "This listing stopped at its ceiling; the counts above are still exact."
              : null
        }
      />
    </div>
  );
}
