"use client";

import { useActionState, useState } from "react";

import { Button, ErrorNote, Input, FIELD_LABEL, cx } from "@/components/ui";
import { previewPayments, commitPayments } from "./actions";
import {
  EMPTY_PAYMENT_PREVIEW, EMPTY_PAYMENT_COMMIT,
  type PaymentPreview, type PaymentCommitResult,
} from "./import-state";

const Count = ({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "danger" }) => (
  <div className="rounded-md border border-line bg-surface px-2.5 py-1.5">
    <div className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">{label}</div>
    <div className={cx("text-[15px] tabular-nums",
      tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
  </div>
);

export function PaymentImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [month, setMonth] = useState("");
  const [preview, previewAction, previewing] =
    useActionState<PaymentPreview, FormData>(previewPayments, EMPTY_PAYMENT_PREVIEW);
  const [commit, commitAction, committing] =
    useActionState<PaymentCommitResult, FormData>(commitPayments, EMPTY_PAYMENT_COMMIT);

  const effectiveMonth = month || preview.modalMonth || "";

  return (
    <div className="flex flex-col gap-4">
      <form action={previewAction}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Workbook (.xlsx)</span>
            <input type="file" name="file" accept=".xlsx" required data-testid="pay-file"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                   className="text-[12.5px] text-ink-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-surface file:px-2 file:py-1 file:text-[12.5px] file:text-ink" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Month</span>
            <Input type="month" name="month" value={effectiveMonth}
                   onChange={(e) => setMonth(e.target.value)}
                   className="w-[160px]" data-testid="pay-month" />
          </label>
          <Button type="submit" disabled={previewing || !file} data-testid="pay-preview">
            {previewing ? "Reading…" : "Preview"}
          </Button>
        </div>

        {preview.error ? (
          <ErrorNote><span data-testid="pay-error">{preview.error}</span></ErrorNote>
        ) : null}

        {preview.ok ? (
          <div className="flex flex-col gap-3" data-testid="pay-preview-panel">
            <div className="flex flex-wrap gap-2">
              <Count label="Payment tabs" value={preview.totals.paymentTabs} />
              <Count label="Order lists" value={preview.totals.orderListTabs} />
              <Count label="Meta" value={preview.totals.metaTabs} />
              <Count label="No header" value={preview.totals.noHeaderTabs}
                     tone={preview.totals.noHeaderTabs ? "warn" : undefined} />
              <Count label="Payments" value={preview.totals.payments} />
              <Count label="Blank amount" value={preview.totals.blankAmount}
                     tone={preview.totals.blankAmount ? "warn" : undefined} />
              <Count label="Total" value={`₹${preview.totals.amountTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} />
              <Count label="Matched to a sale" value={preview.totals.matched} />
              <Count label="No sale" value={preview.totals.unmatched}
                     tone={preview.totals.unmatched ? "danger" : undefined} />
            </div>

            <div className="grid gap-3 text-[12px] text-ink-2 sm:grid-cols-2">
              <div>
                <div className={FIELD_LABEL}>Payment dates by month</div>
                <div data-testid="pay-months">
                  {Object.entries(preview.monthCounts).sort().map(([m, n]) => (
                    <div key={m}>{m} — {n}{m === preview.modalMonth ? " (modal)" : ""}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>Methods</div>
                <div data-testid="pay-methods">
                  {Object.entries(preview.methods).sort((a, b) => b[1] - a[1])
                    .map(([m, n]) => <div key={m}>{m} — {n}</div>)}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>Tabs skipped: no header row found</div>
                <div data-testid="pay-noheader">
                  {preview.noHeaderTabs.map((t) => (
                    <div key={t.name}>{t.name} — no header row found, {t.rows} rows</div>
                  ))}
                  {preview.noHeaderTabs.length === 0 ? "none" : null}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>Tab names not matching a vendor</div>
                <div data-testid="pay-unresolved">
                  {preview.unresolvedTabs.length
                    ? preview.unresolvedTabs.join(", ")
                    : "none"}
                  <span className="mt-1 block text-[11px] text-ink-3">
                    Payments still match by order id; the tab name is only how we
                    know whose money an unmatched payment is.
                  </span>
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className={FIELD_LABEL}>Balance notes carried in the sheet</div>
                <div data-testid="pay-notes">
                  {preview.balanceNotes.map((b, i) => (
                    <div key={i}>tab {b.tab} carries note: {b.note}</div>
                  ))}
                  {preview.balanceNotes.length === 0 ? "none" : null}
                  <span className="mt-1 block text-[11px] text-ink-3">
                    Shown, not imported — the ledger is a later brief.
                  </span>
                </div>
              </div>
              {preview.duplicateOrderIds.length ? (
                <div className="sm:col-span-2">
                  <div className={FIELD_LABEL}>Orders paid from more than one tab</div>
                  <div data-testid="pay-dupes">
                    {preview.duplicateOrderIds.map((d) => (
                      <div key={d.order_id}>{d.order_id} — {d.tabs.join(", ")}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {preview.existingMonth ? (
              <div className="rounded-md border border-warn bg-warn-soft px-2.5 py-2 text-[12.5px] text-ink"
                   data-testid="pay-existing">
                This month already holds {preview.existingMonth.rows} payments.
                Committing replaces that batch.
              </div>
            ) : null}
          </div>
        ) : null}
      </form>

      {preview.ok ? (
        <form action={commitAction}
              className="flex flex-wrap items-center gap-2.5 rounded-lg border border-accent bg-sunk p-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Confirm the same file</span>
            <input type="file" name="file" accept=".xlsx" required data-testid="pay-commit-file"
                   className="text-[12.5px] text-ink-2 file:mr-2 file:rounded-md file:border file:border-line-2 file:bg-surface file:px-2 file:py-1 file:text-[12.5px] file:text-ink" />
          </label>
          <input type="hidden" name="month" value={effectiveMonth} />
          {preview.existingMonth ? <input type="hidden" name="replace" value="1" /> : null}
          <Button type="submit" disabled={committing} data-testid="pay-commit">
            {committing ? "Importing…" : `Import ${effectiveMonth}`}
          </Button>
        </form>
      ) : null}

      {commit.error ? (
        <ErrorNote><span data-testid="pay-commit-error">{commit.error}</span></ErrorNote>
      ) : null}
      {commit.ok ? (
        <div className="rounded-lg border border-accent bg-sunk p-3 text-[12.5px] text-ink"
             data-testid="pay-commit-result">
          Imported {commit.inserted} payment(s) into {commit.month}.
          {commit.duplicatesDropped ? ` ${commit.duplicatesDropped} duplicate row(s) dropped.` : ""}
        </div>
      ) : null}
    </div>
  );
}
