"use client";

import { useState, useTransition } from "react";

import {
  updateEnquiryDetails,
  updateTicketFields,
} from "@/components/call-log/actions";
import { TeacherPicker } from "@/components/interest-lines";
import { Button, ErrorNote, Input, Select } from "@/components/ui";
import {
  ISSUE_CATEGORY_LABELS,
  type Importance,
  type IssueCategory,
  type LeadVerification,
} from "@/lib/enquiry-labels";

export type DetailMaster = { id: string; name: string };
export type DetailMasters = {
  terms: DetailMaster[];
  sources: DetailMaster[];
  /** §47.2: only a ticket shows the teacher box, so only it needs the list. */
  teachers?: DetailMaster[];
};

/**
 * Term, source and the student's name — the details a counsellor corrects
 * after a call rather than decides during one.
 *
 * Importance and lead verification used to live here too and no longer do
 * (Brief 16). They are graded on the call itself, so they sit next to the
 * outcome in the panel. This editor still sends their current values back
 * untouched, so the action's shape is unchanged and a save here cannot
 * silently clear a grading made in the panel.
 *
 * Its own client component so it can sit both inside the call panel and on the
 * student history page — history renders on the server for /students/[mobile]
 * and in the browser for Quick Add, and neither can hold this state itself.
 *
 * What may actually be written is decided by RLS: the column grant on
 * enquiries covers these fields, and students covers `name`. Nothing here
 * re-implements that check.
 */
export function EnquiryDetailsEditor({
  enquiryId,
  masters,
  initial,
  onSaved,
  isTicket = false,
}: {
  enquiryId: number;
  masters: DetailMasters;
  initial: {
    studentName: string | null;
    importance: Importance | null;
    termId: string | null;
    sourceId: string | null;
    leadVerification: LeadVerification | null;
    /** §47.2. Only read on a ticket. */
    orderId?: string | null;
    productText?: string | null;
    teacherId?: string | null;
    issueCategory?: IssueCategory | null;
  };
  onSaved?: () => void;
  /**
   * §47.2. A ticket carries four more fields worth correcting — the order it
   * is about, what was bought, whose material it is and what went wrong — and
   * they are written through a different door from the three above.
   */
  isTicket?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    studentName: initial.studentName ?? "",
    importance: (initial.importance ?? "") as Importance | "",
    termId: initial.termId ?? "",
    sourceId: initial.sourceId ?? "",
    leadVerification: (initial.leadVerification ?? "") as LeadVerification | "",
  });
  const [ticket, setTicket] = useState({
    orderId: initial.orderId ?? "",
    productText: initial.productText ?? "",
    teacherId: initial.teacherId ?? "",
    issueCategory: (initial.issueCategory ?? "") as IssueCategory | "",
  });
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setResult(null);
    start(async () => {
      // §47.2. Two writes because they go through two doors — the column grant
      // on enquiries for the first, a security-definer function for the
      // second. The ticket half goes first: if it is refused, the counsellor
      // sees that rather than a success message for the other three.
      if (isTicket) {
        const t = await updateTicketFields({
          enquiryId,
          orderId: ticket.orderId,
          product: ticket.productText,
          teacherId: ticket.teacherId || null,
          issueCategory: ticket.issueCategory,
        });
        if (t.error) {
          setResult(t);
          return;
        }
      }
      const res = await updateEnquiryDetails({
        enquiryId,
        importance: values.importance,
        termId: values.termId || null,
        sourceId: values.sourceId || null,
        leadVerification: values.leadVerification,
        studentName: values.studentName,
      });
      setResult(res);
      if (!res.error) onSaved?.();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
      >
        › Edit enquiry details
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
      >
        ▾ Edit enquiry details
      </button>

      <div className="mt-2 grid gap-2 rounded-md border border-line bg-sunk/30 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Student name
          </span>
          <Input
            aria-label="Student name"
            value={values.studentName}
            onChange={(e) => setValues((v) => ({ ...v, studentName: e.target.value }))}
            placeholder="Not recorded"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Term
          </span>
          <Select
            aria-label="Term"
            value={values.termId}
            onChange={(e) => setValues((v) => ({ ...v, termId: e.target.value }))}
          >
            <option value="">—</option>
            {masters.terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Source
          </span>
          <Select
            aria-label="Source"
            value={values.sourceId}
            onChange={(e) => setValues((v) => ({ ...v, sourceId: e.target.value }))}
          >
            <option value="">—</option>
            {masters.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>

        {/* §47.2. A ticket's own four, beside the three every enquiry has.
            The institute is not among them: it follows the teacher through
            teachers.institute_id, so writing it would be storing a second
            answer to a question that already has one. */}
        {isTicket ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Order ID
              </span>
              <Input
                aria-label="Order ID"
                value={ticket.orderId}
                onChange={(e) => setTicket((v) => ({ ...v, orderId: e.target.value }))}
                placeholder="Not recorded"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Product
              </span>
              <Input
                aria-label="Product"
                value={ticket.productText}
                onChange={(e) =>
                  setTicket((v) => ({ ...v, productText: e.target.value }))
                }
                placeholder="Not recorded"
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Teacher
              </span>
              <TeacherPicker
                teachers={masters.teachers ?? []}
                value={ticket.teacherId}
                onChange={(id) => setTicket((v) => ({ ...v, teacherId: id }))}
              />
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Issue category
              </span>
              <Select
                aria-label="Issue category"
                value={ticket.issueCategory}
                onChange={(e) =>
                  setTicket((v) => ({
                    ...v,
                    issueCategory: e.target.value as IssueCategory | "",
                  }))
                }
              >
                <option value="">—</option>
                {Object.entries(ISSUE_CATEGORY_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : null}

        <div className="flex items-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={save}
          >
            {pending ? "Saving…" : "Save details"}
          </Button>
          {result?.ok ? (
            <span className="pb-1.5 text-[11.5px] text-ok" role="status">
              {result.ok}
            </span>
          ) : null}
        </div>

        {result?.error ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorNote>{result.error}</ErrorNote>
          </div>
        ) : null}
      </div>
    </div>
  );
}
