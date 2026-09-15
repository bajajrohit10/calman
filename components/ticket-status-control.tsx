"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setTicketStatus } from "@/app/(app)/tickets/status-actions";
import { Button, Input, Select, cx } from "@/components/ui";
import { TICKET_STATES, type EnquiryStatus, type TicketState } from "@/lib/enquiry-labels";

/**
 * Moving a ticket from its row (§44b.1).
 *
 * Two of the five states need a second answer before they mean anything —
 * Escalated needs a name and Resolved needs a line saying how — so picking
 * them opens the question rather than acting on the pick. The other three are
 * one gesture, because they are one fact.
 *
 * The write goes through the same action the call window uses, so the move is
 * a call and ticket_events records it like any other.
 */
export function TicketStatusControl({
  enquiryId,
  status,
  roster,
  onDone,
}: {
  enquiryId: number;
  status: EnquiryStatus;
  roster: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<TicketState | null>(null);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function move(next: TicketState, extra?: { escalatedTo?: string; note?: string }) {
    setError(null);
    start(async () => {
      const res = await setTicketStatus({
        enquiryId,
        status: next,
        escalatedTo: extra?.escalatedTo,
        note: extra?.note,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setAsking(null);
      setWho("");
      setNote("");
      onDone?.();
      router.refresh();
    });
  }

  function choose(next: string) {
    if (!next || next === status) return;
    const state = next as TicketState;
    if (state === "escalated" || state === "closed") {
      setAsking(state);
      return;
    }
    move(state);
  }

  return (
    <span
      className="flex flex-col gap-1"
      // The row itself opens the call panel; none of this should.
      onClick={(e) => e.stopPropagation()}
    >
      <Select
        aria-label="Change status"
        className="h-[24px] w-[150px] text-[11.5px]"
        value={status}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
      >
        {TICKET_STATES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>

      {asking === "escalated" ? (
        <span className="flex items-center gap-1">
          <Select
            aria-label="Escalate to"
            autoFocus
            className="h-[24px] w-[130px] text-[11.5px]"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">Who…</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !who}
            onClick={() => move("escalated", { escalatedTo: who })}
          >
            Go
          </Button>
          <button
            type="button"
            className="text-[11px] text-ink-3 hover:text-ink"
            onClick={() => setAsking(null)}
          >
            cancel
          </button>
        </span>
      ) : null}

      {asking === "closed" ? (
        <span className="flex items-center gap-1">
          <Input
            aria-label="How it was resolved"
            autoFocus
            placeholder="How was it resolved?"
            className="h-[24px] w-[190px] text-[11.5px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) move("closed", { note });
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !note.trim()}
            onClick={() => move("closed", { note })}
          >
            Resolve
          </Button>
          <button
            type="button"
            className="text-[11px] text-ink-3 hover:text-ink"
            onClick={() => setAsking(null)}
          >
            cancel
          </button>
        </span>
      ) : null}

      {error ? (
        <span className={cx("text-[11px] font-medium text-danger")} role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
