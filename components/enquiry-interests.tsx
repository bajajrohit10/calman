"use client";

import { useState, useTransition } from "react";

import { addEnquiryItems } from "@/components/call-log/actions";
import {
  InterestLineRows,
  blankLine,
  isComplete,
  type ItemMasters,
  type NewLine,
} from "@/components/interest-lines";
import { Badge, Button, ErrorNote } from "@/components/ui";
import { ITEM_STATUS_LABELS, type ItemStatus } from "@/lib/enquiry-labels";

export type InterestItem = {
  id: string;
  status: ItemStatus;
  label: string;
  orderId: string | null;
  amount: number | null;
};

/**
 * The Interests block on the student history card (§5.2).
 *
 * Open, with a line ready to type into, for the same reason the call panel's
 * is: the teacher on a lead is what §7 is built from, and the moment it is
 * learned is the moment it should be recorded — not the next time somebody
 * happens to open a call panel.
 *
 * Lines added here are always `open`. Marking one won is a purchase, and a
 * purchase is recorded by logging the call that made it.
 */
export function EnquiryInterests({
  enquiryId,
  items,
  masters,
  onSaved,
}: {
  enquiryId: number;
  items: InterestItem[];
  /** Omit to render read-only. */
  masters?: ItemMasters;
  onSaved?: () => void;
}) {
  const [lines, setLines] = useState<NewLine[]>(() => [blankLine()]);
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const filled = lines.filter(isComplete);

  function save() {
    setResult(null);
    start(async () => {
      const res = await addEnquiryItems({
        enquiryId,
        lines: filled.map((l) => ({
          teacherId: l.teacherId,
          courseId: l.courseId,
          subjectId: l.subjectId || null,
          contentId: l.contentId || null,
        })),
      });
      setResult(res);
      if (!res.error) {
        setLines([blankLine()]);
        onSaved?.();
      }
    });
  }

  return (
    <section className="border-t border-line px-4 py-2.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
        Interests ({items.length})
      </h4>

      {items.length ? (
        <ul className="mt-1 text-[12.5px]">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 py-1">
              <span className="text-ink">{item.label}</span>
              <Badge
                tone={
                  item.status === "won" ? "ok" : item.status === "open" ? "info" : "neutral"
                }
              >
                {ITEM_STATUS_LABELS[item.status]}
              </Badge>
              {item.orderId ? (
                <span className="text-[11.5px] text-ink-3">order {item.orderId}</span>
              ) : null}
              {item.amount != null ? (
                <span className="text-[11.5px] tabular-nums text-ink-3">₹{item.amount}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : masters ? null : (
        <p className="mt-1 text-[12.5px] italic text-ink-3">
          No teacher or subject recorded yet.
        </p>
      )}

      {masters ? (
        <div className="mt-2 rounded-md border border-line bg-sunk/30 px-3 py-2.5">
          {items.length === 0 ? (
            <p className="mb-2 text-[12px] text-ink-3">
              Nothing recorded yet. Add the teacher this student asked about.
            </p>
          ) : null}

          <InterestLineRows lines={lines} masters={masters} onChange={setLines} />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={pending || filled.length === 0}
              onClick={save}
            >
              {pending ? "Saving…" : "Save interests"}
            </Button>
            {result?.ok ? (
              <span className="text-[12px] text-ok" role="status">
                {result.ok}
              </span>
            ) : null}
          </div>

          {result?.error ? (
            <div className="mt-2">
              <ErrorNote>{result.error}</ErrorNote>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
