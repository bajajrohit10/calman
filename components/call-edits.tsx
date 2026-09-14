"use client";

import { useState, useTransition } from "react";

import { loadCallEdits, type CallEdit } from "@/components/call-log/actions";
import { cx } from "@/components/ui";
import { OUTCOME_LABELS, type CallOutcome } from "@/lib/enquiry-labels";
import { formatDateTime } from "@/lib/format";

/** The words the history uses for each field it can show a change to. */
const FIELD_LABELS: Record<string, string> = {
  outcome: "Outcome",
  discussion: "Note",
  next_follow_up_date: "Follow-up",
  importance: "Importance",
  lead_verification: "Lead verification",
  issue_category: "Issue category",
};

/** A note is a paragraph; showing both versions in full would bury the row. */
function shorten(value: string | null): string {
  if (value == null || value === "") return "empty";
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

function display(field: string, value: string | null): string {
  if (value == null || value === "") return "empty";
  if (field === "outcome") {
    return OUTCOME_LABELS[value as CallOutcome] ?? value;
  }
  return shorten(value);
}

/**
 * The Edits column (§35.3).
 *
 * Nothing at all for a call nobody has touched, which is nearly all of them —
 * a column of "no edits" would be a column of noise. An edited call gets a
 * marker that opens its history, and the history is fetched only then: the
 * table needs to know *whether* on every row and *what* on almost none.
 *
 * Outcome changes are listed first because the outcome is the field that moves
 * the lead — the rest is detail about the same correction.
 */
export function CallEdits({ callId, edits }: { callId: number; edits: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CallEdit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!edits) return null;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (rows) return;
    start(async () => {
      const res = await loadCallEdits(callId);
      if (res.error) setError(res.error);
      else setRows(res.edits ?? []);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={cx(
          "rounded-full border px-1.5 py-[1px] text-[10.5px] whitespace-nowrap",
          open
            ? "border-accent bg-accent-soft text-accent"
            : "border-line-2 bg-surface-2 text-ink-3 hover:border-ink-3 hover:text-ink",
        )}
      >
        Edited{edits > 1 ? ` ×${edits}` : ""}
      </button>

      {open ? (
        <div className="w-[230px] rounded-md border border-line bg-sunk/40 px-2 py-1.5">
          {pending && !rows ? (
            <p className="text-[11px] text-ink-3">Loading…</p>
          ) : error ? (
            <p className="text-[11px] text-danger">{error}</p>
          ) : rows && rows.length ? (
            <ul className="flex flex-col gap-1">
              {rows.map((e, i) => (
                <li key={i} className="text-[11px] leading-snug text-ink-2">
                  <span className="font-medium text-ink">
                    {FIELD_LABELS[e.field] ?? e.field}:
                  </span>{" "}
                  {display(e.field, e.oldValue)} → {display(e.field, e.newValue)}
                  <span className="block text-ink-3">
                    by {e.actorName} · {formatDateTime(e.changedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-3">No recorded changes.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
