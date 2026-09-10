import Link from "next/link";

import { Badge, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

import { Importer } from "./importer";

export const metadata = { title: "Import · Calman" };

export default async function Page() {
  await requireUser();
  const supabase = await createClient();

  const [sources, terms, batches] = await Promise.all([
    supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
    supabase
      .from("import_batches")
      .select("id, filename, uploaded_at, total_rows, uploader:profiles ( full_name )")
      .order("uploaded_at", { ascending: false })
      .limit(25),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Import"
        description="Bring a day's leads in from a CSV or XLSX, one review pass before anything is written."
      />

      <Importer masters={{ sources: sources.data ?? [], terms: terms.data ?? [] }} />

      <section>
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Recent imports</h2>
        {batches.data?.length ? (
          <ul className="overflow-hidden rounded-lg border border-line bg-surface">
            {batches.data.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
              >
                <Link
                  href={`/import/${b.id}`}
                  className="text-[13px] font-medium text-ink underline-offset-2 hover:underline"
                >
                  {b.filename || "Untitled file"}
                </Link>
                <Badge tone="neutral">{b.total_rows ?? 0} rows</Badge>
                <span className="text-[12px] text-ink-3">
                  {formatDateTime(b.uploaded_at)}
                </span>
                <span className="text-[12px] text-ink-3">
                  {(b.uploader as { full_name: string | null } | null)?.full_name ?? "unknown"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line-2 px-4 py-6 text-center text-[12.5px] text-ink-3">
            No imports yet.
          </p>
        )}
      </section>
    </div>
  );
}
