"use client";

import { useState, useTransition } from "react";

import { loadPanelEnquiry, type PanelPayload } from "@/components/call-log/actions";
import { CallLogPanel, type PanelMasters } from "@/components/call-log/panel";
import { StudentLink } from "@/components/student-link";
import { Badge, Button, ErrorNote, cx } from "@/components/ui";
import { useConfirmLeave } from "@/components/unsaved-guard";
import {
  ENQUIRY_STATUS_LABELS,
  ISSUE_CATEGORY_LABELS,
  type EnquiryStatus,
  type IssueCategory,
} from "@/lib/enquiry-labels";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";

export type AfterSaleRow = {
  enquiry_id: number;
  student_id: string;
  mobile: string;
  student_name: string | null;
  status: EnquiryStatus;
  issue_category: IssueCategory | null;
  reminder_date: string | null;
  last_discussion: string | null;
  last_caller_name: string | null;
  last_call_date: string | null;
  call_count: number;
  re_enquired_at: string | null;
  is_overdue: boolean;
  never_called: boolean;
  total_count: number;
};

/**
 * The after-sale half of New Calls (§33.6).
 *
 * Two kinds of row, and the difference matters more than any filter: a ticket
 * nobody has called yet, and one that has been called before and whose number
 * has just come in again. The second is the one a counsellor needs warning
 * about — picking it up means continuing a conversation somebody else started,
 * so it carries the last remark and says plainly that it is an existing ticket.
 *
 * No Take button. Nothing assigns a ticket: the queue is shared, and claiming
 * one would be inventing an idea of ownership the rest of the after-sale side
 * does not have. Logging the call is how you take it.
 */
export function AfterSaleBoard({
  rows,
  total,
  error,
  masters,
  counsellorName,
}: {
  rows: AfterSaleRow[];
  total: number;
  error: string | null;
  masters: PanelMasters;
  counsellorName: string | null;
}) {
  const [open, setOpen] = useState<PanelPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const confirmLeave = useConfirmLeave();

  function openTicket(enquiryId: number) {
    void confirmLeave().then((ok) => {
      if (!ok) return;
      setLoadError(null);
      start(async () => {
        const res = await loadPanelEnquiry(enquiryId);
        if (res.error || !res.enquiry) {
          setLoadError(res.error ?? "Could not open that ticket.");
          return;
        }
        setOpen(res.enquiry);
      });
    });
  }

  if (open) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="self-start text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
        >
          ← Back to After Sale
        </button>
        <CallLogPanel
          enquiry={open}
          masters={masters}
          counsellorName={counsellorName}
          onSaved={() => {
            setOpen(null);
            // The row has been called, so it leaves this queue; the server
            // component re-reads on the next navigation.
            window.location.reload();
          }}
          onCancel={() => setOpen(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-1.5 py-[7px]">Student</th>
              <th className="px-1.5 py-[7px]">Status</th>
              <th className="px-1.5 py-[7px]">Issue</th>
              <th className="px-1.5 py-[7px]">Reminder</th>
              <th className="px-1.5 py-[7px]">Last remark</th>
              <th className="px-1.5 py-[7px] text-right">Call</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.enquiry_id}
                className={cx(
                  "border-b border-line last:border-b-0",
                  r.status === "escalated" && "bg-accent-soft/40",
                )}
              >
                <td className="px-1.5 py-[5px]">
                  <span className="text-ink">{r.student_name || "No name"}</span>
                  <StudentLink
                    mobile={r.mobile}
                    className="ml-1.5 tabular-nums text-ink-3 underline-offset-2 hover:underline"
                  >
                    {formatMobile(r.mobile)}
                  </StudentLink>
                </td>
                <td className="px-1.5 py-[5px]">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge dot tone={r.status === "escalated" ? "accent" : "info"}>
                      {ENQUIRY_STATUS_LABELS[r.status]}
                    </Badge>
                    {/* §33.6. The warning that matters: this is not a fresh
                        complaint, it is one somebody is already mid-way
                        through. */}
                    {!r.never_called ? (
                      <Badge tone="warn">Existing ticket</Badge>
                    ) : null}
                  </span>
                </td>
                <td className="px-1.5 py-[5px] text-ink-2">
                  {r.issue_category ? ISSUE_CATEGORY_LABELS[r.issue_category] : "—"}
                </td>
                <td className="px-1.5 py-[5px] whitespace-nowrap tabular-nums">
                  <span className={r.is_overdue ? "text-danger" : "text-ink-2"}>
                    {r.reminder_date ? formatDate(r.reminder_date) : "—"}
                  </span>
                  {r.is_overdue ? (
                    <span className="ml-1.5">
                      <Badge tone="danger">Overdue</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="max-w-[340px] px-1.5 py-[5px] text-ink-3">
                  {r.last_discussion ? (
                    <span className="block truncate" title={r.last_discussion}>
                      {r.last_discussion}
                    </span>
                  ) : (
                    "never called"
                  )}
                  {r.last_caller_name ? (
                    <span className="block text-[11px] text-ink-3">
                      {r.last_caller_name}
                      {r.last_call_date ? ` · ${formatDate(r.last_call_date)}` : ""}
                    </span>
                  ) : null}
                </td>
                <td className="px-1.5 py-[5px] text-right">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={pending}
                    onClick={() => openTicket(r.enquiry_id)}
                  >
                    Log call
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-3">
                  No after-sale work waiting — every open ticket has been called
                  today.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-ink-3">
        {total} waiting. Tickets are never assigned, so there is nothing to take
        — logging the call is how you pick one up.
      </p>
    </div>
  );
}
