import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
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
    .select("id, filename, uploaded_at, total_rows, uploader:profiles ( full_name )")
    .eq("id", batchId)
    .maybeSingle();

  if (!batch) notFound();

  const { data: rows } = await supabase
    .from("import_rows")
    .select(
      "id, row_number, normalised_mobile, outcome, skip_reason, enquiry_id, resolved_at, raw",
    )
    .eq("batch_id", batchId)
    .order("row_number");

  const counts = (rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

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

      <BatchReport rows={(rows ?? []) as ReportRow[]} counts={counts} />
    </div>
  );
}
