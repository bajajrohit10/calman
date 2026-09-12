"use client";

import { useState, useTransition } from "react";

import { Button, ErrorNote, Input, Select, Textarea, cx } from "@/components/ui";
import {
  IMPORTANCE_LABELS,
  LEAD_VERIFICATION_LABELS,
  OUTCOME_LABELS,
  outcomeTakesDate,
  outcomesFor,
  type CallOutcome,
  type EnquiryType,
  type Importance,
  type LeadVerification,
} from "@/lib/enquiry-labels";
import { istToday } from "@/lib/format";

import { editCall } from "./actions";

/**
 * Correcting a call that was logged wrongly (§29.4).
 *
 * Counsellors log a hundred of these a day between sentences, and the wrong
 * outcome picked in a hurry is not a typo — it moves the lead's status, its
 * next date and where it turns up tomorrow. The alternative to an edit is a
 * second call row that never happened, which is worse: the reports count
 * calls.
 *
 * Who may: the database decides. calls_update already allows an admin
 * anything and everybody else their own, today only. This asks the same
 * question client-side purely to decide whether to offer the button — a
 * refusal still comes back from the write if the two ever disagree.
 */
export function canEditCall(
  call: { calledBy: string; callDate: string },
  viewerId: string | null | undefined,
  viewerIsAdmin: boolean | undefined,
): boolean {
  if (viewerIsAdmin) return true;
  if (!viewerId) return false;
  return call.calledBy === viewerId && call.callDate === istToday();
}

export function EditCallForm({
  call,
  type,
  importance,
  leadVerification,
  onDone,
}: {
  call: {
    id: number;
    outcome: CallOutcome;
    discussion: string | null;
    nextFollowUpDate: string | null;
  };
  type: EnquiryType;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  onDone: (changed: boolean) => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome>(call.outcome);
  const [discussion, setDiscussion] = useState(call.discussion ?? "");
  const [followUp, setFollowUp] = useState(call.nextFollowUpDate ?? "");
  const [grade, setGrade] = useState<Importance | "">(importance ?? "");
  const [lead, setLead] = useState<LeadVerification | "">(leadVerification ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await editCall({
        callId: call.id,
        outcome,
        discussion,
        nextFollowUpDate: outcomeTakesDate(outcome) ? followUp || null : null,
        importance: grade,
        leadVerification: lead,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      onDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent-soft/30 p-2.5">
      <Textarea
        rows={2}
        value={discussion}
        onChange={(e) => setDiscussion(e.target.value)}
        placeholder="What was actually said."
      />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Outcome
          </span>
          <Select
            aria-label="Corrected outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CallOutcome)}
          >
            {outcomesFor(type).map((o) => (
              <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
            ))}
          </Select>
        </label>
        <label className={cx("flex-col gap-1", outcomeTakesDate(outcome) ? "flex" : "hidden")}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Follow-up
          </span>
          <Input
            type="date"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
        </label>
        {type === "purchase" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Importance
              </span>
              <Select
                aria-label="Corrected importance"
                value={grade}
                onChange={(e) => setGrade(e.target.value as Importance | "")}
              >
                <option value="">Not graded</option>
                {Object.entries(IMPORTANCE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Lead verification
              </span>
              <Select
                aria-label="Corrected lead verification"
                value={lead}
                onChange={(e) => setLead(e.target.value as LeadVerification | "")}
              >
                <option value="">Not checked</option>
                {Object.entries(LEAD_VERIFICATION_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </label>
          </>
        ) : null}
        <Button size="sm" variant="primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save change"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}
