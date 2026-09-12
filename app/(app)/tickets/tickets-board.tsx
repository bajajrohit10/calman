"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loadPanelEnquiry, type PanelPayload } from "@/components/call-log/actions";
import { CallLogPanel, type PanelMasters } from "@/components/call-log/panel";
import { TicketTable } from "@/components/ticket-table";
import { Button, ErrorNote, Input, Select } from "@/components/ui";
import {
  ISSUE_CATEGORY_LABELS,
  type CallOutcome,
  type EnquiryStatus,
  type IssueCategory,
} from "@/lib/enquiry-labels";

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
  includeResolved,
  counsellorName,
  roster,
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
  includeResolved: boolean;
  counsellorName: string | null;
  roster: { id: string; name: string }[];
  masters: PanelMasters;
  selected: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<PanelPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  function openRow(row: TicketRow) {
    // Closed tickets open too (§26.1). Reopening one is done from the panel,
    // and a row you cannot click is a row you cannot reopen.
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

  return (
    <div className="flex flex-col gap-3">
      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 p-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Status
            </span>
            <Select name="status" defaultValue={selected.status}>
              <option value="">Open and escalated</option>
              <option value="open">Open</option>
              <option value="escalated">Escalated</option>
              <option value="closed">Resolved</option>
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
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              name="resolved"
              value="1"
              defaultChecked={includeResolved}
            />
            Show resolved
          </label>
          <Link
            href="/tickets"
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            Clear
          </Link>
          <span className="ml-auto text-[12px] text-ink-3">
            {total} ticket{total === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      <div className="flex flex-col gap-3 xl:flex-row">
        <TicketTable
          rows={rows}
          openId={open?.id ?? null}
          onOpen={(row) => openRow(row as TicketRow)}
          sort={sort}
          dir={dir}
          hrefFor={(col, nextDir) => withParam({ sort: col, dir: nextDir, page: "" })}
        />

        {open ? (
          <aside className="w-full shrink-0 xl:w-[520px]">
            <div className="sticky top-4">
              <CallLogPanel
                enquiry={open}
                masters={masters}
                counsellorName={counsellorName}
                onSaved={() => {
                  setOpen(null);
                  router.refresh();
                }}
                onCancel={() => setOpen(null)}
              />
            </div>
          </aside>
        ) : null}
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
