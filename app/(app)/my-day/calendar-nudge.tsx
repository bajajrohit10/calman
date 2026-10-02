"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";

import { answerCalendarNudge } from "./calendar-actions";

export type PendingNudge = {
  date: string;
  kind: "sunday" | "holiday" | "worked";
  name: string | null;
  /** §79: which of the two questions about this date is being asked. */
  answerKind?: "planned" | "worked";
  /** §79: how many calls were logged on a closed day, for the 'worked' kind. */
  calls?: number | null;
};

/**
 * §54.2(c). "Is the team working on Sunday the 20th?"
 *
 * Asked on My Day because that is the screen a manager has open, and asked in
 * the window where the answer still changes something: from the Thursday, when
 * "+3 days" first starts landing on that Sunday, until the day itself.
 *
 * Two buttons and no third state. Yes opens the day; No closes the question
 * without opening it, which is also what silence means — the difference is
 * only that No stops it being asked again.
 *
 * §79 adds the question asked the other way round: the team worked a day the
 * calendar calls shut, so the record and the calendar disagree about a day that
 * has already happened. Same two buttons, same one-time behaviour — what differs
 * is that this one is reporting a fact rather than asking a plan, so it says how
 * many calls there were and leads with them.
 */
export function CalendarNudge({ nudge }: { nudge: PendingNudge }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function answer(working: boolean) {
    setError(null);
    start(async () => {
      const res = await answerCalendarNudge({
        date: nudge.date,
        working,
        kind: nudge.answerKind ?? "planned",
      });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const worked = nudge.kind === "worked";
  const question = worked
    ? `${nudge.calls ? `${nudge.calls} calls were` : "Calls were"} logged on `
      + `${formatDate(nudge.date)} (${nudge.name ?? "holiday"}) — mark it a working day?`
    : nudge.kind === "sunday"
      ? `Is the team working on Sunday ${formatDate(nudge.date)}?`
      : `${nudge.name ?? "A holiday"} falls on ${formatDate(nudge.date)} — is the team working?`;

  return (
    <div
      role="status"
      data-testid={worked ? "worked-holiday-nudge" : "calendar-nudge"}
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warn/50",
        "bg-warn-soft/40 px-3 py-2.5 shadow-card",
      )}
    >
      <span className="text-[13px] font-medium text-ink">{question}</span>
      <span className="text-[11.5px] text-ink-2">
        {worked
          ? "The calendar still counts it closed, so reports and follow-up dates skip it."
          : "Follow-up dates skip it until somebody says otherwise."}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Button size="sm" variant="primary" disabled={pending} onClick={() => answer(true)}>
          {worked ? "Mark it working" : "Yes, working"}
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => answer(false)}>
          No
        </Button>
      </span>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}
