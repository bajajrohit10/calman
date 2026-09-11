"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import type { ArchiveBatch, ArchiveFilter, ArchivePreview } from "@/lib/archive";
import {
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_TYPE_LABELS,
  LOST_REASON_LABELS,
  type EnquiryStatus,
} from "@/lib/enquiry-labels";
import type { ExportResult } from "@/lib/export-actions";
import { formatDate, formatDateTime } from "@/lib/format";

import {
  archiveBatch,
  buildArchiveExport,
  purgeArchived,
  reExportBatch,
} from "./actions";

const STATUSES: EnquiryStatus[] = ["open", "won", "lost", "closed"];

/**
 * §9. Two modes over one filter form: archive acts on live enquiries, purge on
 * already-archived ones. Splitting them into two screens would have meant two
 * filter forms that could disagree about what "2026, lost, competitor" means.
 */
export function DataManagement({
  mode,
  filter,
  preview,
  error,
  batches,
  isSuperAdmin,
}: {
  mode: "archive" | "purge";
  filter: ArchiveFilter;
  preview: ArchivePreview;
  error: string | null;
  batches: ArchiveBatch[];
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [pending, start] = useTransition();

  const purging = mode === "purge";
  const n = preview.enquiry_count;

  /** Builds the file in the browser, exactly as every other export does. */
  async function downloadFrom(res: ExportResult): Promise<boolean> {
    if (res.error || !res.rows || !res.columns) {
      setResult({ error: res.error ?? "Could not build the export." });
      return false;
    }
    const table = (
      cols: { key: string; label: string }[],
      rows: Record<string, unknown>[],
    ) => ({
      header: cols.map((c) => c.label),
      body: rows.map((row) =>
        cols.map((c) => {
          const v = row[c.key];
          return v === null || v === undefined ? "" : String(v);
        }),
      ),
    });

    const main = table(res.columns, res.rows as unknown as Record<string, unknown>[]);
    const extras = (res.extraSheets ?? []).map((s) => ({
      name: s.name,
      ...table(s.columns, s.rows),
    }));

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const sheet = (name: string, h: string[], b: string[][]) => {
      const ws = wb.addWorksheet(name);
      ws.addRow(h);
      ws.getRow(1).font = { bold: true };
      for (const r of b) ws.addRow(r);
      ws.columns.forEach((col, i) => {
        col.width = Math.min(40, Math.max(12, h[i].length + 4));
      });
    };
    sheet("Enquiries", main.header, main.body);
    for (const extra of extras) sheet(extra.name, extra.header, extra.body);

    const buffer = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${res.filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  function exportAndArchive() {
    setResult(null);
    start(async () => {
      const res = await buildArchiveExport(filter, false);
      const ok = await downloadFrom(res);
      // Archive only once the file actually exists. If this never runs,
      // nothing was archived and the operator simply tries again.
      if (!ok || !res.ids) return;
      const marked = await archiveBatch(res.ids, filter);
      setResult(marked);
      if (!marked.error) router.refresh();
    });
  }

  function reExport(batchId: string) {
    setResult(null);
    start(async () => {
      const res = await reExportBatch(batchId);
      await downloadFrom(res);
    });
  }

  function runPurge() {
    setResult(null);
    start(async () => {
      const res = await purgeArchived(filter, n);
      setResult(res);
      setConfirmText("");
      if (!res.error) router.refresh();
    });
  }

  const confirmed = confirmText.trim() === String(n);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1">
        {(["archive", "purge"] as const).map((m) => (
          <Link
            key={m}
            href={`/settings/data?mode=${m}`}
            aria-current={mode === m ? "page" : undefined}
            className={cx(
              "rounded-md px-3 py-1.5 text-[12.5px]",
              mode === m
                ? "bg-accent-soft font-medium text-accent"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {m === "archive" ? "Export & archive" : "Purge archived"}
          </Link>
        ))}
      </div>

      <form method="GET" className="rounded-lg border border-line bg-surface p-3">
        <input type="hidden" name="mode" value={mode} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Enquiry created from">
            <Input type="date" name="createdFrom" defaultValue={filter.createdFrom ?? ""} />
          </Field>
          <Field label="Enquiry created to">
            <Input type="date" name="createdTo" defaultValue={filter.createdTo ?? ""} />
          </Field>
          <Field label="Type">
            <Select name="type" defaultValue={filter.type ?? ""}>
              <option value="">Any</option>
              {Object.entries(ENQUIRY_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lost reason (optional)">
            <Select name="lostReason" defaultValue={filter.lostReason ?? ""}>
              <option value="">Any</option>
              {Object.entries(LOST_REASON_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
              Status (none ticked means any)
            </span>
            <div className="mt-1 flex flex-wrap gap-3">
              {STATUSES.map((s) => (
                <label
                  key={s}
                  className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2"
                >
                  <input
                    type="checkbox"
                    name="statuses"
                    value={s}
                    defaultChecked={filter.statuses.includes(s)}
                  />
                  {ENQUIRY_STATUS_LABELS[s]}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="sm">
            Count matching
          </Button>
          <Link
            href={`/settings/data?mode=${mode}`}
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            Clear
          </Link>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">
          Statuses are submitted as repeated values; the page reads them comma-joined
          too, so a hand-built link works.
        </p>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <section className="rounded-lg border border-line bg-surface p-3">
        <h2 className="text-[13px] font-semibold text-ink">
          {purging ? "Archived and matching" : "Live and matching"}
        </h2>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
          <Count label="Enquiries" value={n} strong />
          <Count label="Calls" value={preview.call_count} />
          <Count label="Interests" value={preview.item_count} />
          <Count label="Assignments" value={preview.assignment_count} />
          <Count label="WhatsApp sends" value={preview.whatsapp_count} />
        </div>

        {purging ? (
          <div className="mt-3 rounded-md border border-danger/40 bg-danger-soft/30 px-3 py-2.5">
            <p className="text-[12.5px] text-ink">
              Purging deletes these enquiries with their calls, interests, assignments
              and WhatsApp sends. The student records stay. Import rows keep their file
              history with the link cleared. This cannot be undone — the exported
              workbook becomes the only copy.
            </p>
            {!isSuperAdmin ? (
              <p className="mt-2 text-[12.5px] text-danger">
                Only a super admin can purge.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                    Type {n} to confirm
                  </span>
                  <Input
                    className="w-[140px]"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    aria-label="Type the count to confirm"
                    placeholder={String(n)}
                  />
                </label>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={pending || n === 0 || !confirmed}
                  onClick={runPurge}
                >
                  {pending ? "Purging…" : `Purge ${n}`}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending || n === 0}
              onClick={exportAndArchive}
            >
              {pending ? "Exporting…" : `Export & archive ${n}`}
            </Button>
            <span className="text-[11.5px] text-ink-3">
              Downloads a workbook — enquiries on one sheet, every call on a second —
              and only then marks them archived.
            </span>
          </div>
        )}

        {result?.error ? (
          <div className="mt-2">
            <ErrorNote>{result.error}</ErrorNote>
          </div>
        ) : null}
        {result?.ok ? (
          <p className="mt-2 text-[12.5px] text-ok" role="status">
            {result.ok}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-1.5 text-[13px] font-semibold text-ink">Archive log</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Who</th>
                <th className="px-2 py-2">Filter</th>
                <th className="px-2 py-2 text-right">Enquiries</th>
                <th className="px-2 py-2 text-right">Calls</th>
                <th className="px-2 py-2">State</th>
                <th className="px-2 py-2 text-right">Re-export</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-b-0">
                  <td className="px-2 py-1.5 whitespace-nowrap text-ink-3">
                    {formatDateTime(b.created_at)}
                  </td>
                  <td className="px-2 py-1.5 text-ink">{b.created_by_name ?? "unknown"}</td>
                  <td className="max-w-[280px] px-2 py-1.5 text-ink-2">
                    {describe(b.filter)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
                    {b.enquiry_count}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
                    {b.call_count}
                  </td>
                  <td className="px-2 py-1.5">
                    {b.purged_at ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">Purged</Badge>
                        <span className="text-[11.5px] text-ink-3">
                          {formatDateTime(b.purged_at)} by {b.purged_by_name ?? "unknown"}
                          {" · "}
                          {b.purged_enquiries ?? 0} enquiries, {b.purged_calls ?? 0} calls,{" "}
                          {b.purged_items ?? 0} interests, {b.purged_assignments ?? 0}{" "}
                          assignments, {b.purged_whatsapp_sends ?? 0} WhatsApp
                        </span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Badge tone="info">Archived</Badge>
                        <span className="text-[11.5px] text-ink-3">
                          {b.remaining} still held
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending || b.remaining === 0}
                      onClick={() => reExport(b.id)}
                    >
                      Download
                    </Button>
                  </td>
                </tr>
              ))}
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-ink-3">
                    Nothing has been archived yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-3">
          The log keeps the filter, the counts and who ran it — not the file. Until a
          batch is purged the rows are still in the database, so Download rebuilds the
          workbook from them and is always current. After a purge there is nothing left
          to rebuild, and the copy downloaded at the time is the record.
        </p>
      </section>
    </div>
  );
}

function describe(f: ArchiveFilter): string {
  const bits: string[] = [];
  if (f.createdFrom || f.createdTo) {
    bits.push(
      `created ${f.createdFrom ? formatDate(f.createdFrom) : "any"} – ${
        f.createdTo ? formatDate(f.createdTo) : "any"
      }`,
    );
  }
  if (f.statuses?.length) {
    bits.push(f.statuses.map((s) => ENQUIRY_STATUS_LABELS[s] ?? s).join(" / "));
  }
  if (f.type) bits.push(ENQUIRY_TYPE_LABELS[f.type] ?? f.type);
  if (f.lostReason) bits.push(LOST_REASON_LABELS[f.lostReason] ?? f.lostReason);
  return bits.join(" · ") || "everything";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}

function Count({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <span className="flex gap-1.5">
      <span className="text-ink-3">{label}</span>
      <span className={cx("tabular-nums", strong ? "font-semibold text-ink" : "text-ink-2")}>
        {value}
      </span>
    </span>
  );
}
