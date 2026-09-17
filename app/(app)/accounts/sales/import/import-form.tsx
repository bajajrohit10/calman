"use client";

import { useActionState, useState } from "react";

import { Button, ErrorNote, Input, Select, FIELD_LABEL, cx } from "@/components/ui";
import {
  previewImport, commitImport, EMPTY_PREVIEW, EMPTY_COMMIT,
  type ImportPreview, type CommitResult,
} from "./actions";

const Count = ({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) => (
  <div className="rounded-md border border-line bg-surface px-2.5 py-1.5">
    <div className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">{label}</div>
    <div className={cx("text-[15px] tabular-nums",
      tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink")}>
      {value}
    </div>
  </div>
);

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [month, setMonth] = useState("");
  const [tab, setTab] = useState("");
  const [preview, previewAction, previewing] =
    useActionState<ImportPreview, FormData>(previewImport, EMPTY_PREVIEW);
  const [commit, commitAction, committing] =
    useActionState<CommitResult, FormData>(commitImport, EMPTY_COMMIT);

  const effectiveMonth = month || preview.modalMonth || "";
  const blockedByPaid = (preview.existingMonth?.paid ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <form action={previewAction} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Workbook (.xlsx)</span>
            <input
              type="file" name="file" accept=".xlsx" required
              data-testid="import-file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[12.5px] text-ink-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-surface file:px-2 file:py-1 file:text-[12.5px] file:text-ink"
            />
          </label>
          {preview.tabs.length > 1 ? (
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Tab</span>
              <Select name="tab" value={tab || preview.tab || ""}
                      onChange={(e) => setTab(e.target.value)}
                      className="w-[190px]" data-testid="import-tab">
                {preview.tabs.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Month</span>
            <Input type="month" name="month" value={effectiveMonth}
                   onChange={(e) => setMonth(e.target.value)}
                   className="w-[160px]" data-testid="import-month" />
          </label>
          <Button type="submit" disabled={previewing || !file} data-testid="import-preview">
            {previewing ? "Reading…" : "Preview"}
          </Button>
        </div>

        {preview.error ? (
          <ErrorNote>
            <span data-testid="import-error">{preview.error}</span>
          </ErrorNote>
        ) : null}

        {preview.ok ? (
          <div className="flex flex-col gap-3" data-testid="import-preview-panel">
            <div className="flex flex-wrap gap-2">
              <Count label="Rows" value={preview.totals.lines} />
              <Count label="Draft" value={preview.totals.draft} />
              <Count label="Cancelled" value={preview.totals.cancelled} />
              <Count label="Deferred" value={preview.totals.deferred} />
              <Count label="No vendor" value={preview.totals.vendorNull}
                     tone={preview.totals.vendorNull ? "warn" : undefined} />
              <Count label="No rate" value={preview.totals.rateNone}
                     tone={preview.totals.rateNone ? "warn" : undefined} />
              <Count label="Already imported" value={preview.totals.alreadyImported}
                     tone={preview.totals.alreadyImported ? "danger" : undefined} />
              <Count label="Conversions" value={preview.totals.conversions} />
            </div>

            <div className="grid gap-3 text-[12px] text-ink-2 sm:grid-cols-2">
              <div>
                <div className={FIELD_LABEL}>Order dates by month</div>
                <div data-testid="import-months">
                  {Object.entries(preview.monthCounts).sort().map(([m, n]) => (
                    <div key={m}>{m} — {n}{m === preview.modalMonth ? " (modal)" : ""}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>Marker rows dropped</div>
                <div data-testid="import-markers">
                  {Object.entries(preview.droppedMarkers).map(([k, n]) => (
                    <div key={k}>{k} — {n}{preview.pairedMarkers[k] ? ` (${preview.pairedMarkers[k]} paired)` : ""}</div>
                  ))}
                  {Object.keys(preview.droppedMarkers).length === 0 ? "none" : null}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>Centre arm split</div>
                <div data-testid="import-arms">
                  {Object.entries(preview.centerArmSplit).map(([k, n]) => (
                    <div key={k}>{k} — {n}</div>
                  ))}
                  {Object.keys(preview.centerArmSplit).length === 0 ? "none" : null}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>Vendor unresolved</div>
                <div data-testid="import-vendor-null">
                  {Object.entries(preview.vendorNullNames).map(([k, n]) => (
                    <div key={k}>{k} — {n}</div>
                  ))}
                  {Object.keys(preview.vendorNullNames).length === 0 ? "none" : null}
                </div>
              </div>
            </div>

            {preview.existingMonth ? (
              <div className={cx("rounded-md px-2.5 py-2 text-[12.5px]",
                blockedByPaid ? "border border-danger bg-danger-soft text-danger"
                              : "border border-warn bg-warn-soft text-ink")}
                   data-testid="import-existing">
                {blockedByPaid
                  ? `This month already has ${preview.existingMonth.paid} paid line(s). Import refused — paid rows are the record of money that left.`
                  : `This month already holds ${preview.existingMonth.rows} rows and none are paid. Committing replaces that batch.`}
              </div>
            ) : null}
          </div>
        ) : null}
      </form>

      {preview.ok && !blockedByPaid ? (
        <form action={commitAction} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-accent bg-sunk p-3">
          {/* The file goes up again so what is committed is what the file says. */}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Confirm the same file</span>
            <input type="file" name="file" accept=".xlsx" required
                   data-testid="commit-file"
                   className="text-[12.5px] text-ink-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-surface file:px-2 file:py-1 file:text-[12.5px] file:text-ink" />
          </label>
          <input type="hidden" name="month" value={effectiveMonth} />
          <input type="hidden" name="tab" value={tab || preview.tab || ""} />
          {preview.existingMonth ? <input type="hidden" name="replace" value="1" /> : null}
          <Button type="submit" disabled={committing} data-testid="import-commit">
            {committing ? "Importing…" : `Import ${effectiveMonth}`}
          </Button>
        </form>
      ) : null}

      {commit.error ? (
        <ErrorNote><span data-testid="commit-error">{commit.error}</span></ErrorNote>
      ) : null}

      {commit.ok ? (
        <div className="rounded-lg border border-accent bg-sunk p-3 text-[12.5px] text-ink"
             data-testid="commit-result">
          Imported {commit.inserted} line(s) into {commit.month}.
          {commit.superseded ? ` ${commit.superseded} deferred row(s) superseded.` : ""}
          {commit.skipped.length ? ` ${commit.skipped.length} duplicate order(s) skipped.` : ""}
          {commit.conversions ? ` ${commit.conversions} conversion note(s).` : ""}
          {commit.skipped.length ? (
            <div className="mt-1 text-[11.5px] text-ink-3" data-testid="commit-skipped">
              Skipped: {commit.skipped.slice(0, 20).map((s) => `${s.order_id} (${s.status})`).join(", ")}
              {commit.skipped.length > 20 ? ` and ${commit.skipped.length - 20} more` : ""}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
