"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loadPanelEnquiry, type PanelPayload } from "@/components/call-log/actions";
import { CallLogPanel, type PanelMasters } from "@/components/call-log/panel";
import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import {
  ENQUIRY_STATUS_LABELS,
  ISSUE_CATEGORY_LABELS,
  OUTCOME_SHORT,
  type CallOutcome,
  type EnquiryStatus,
  type IssueCategory,
} from "@/lib/enquiry-labels";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";

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

const SORTABLE = [
  { key: "reminder", label: "Reminder" },
  { key: "last_call", label: "Last call" },
  { key: "created", label: "Raised" },
] as const;

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
    if (row.status === "closed") return;
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
        <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                <th className="px-2 py-[7px]">Student</th>
                <th className="px-2 py-[7px]">Status</th>
                <th className="px-2 py-[7px]">Issue</th>
                {SORTABLE.map((col) => {
                  const active = sort === col.key;
                  const nextDir = active && dir === "asc" ? "desc" : "asc";
                  return (
                    <th key={col.key} className="px-2 py-[7px]">
                      <Link
                        href={withParam({ sort: col.key, dir: nextDir, page: "" })}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {col.label}
                        {active ? <span>{dir === "asc" ? "▲" : "▼"}</span> : null}
                      </Link>
                    </th>
                  );
                })}
                <th className="px-2 py-[7px]">Last note</th>
                <th className="px-2 py-[7px]">Last called by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.enquiry_id}
                  onClick={() => openRow(r)}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    r.status !== "closed" && "cursor-pointer hover:bg-sunk/40",
                    // Escalated means somebody outside this screen is waiting.
                    r.status === "escalated" && "bg-accent-soft/40",
                    open?.id === r.enquiry_id && "bg-accent-soft/60",
                  )}
                >
                  <td className="px-2 py-[5px]">
                    <span className="text-ink">{r.student_name || "No name"}</span>
                    <Link
                      href={`/students/${r.mobile}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-1.5 tabular-nums text-ink-3 underline-offset-2 hover:underline"
                    >
                      {formatMobile(r.mobile)}
                    </Link>
                  </td>
                  <td className="px-2 py-[5px]">
                    <Badge
                      dot
                      tone={
                        r.status === "escalated"
                          ? "accent"
                          : r.status === "closed"
                            ? "neutral"
                            : "info"
                      }
                    >
                      {r.status === "closed" ? "Resolved" : ENQUIRY_STATUS_LABELS[r.status]}
                    </Badge>
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">
                    {r.issue_category ? ISSUE_CATEGORY_LABELS[r.issue_category] : "—"}
                  </td>
                  <td className="px-2 py-[5px] whitespace-nowrap tabular-nums text-ink-2">
                    {r.reminder_date ? formatDate(r.reminder_date) : "—"}
                  </td>
                  <td className="px-2 py-[5px] whitespace-nowrap text-ink-3">
                    {r.last_outcome ? (
                      <>
                        {OUTCOME_SHORT[r.last_outcome]} {formatDate(r.last_call_at)}
                      </>
                    ) : (
                      "never"
                    )}
                  </td>
                  <td className="px-2 py-[5px] whitespace-nowrap text-ink-3">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="max-w-[280px] truncate px-2 py-[5px] text-ink-3">
                    {r.last_discussion ?? "—"}
                  </td>
                  <td className="px-2 py-[5px] text-ink-3">{r.last_caller_name ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink-3">
                    No tickets match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

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
