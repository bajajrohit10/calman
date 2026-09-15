"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loadPanelEnquiry, type PanelPayload } from "@/components/call-log/actions";
import { useConfirmLeave } from "@/components/unsaved-guard";
import { CallLogPanel, type PanelMasters } from "@/components/call-log/panel";
import { TicketTable } from "@/components/ticket-table";
import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import {
  ISSUE_CATEGORY_LABELS,
  type CallOutcome,
  type EnquiryStatus,
  type IssueCategory,
} from "@/lib/enquiry-labels";
import { ExportButton } from "@/components/export-button";
import { TICKET_TABS, type TicketTabKey } from "@/lib/ticket-tabs";

export type TicketRow = {
  enquiry_id: number;
  student_id: string;
  mobile: string;
  student_name: string | null;
  status: EnquiryStatus;
  reminder_date: string | null;
  created_at: string;
  last_call_at: string | null;
  last_outcome: CallOutcome | null;
  last_discussion: string | null;
  issue_category: IssueCategory | null;
  order_id: string | null;
  last_caller_id: string | null;
  last_caller_name: string | null;
  call_count: number;
  /** §44.1/§44.3/§44.4: what the ticket carries and how old it is. */
  teacher_name: string | null;
  institute_name: string | null;
  escalated_to: string | null;
  escalated_to_name: string | null;
  open_days: number | null;
  is_overdue: boolean;
  total_count: number;
};

