"use client";

import Link from "next/link";

import { StudentLink } from "@/components/student-link";

import { Badge, cx } from "@/components/ui";
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

/**
 * The columns the Tickets screen sorts by. My Day renders the same table
 * without them: its two lists are already ordered — reminder date for the ones
 * still waiting, call time for the ones done — and a sort control there would
 * only be a way to lose that order.
 */
export const TICKET_SORTABLE = [
  { key: "reminder", label: "Reminder" },
  { key: "last_call", label: "Last call" },
  { key: "created", label: "Raised" },
] as const;

/** Everything the table draws. Both callers' row types satisfy this. */
export type TicketTableRow = {
  enquiry_id: number;
  mobile: string;
  student_name: string | null;
  status: EnquiryStatus;
  reminder_date: string | null;
  created_at: string;
  last_call_at: string | null;
  last_outcome: CallOutcome | null;
  last_discussion: string | null;
  issue_category: IssueCategory | null;
  last_caller_name: string | null;
};

/**
 * The ticket list, shared by the Tickets screen (§5.11) and the Tickets tab on
 * My Day. One table, so the two cannot drift into showing different columns
 * for the same row, and one definition of what a closed ticket does when you
 * click it: nothing.
 */
export function TicketTable({
  rows,
  openId,
  onOpen,
  sort,
  dir,
  hrefFor,
  empty = "No tickets match these filters.",
}: {
  rows: TicketTableRow[];
  openId: number | null;
  onOpen: (row: TicketTableRow) => void;
  /** Pass all three to get sortable headers; omit for a plain header row. */
  sort?: string;
  dir?: "asc" | "desc";
  hrefFor?: (col: string, nextDir: "asc" | "desc") => string;
  empty?: string;
}) {
  const sortable = Boolean(hrefFor && sort && dir);

  return (
    <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            <th className="px-2 py-[7px]">Student</th>
            <th className="px-2 py-[7px]">Status</th>
            <th className="px-2 py-[7px]">Issue</th>
            {TICKET_SORTABLE.map((col) => {
              if (!sortable) {
                return (
                  <th key={col.key} className="px-2 py-[7px]">
                    {col.label}
                  </th>
                );
              }
              const active = sort === col.key;
              const nextDir = active && dir === "asc" ? "desc" : "asc";
              return (
                <th key={col.key} className="px-2 py-[7px]">
                  <Link
                    href={hrefFor!(col.key, nextDir)}
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
              onClick={() => onOpen(r)}
              className={cx(
                "border-b border-line last:border-b-0",
                "cursor-pointer",
                // Escalated means somebody outside this screen is waiting.
                r.status === "escalated" && "bg-accent-soft/40",
                openId === r.enquiry_id &&
                  "bg-accent-pick shadow-[inset_3px_0_0_var(--accent)]",
              )}
            >
              <td className="px-2 py-[5px]">
                <span className="text-ink">{r.student_name || "No name"}</span>
                <StudentLink
                  mobile={r.mobile}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-1.5 tabular-nums text-ink-3 underline-offset-2 hover:underline"
                >
                  {formatMobile(r.mobile)}
                </StudentLink>
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
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
