"use client";

import { useState, useTransition } from "react";

import {
  addEnquiryItems,
  removeEnquiryItem,
  updateEnquiryItem,
} from "@/components/call-log/actions";
import {
  InterestLineRows,
  SavedLineRows,
  blankLine,
  hasDetail,
  type ItemMasters,
  type NewLine,
} from "@/components/interest-lines";
import { Button, ErrorNote } from "@/components/ui";
import { type ItemStatus } from "@/lib/enquiry-labels";

export type InterestItem = {
  id: string;
  status: ItemStatus;
  /** §49.2: parser-filled and unconfirmed. */
  isAuto?: boolean;
  teacherId: string | null;
  courseId: string | null;
  subjectId: string | null;
  contentId: string | null;
  teacher: string | null;
  course: string | null;
  subject: string | null;
  content: string | null;
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
 * §39.3 makes the lines already saved editable here too. This is the screen
 * somebody opens *after* the call, when they have the order in front of them
 * and can see that the content is wrong — the one place a correction is most
 * likely to be made, and until now the one place that could only add.
 *
 * Lines added here are always `open`. Marking one won is a purchase, and a
 * purchase is recorded by logging the call that made it.
 */
export function EnquiryInterests({
  enquiryId,
  items,
  masters,
  onSaved,
  bare = false,
}: {
  enquiryId: number;
  items: InterestItem[];
  /** Omit to render read-only. */
  masters?: ItemMasters;
  onSaved?: () => void;
  /**
   * Drop the section heading and border. Set when this sits inside a collapsed
   * drawer that already has both, and whose summary has already named it.
   */
  bare?: boolean;
}) {
  const [lines, setLines] = useState<NewLine[]>(() => [blankLine()]);
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filled = lines.filter(hasDetail);

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

  function editLine(id: string, line: NewLine) {
    setResult(null);
    setBusy(id);
    start(async () => {
      const res = await updateEnquiryItem({
        itemId: id,
        teacherId: line.teacherId || null,
        courseId: line.courseId || null,
        subjectId: line.subjectId || null,
        contentId: line.contentId || null,
      });
      setBusy(null);
      setResult(res);
      if (!res.error) onSaved?.();
    });
  }

  function dropLine(id: string) {
    setResult(null);
    setBusy(id);
    start(async () => {
      const res = await removeEnquiryItem({ itemId: id });
      setBusy(null);
      setResult(res);
      if (!res.error) onSaved?.();
    });
  }

  return (
    <section className={bare ? "" : "border-t border-line px-4 py-2.5"}>
      {bare ? null : (
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
          Interests ({items.length})
        </h4>
      )}

      {items.length ? (
        <div className="mt-1">
          <SavedLineRows
            lines={items}
            masters={masters ?? EMPTY_MASTERS}
            onSave={editLine}
            onRemove={dropLine}
            busy={busy}
            readOnly={!masters}
            extra={(item) => (
              <>
                {item.orderId ? (
                  <span className="text-[11.5px] text-ink-3">order {item.orderId}</span>
                ) : null}
                {item.amount != null ? (
                  <span className="text-[11.5px] tabular-nums text-ink-3">
                    ₹{item.amount}
                  </span>
                ) : null}
              </>
            )}
          />
        </div>
      ) : masters ? null : (
        <p className="mt-1 text-[12.5px] italic text-ink-3">
          No teacher or subject recorded yet.
        </p>
      )}

      {masters ? (
        <div className="mt-2 rounded-md border border-line bg-sunk/30 px-3 py-2.5">
          {items.length === 0 ? (
            <p className="mb-2 text-[12px] text-ink-3">
              Nothing recorded yet. Add what this student asked about — a course on
              its own is worth keeping.
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

/** Read-only rendering never opens an editor, so the lists are never read. */
const EMPTY_MASTERS: ItemMasters = {
  teachers: [],
  courses: [],
  subjects: [],
  contents: [],
};