export function TicketsBoard({
  rows,
  total,
  error,
  page,
  pageSize,
  sort,
  dir,
  search,
  state,
  date,
  on,
  counts,
  counsellorName,
  roster,
  institutes,
  masters,
  selected,
}: {
  rows: TicketRow[];
  total: number;
  error: string | null;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  search: string;
  /** §33.3: which of the three the queue is being read in. */
  state: TicketTabKey;
  /** §44b.2: the day the Resolved tab is bound to, carried into the export. */
  date: string;
  /** The day Resolved is counted and listed for. */
  on: string;
  counts: Record<TicketTabKey, number>;
  counsellorName: string | null;
  roster: { id: string; name: string }[];
  /** §44.4: the Institute filter reads the master list, not the tickets. */
  institutes: { id: string; name: string }[];
  masters: PanelMasters;
  selected: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<PanelPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const confirmLeave = useConfirmLeave();
  const [pending, start] = useTransition();

  const pages = Math.max(1, Math.ceil(total / pageSize));

  function withParam(patch: Record<string, string>) {
    const params = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    return `?${params.toString()}`;
  }

  function closeOpen() {
    void confirmLeave().then((ok) => {
      if (ok) setOpen(null);
    });
  }

  async function openRow(row: TicketRow) {
    // Closed tickets open too (§26.1). Reopening one is done from the panel,
    // and a row you cannot click is a row you cannot reopen.
    // §27.4. Swapping rows throws away whatever is typed in the panel just as
    // surely as navigating away does, so it asks the same question first.
    if (!(await confirmLeave())) return;
    setLoadError(null);
    start(async () => {
      const res = await loadPanelEnquiry(row.enquiry_id);
      if (res.error || !res.enquiry) {
        setLoadError(res.error ?? "Could not open that ticket.");
        return;
      }
      setOpen(res.enquiry);
    });
  }

  const tabHref = (key: TicketTabKey) => {
    const params = new URLSearchParams(search);
    params.set("state", key);
    params.delete("page");
    params.delete("status");
    return `/tickets?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* §33.3. Open and Escalated are every unresolved ticket there is,
          whatever the date says; only Resolved is a day's work. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-line-2">
          {TICKET_TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              aria-current={state === t.key ? "page" : undefined}
              className={cx(
                "px-3 py-1 text-[12.5px] transition-colors",
                state === t.key
                  ? "bg-accent font-medium text-accent-ink"
                  : "bg-surface text-ink-2 hover:bg-surface-2",
              )}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums opacity-80">{counts[t.key]}</span>
            </Link>
          ))}
        </div>
        <span className="text-[11.5px] text-ink-3">
          {state === "resolved"
            ? "Closed on the chosen day."
            : "Every unresolved ticket, whatever the date — sorted by reminder, the late ones first."}
        </span>
      </div>
      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 p-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Status
            </span>
            <Select name="status" defaultValue={selected.status}>
              <option value="">Everything unresolved</option>
              {TICKET_TABS.map((t) => (
                <option key={t.key} value={t.status}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Last called by
            </span>
            <Select name="counsellor" defaultValue={selected.counsellor}>
              <option value="">Anyone</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Issue
            </span>
            <Select name="issue" defaultValue={selected.issue}>
              <option value="">Any</option>
              {Object.entries(ISSUE_CATEGORY_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </label>

          {/* §44.4. The four questions a ticket queue is actually read with:
              how old, how late, whose desk, and whose institute. */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Open since
            </span>
            <Select name="openSince" defaultValue={selected.openSince}>
              <option value="">Any age</option>
              <option value="3">More than 3 days</option>
              <option value="7">More than 7 days</option>
              <option value="14">More than 14 days</option>
              <option value="30">More than 30 days</option>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Due
            </span>
            <Select name="due" defaultValue={selected.due}>
              <option value="">Any</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="within">Due within 7 days</option>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Escalated to
            </span>
            <Select name="escalatedTo" defaultValue={selected.escalatedTo}>
              <option value="">Anyone</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Institute
            </span>
            <Select name="institute" defaultValue={selected.institute}>
              <option value="">Any</option>
              {institutes.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Raised from
            </span>
            <Input type="date" name="from" defaultValue={selected.from} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Raised to
            </span>
            <Input type="date" name="to" defaultValue={selected.to} />
          </label>
        </div>

        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />

        <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-sunk px-2.5 py-2.5">
          <Button type="submit" variant="primary" size="sm">
            Apply
          </Button>
          {/* §33.3 replaced the "show resolved" checkbox: resolved is not a
              wider version of the queue, it is a different question with a
              date attached, and a checkbox could not carry the date. */}
          {state === "resolved" ? (
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              Resolved on
              <Input type="date" name="on" defaultValue={on} className="w-[150px]" />
            </label>
          ) : (
            <input type="hidden" name="on" value={on} />
          )}
          <input type="hidden" name="state" value={state} />
          <Link
            href="/tickets"
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            Clear
          </Link>
          <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-3">
            {total} ticket{total === 1 ? "" : "s"}
            {/* §44b.2. Beside the count, because what it exports is what the
                count counts: this sub-tab under these filters, not the page. */}
            <ExportButton source="tickets" state={state} date={date} />
          </span>
        </div>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      {open ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={closeOpen}
            className="self-start text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
          >
            ← Back to the list
          </button>
          <CallLogPanel
            enquiry={open}
            masters={masters}
            counsellorName={counsellorName}
            roster={roster}
            onSaved={() => {
              setOpen(null);
              router.refresh();
            }}
            onCancel={closeOpen}
          />
        </div>
      ) : null}

      <div className={cx("gap-3 xl:flex-row", open ? "hidden" : "flex flex-col")}>
        <TicketTable
          rows={rows}
          openId={open?.id ?? null}
          onOpen={(row) => openRow(row as TicketRow)}
          sort={sort}
          dir={dir}
          hrefFor={(col, nextDir) => withParam({ sort: col, dir: nextDir, page: "" })}
          roster={roster}
        />

      </div>

      {pages > 1 ? (
        <div className="flex items-center gap-3 text-[12.5px] text-ink-2">
          {page > 1 ? (
            <Link href={withParam({ page: String(page - 1) })} className="hover:underline">
              ← Previous
            </Link>
          ) : null}
          <span className="text-ink-3">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={withParam({ page: String(page + 1) })} className="hover:underline">
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}

      {pending ? <p className="text-[12px] text-ink-3">Opening…</p> : null}
      <p className="text-[11.5px] text-ink-3">
        Escalated tickets sort first. A resolved ticket is read-only here — open the
        number&apos;s history for the full record.
      </p>
    </div>
  );
}
