import Link from "next/link";

import { Badge, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime, hoursAgoIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

import { loadHeldCheckouts } from "./actions";
import { Importer } from "./importer";
import { ImportTabs, MissingNumbers } from "./missing-numbers";

export const metadata = { title: "Import · Calman" };

type Params = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireUser();
  const sp = await searchParams;
  const older = (Array.isArray(sp.older) ? sp.older[0] : sp.older) === "1";
  const tab =
    (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) === "missing" ? "missing" : "upload";
  const supabase = await createClient();

  // §31.4. A day's worth by default: the list is a working tool for "did this
  // morning's file go in", not an archive, and a page of last month's uploads
  // is between the reader and the one batch they came to check. The older ones
  // are a click away, and none of them is ever deleted — a batch backs its
  // rows' resolve-later actions and the audit trail that says where a lead
  // came from.
  const since = hoursAgoIso(24);

  const [sources, terms, batches, recentCount, held] = await Promise.all([
    supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
    (() => {
      const q = supabase
        .from("import_batches")
        .select("id, filename, uploaded_at, total_rows, uploader:profiles ( full_name )")
        .order("uploaded_at", { ascending: false })
        .limit(older ? 100 : 25);
      return older ? q : q.gte("uploaded_at", since);
    })(),
    supabase
      .from("import_batches")
      .select("*", { count: "exact", head: true })
      .gte("uploaded_at", since),
    // §55.3. Loaded on both tabs: the badge on the Upload tab has to say how
    // many are waiting, which means knowing before anybody clicks.
    loadHeldCheckouts(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Import"
        description="Bring a day's leads in from a CSV or XLSX, one review pass before anything is written."
      />

      <ImportTabs active={tab} heldCount={held.rows.length} />

      {tab === "missing" ? (
        <MissingNumbers rows={held.rows} />
      ) : (
        <Importer masters={{ sources: sources.data ?? [], terms: terms.data ?? [] }} />
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h2 className="text-[13px] font-semibold text-ink">
            {older ? "All imports" : "Imports in the last 24 hours"}
          </h2>
          <Link
            href={older ? "/import" : "/import?older=1"}
            className="text-[12px] text-ink-2 underline-offset-2 hover:underline"
          >
            {older
              ? `← Just the last 24 hours (${recentCount.count ?? 0})`
              : "Show older"}
          </Link>
        </div>
        {batches.data?.length ? (
          <ul className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
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
            {older ? "No imports yet." : "Nothing imported in the last 24 hours."}
          </p>
        )}
      </section>
    </div>
  );
}
