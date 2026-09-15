"use client";

import Link from "next/link";

import { StudentLink } from "@/components/student-link";

import { Badge, cx } from "@/components/ui";
import {
  ISSUE_CATEGORY_LABELS,
  OUTCOME_SHORT,
  ticketStateLabel,
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
  { key: "created", label: "Opened" },
  { key: "reminder", label: "Due" },
  { key: "last_call", label: "Last call" },
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
  /** §33.4: the reminder has passed and nobody has closed it. */
  is_overdue?: boolean;
  /** §44.1/§44.4: what the ticket is chased with. */
  order_id?: string | null;
  teacher_name?: string | null;
  institute_name?: string | null;
  escalated_to?: string | null;
  escalated_to_name?: string | null;
  /** §44.3: whole days since it was opened, counted by the database. */
  open_days?: number | null;
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
      <table className="w-full min-w-[1100px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            <th className="px-1.5 py-[7px]">Student</th>
            <th className="px-1.5 py-[7px]">Order ID</th>
            <th className="px-1.5 py-[7px]">Institute</th>
            <th className="px-1.5 py-[7px]">Teacher</th>
            <th className="px-1.5 py-[7px]">Issue</th>
            <th className="px-1.5 py-[7px]">Status</th>
            <th className="px-1.5 py-[7px]">Escalated to</th>
            {TICKET_SORTABLE.map((col) => {
              if (!sortable) {
                return (
                  <th key={col.key} className="px-1.5 py-[7px]">
                    {col.label}
                  </th>
                );
              }
              const active = sort === col.key;
              const nextDir = active && dir === "asc" ? "desc" : "asc";
              return (
                <th key={col.key} className="px-1.5 py-[7px]">
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
            <th className="px-1.5 py-[7px]">Last called by</th>
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
              <td className="px-1.5 py-[5px]">
                <span className="text-ink">{r.student_name || "No name"}</span>
                <StudentLink
                  mobile={r.mobile}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-1.5 tabular-nums text-ink-3 underline-offset-2 hover:underline"
                >
                  {formatMobile(r.mobile)}
                </StudentLink>
              </td>
              {/* §44.4. Order ID first after the student: it is what an
                  institute asks for and what a counsellor reads out. */}
              <td className="px-1.5 py-[5px] whitespace-nowrap tabular-nums text-ink-2">
                {r.order_id || "—"}
              </td>
              <td className="px-1.5 py-[5px] text-ink-2">{r.institute_name || "—"}</td>
              <td className="px-1.5 py-[5px] text-ink-2">{r.teacher_name || "—"}</td>
              <td className="px-1.5 py-[5px] text-ink-2">
                {r.issue_category ? ISSUE_CATEGORY_LABELS[r.issue_category] : "—"}
              </td>
              <td className="px-1.5 py-[5px]">
                <Badge
                  dot
                  tone={
                    r.status === "escalated"
                      ? "accent"
                      : r.status === "closed"
                        ? "neutral"
                        : r.status === "pending_institute"
                          ? "warn"
                          : "info"
                  }
                >
                  {ticketStateLabel(r.status)}
                </Badge>
              </td>
              {/* §44.4. Highlighted when set, because a ticket on somebody
                  else's desk is the one row on this screen you do not act on
                  yourself. */}
              <td className="px-1.5 py-[5px]">
                {r.escalated_to_name ? (
                  <Badge tone="accent">{r.escalated_to_name}</Badge>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </td>
              {/* §44.3. Opened is immutable and on its own is a date nobody
                  does arithmetic on at a glance, so the row does it: the age
                  of a complaint is the thing that decides which to pick up. */}
              <td className="px-1.5 py-[5px] whitespace-nowrap text-ink-3">
                {formatDate(r.created_at)}
                {r.open_days != null ? (
                  <span
                    className={cx(
                      "ml-1.5",
                      r.open_days >= 7 ? "font-medium text-warn" : "text-ink-3",
                    )}
                  >
                    {r.open_days} day{r.open_days === 1 ? "" : "s"}
                  </span>
                ) : null}
              </td>
              <td className="flex items-center gap-1.5 px-1.5 py-[5px] whitespace-nowrap tabular-nums">
                {/* §33.4. The reminder is shown on every row, and once it has
                    passed the row says so — a ticket carries itself forward
                    rather than falling off a day, so "late" is the only thing
                    that distinguishes one that has been waiting. */}
                <span className={r.is_overdue ? "text-danger" : "text-ink-2"}>
                  {r.reminder_date ? formatDate(r.reminder_date) : "—"}
                </span>
                {r.is_overdue ? (
                  <Badge tone="danger">
                    <span className="whitespace-nowrap">Overdue</span>
                  </Badge>
                ) : null}
              </td>
              <td className="px-1.5 py-[5px] whitespace-nowrap text-ink-3">
                {r.last_outcome ? (
                  <>
                    {OUTCOME_SHORT[r.last_outcome]} {formatDate(r.last_call_at)}
                  </>
                ) : (
                  "never"
                )}
              </td>
              <td className="px-1.5 py-[5px] text-ink-3">{r.last_caller_name ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-3 py-8 text-center text-ink-3">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
