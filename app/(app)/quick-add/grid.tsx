"use client";

import { useRef, useState, useTransition } from "react";

import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { useUnsavedClaim } from "@/components/unsaved-guard";
import {
  describeNumber,
  dismissQuestion,
  ticketOnly,
  type DuplicateVerdict,
  type NumberStatus,
} from "@/lib/duplicate-rules";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { lookupNumbers } from "@/app/(app)/import/actions";

import { createManyEnquiries, type BulkResult } from "./actions";

type Row = {
  key: string;
  mobile: string;
  name: string;
  sourceId: string;
  status: NumberStatus | null;
  /** Case 5 only: what the counsellor chose. */
  decision: "dismiss" | "add_anyway" | null;
  /**
   * §38.3. Which pipeline this row goes to when the number is already in one.
   * null is the rule's own answer; the counsellor can send it to the other
   * side instead, and a number can end up with one of each.
   */
  pipeline: "ticket" | "purchase" | null;
  checking: boolean;
};

/** How many rows the grid opens with, and how many more it grows by (§30.1). */
const OPENING_ROWS = 10;
const GROW_BY = 5;

let seq = 0;
const blank = (): Row => ({
  key: `r${++seq}`,
  mobile: "",
  name: "",
  sourceId: "",
  status: null,
  decision: null,
  pipeline: null,
  checking: false,
});

const blanks = (n: number) => Array.from({ length: n }, blank);

/**
 * Quick Add (§30.1) under Brief 31's duplicate rules.
 *
 * There is no Update / New enquiry / Dismiss choice any more. §10.1 already
 * says what happens to a number in each of five situations, and offering the
 * choice meant the counsellor had to know those rules better than the system
 * did — twenty times per list, with the wrong answer silently making a second
 * enquiry for somebody who already had one. So the grid states what it found
 * and what it will do, and asks nothing.
 *
 * The one exception is a number somebody has already called today. No rule can
 * decide that: dropping it loses a lead, and pushing it back into the pool
 * sends a colleague to ring somebody who was rung an hour ago. That row does
 * nothing until a person chooses, and nothing else can be saved until they do.
 */
export function QuickAddGrid({
  sources,
  onLogCall,
}: {
  sources: { id: string; name: string }[];
  /** Open the first-call form for a row that has just been saved. */
  onLogCall: (enquiryId: number, mobile: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => blanks(OPENING_ROWS));
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, start] = useTransition();
  const [opening, setOpening] = useState<string | null>(null);
  /** The row whose Dismiss is waiting on a confirmation. */
  const [confirming, setConfirming] = useState<Row | null>(null);
  const grownFor = useRef<string | null>(null);

  const filled = rows.filter((r) => r.mobile.trim());
  const invalid = filled.filter((r) => !isValidMobile(normaliseMobile(r.mobile)));
  /**
   * §35.1. The grid no longer asks what kind of enquiry this is, because the
   * answer is not known until somebody has spoken to them — that is what the
   * first-call form's Purchase/After Sale toggle and the call window's
   * after-sale switch are for. So a row is a purchase lead unless the number
   * already has an open ticket, in which case the arrival belongs to that
   * conversation and the row joins it (§33.5, case 6).
   */
  const verdictOf = (r: Row): DuplicateVerdict | null => {
    if (!r.status) return null;
    const side =
      r.pipeline === "ticket"
        ? "after_sale"
        : r.pipeline === "purchase"
          ? "purchase"
          : ticketOnly(r.status)
            ? "after_sale"
            : "purchase";
    return describeNumber(r.status, side);
  };
  const undecided = filled.filter((r) => {
    const v = verdictOf(r);
    return v?.needsDecision && !r.decision;
  });
  const saveable = filled.filter((r) => isValidMobile(normaliseMobile(r.mobile)));
  const blocked = invalid.length > 0 || undecided.length > 0;
  /**
   * §32.1. "Log call now" belongs to the single-number case — the phone is
   * ringing and this row is the call. With a list on screen it is the wrong
   * offer: it saves every row and then opens one of them, which is not what
   * anybody means by a button on row four. So it appears only while exactly
   * one row has a number in it, and comes back if the others are cleared.
   */
  const lone = filled.length === 1 ? filled[0] : null;

  useUnsavedClaim({
    isDirty: () => filled.length > 0 && !result,
    save: async () => {
      const res = await saveAll();
      return Boolean(res && !res.error);
    },
    discard: () => setRows(blanks(OPENING_ROWS)),
  });

  const patch = (key: string, next: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /** Leaving the mobile cell: normalise, validate, and ask what we know. */
  async function settleMobile(key: string, raw: string) {
    const mobile = normaliseMobile(raw);
    patch(key, { mobile, status: null, decision: null, pipeline: null });
    if (!isValidMobile(mobile)) return;
    patch(key, { checking: true });
    const res = await lookupNumbers([mobile]);
    patch(key, { checking: false, status: res.statuses?.[0] ?? null });
  }

  /**
   * Reaching the last row grows the grid (§30.1).
   *
   * On focus rather than on Tab out of the last cell: a counsellor who clicks
   * into the last row, or shift-tabs backwards into it, has reached the end
   * just as much as one who tabbed there. Guarded by which row last caused a
   * growth so moving between the cells of that row does not add five more
   * each time.
   */
  function reached(key: string) {
    if (rows[rows.length - 1]?.key !== key) return;
    if (grownFor.current === key) return;
    grownFor.current = key;
    setRows((rs) => [...rs, ...blanks(GROW_BY)]);
  }

  /**
   * §32.1. Enter is Log call now, when there is one row to mean it.
   *
   * The single-number box this grid replaced logged a call on Enter, and one
   * row of the grid is that box. With a list on screen Enter does nothing,
   * because "which row?" has no answer and saving the lot on a stray keypress
   * is not a thing to do by accident.
   */
  function onEnter(e: React.KeyboardEvent, row: Row) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (filled.length !== 1 || filled[0].key !== row.key) return;
    if (pending || blocked) return;
    const mobile = normaliseMobile(row.mobile);
    if (!isValidMobile(mobile) || row.checking) return;
    e.preventDefault();
    logCallNow(row);
  }

  /** A pasted column fills rows rather than one cell. */
  function onPaste(e: React.ClipboardEvent, index: number) {
    const text = e.clipboardData.getData("text");
    const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    const keys: string[] = [];
    setRows((rs) => {
      const next = [...rs];
      parts.forEach((p, i) => {
        const at = index + i;
        if (!next[at]) next[at] = blank();
        next[at] = {
          ...next[at],
          mobile: normaliseMobile(p),
          status: null,
          decision: null,
        };
        keys.push(next[at].key);
      });
      if (next[next.length - 1].mobile.trim()) next.push(...blanks(GROW_BY));
      return next;
    });
    parts.forEach((p, i) => {
      const mobile = normaliseMobile(p);
      const key = keys[i];
      if (key && isValidMobile(mobile)) void settleMobile(key, mobile);
    });
  }

  async function saveAll(): Promise<BulkResult | null> {
    if (!saveable.length) {
      setResult({ error: "Nothing to save — every row is empty or invalid." });
      return null;
    }
    if (invalid.length) {
      setResult({
        error: `${invalid.length} number${invalid.length === 1 ? " is" : "s are"} not valid. Fix or clear them first.`,
      });
      return null;
    }
    if (undecided.length) {
      setResult({
        error: `${undecided.length} row${undecided.length === 1 ? "" : "s"} need${undecided.length === 1 ? "s" : ""} a decision — somebody called ${undecided.length === 1 ? "that number" : "those numbers"} today.`,
      });
      return null;
    }
    const res = await createManyEnquiries(
      filled.map((r) => ({
        mobile: r.mobile,
        name: r.name.trim() || null,
        sourceId: r.sourceId || null,
        decision: r.decision,
        pipeline: r.pipeline,
      })),
    );
    setResult(res);
    if (!res.error) {
      setRows(blanks(OPENING_ROWS));
      grownFor.current = null;
    }
    return res;
  }

  /**
   * Save everything, then open the call window on this row.
   *
   * The row is found by position rather than by number: the server returns one
   * result per row in the order they were sent, and two rows can hold the same
   * number.
   */
  function logCallNow(row: Row) {
    const index = filled.findIndex((r) => r.key === row.key);
    if (index < 0) return;
    setOpening(row.key);
    start(async () => {
      const res = await saveAll();
      setOpening(null);
      if (!res || res.error) return;
      const mine = res.rows?.[index];
      if (!mine || mine.enquiryId == null) {
        setResult({
          ...res,
          error:
            mine?.action === "dismissed"
              ? "That row was dismissed, so there is nothing to call."
              : `Saved, but ${row.mobile} could not be opened: ${mine?.reason ?? "no enquiry"}`,
        });
        return;
      }
      onLogCall(mine.enquiryId, mine.mobile);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result && !result.error ? <Summary result={result} /> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[1120px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[40px] px-2 py-[7px] text-right">#</th>
              <th className="w-[150px] px-2 py-[7px]">Mobile</th>
              <th className="w-[200px] px-2 py-[7px]">Name</th>
              <th className="w-[165px] px-2 py-[7px]">Source</th>
              <th className="px-2 py-[7px]">Status</th>
              <th className="w-[120px] px-2 py-[7px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const mobile = normaliseMobile(r.mobile);
              const bad = Boolean(r.mobile.trim()) && !isValidMobile(mobile);
              const verdict = verdictOf(r);
              const waiting = Boolean(verdict?.needsDecision) && !r.decision;
              const ready = Boolean(mobile) && !bad && !r.checking && !waiting;

              return (
                <tr
                  key={r.key}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    bad && "bg-danger-soft/30",
                    waiting && "bg-warn-soft/30",
                  )}
                  onFocus={() => reached(r.key)}
                >
                  <td className="px-2 py-[5px] text-right text-[11px] tabular-nums text-ink-3">
                    {i + 1}
                  </td>
                  <td className="px-2 py-[5px]">
                    <Input
                      value={r.mobile}
                      inputMode="numeric"
                      aria-label={`Mobile, row ${i + 1}`}
                      className={bad ? "border-danger" : undefined}
                      // §32.2. Normalised on the way in, not on the way out,
                      // so what is in the box is always what would be stored:
                      // pasting "+91 98765-43210" from WhatsApp shows
                      // 9876543210 at once rather than on blur.
                      onChange={(e) =>
                        patch(r.key, { mobile: normaliseMobile(e.target.value) })
                      }
                      onBlur={(e) => void settleMobile(r.key, e.target.value)}
                      onPaste={(e) => onPaste(e, i)}
                      onKeyDown={(e) => onEnter(e, r)}
                    />
                  </td>
                  <td className="px-2 py-[5px]">
                    <Input
                      value={r.name}
                      aria-label={`Name, row ${i + 1}`}
                      placeholder="Optional"
                      onChange={(e) => patch(r.key, { name: e.target.value })}
                      onKeyDown={(e) => onEnter(e, r)}
                    />
                  </td>
                  <td className="px-2 py-[5px]">
                    <Select
                      value={r.sourceId}
                      aria-label={`Source, row ${i + 1}`}
                      onChange={(e) => patch(r.key, { sourceId: e.target.value })}
                    >
                      <option value="">—</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-[5px]">
                    <StatusCell
                      row={r}
                      bad={bad}
                      verdict={verdict}
                      onAddAnyway={() => patch(r.key, { decision: "add_anyway" })}
                      onDismiss={() => setConfirming(r)}
                      onPipeline={(p) => patch(r.key, { pipeline: p })}
                    />
                  </td>
                  <td className="px-2 py-[5px]">
                    {ready && lone?.key === r.key ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending || blocked}
                        title="Saves this row and opens the call — Enter does the same"
                        onClick={() => logCallNow(r)}
                      >
                        {opening === r.key ? "Opening…" : "Log call now"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={pending || blocked}
          onClick={() => start(() => void saveAll())}
        >
          {pending && !opening ? "Saving…" : `Save all (${saveable.length})`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRows((rs) => [...rs, ...blanks(GROW_BY)])}
        >
          Add {GROW_BY} rows
        </Button>
        {undecided.length ? (
          <span className="rounded-md border border-warn/40 bg-warn-soft/50 px-2 py-1 text-[12px] font-medium text-warn">
            {undecided.length} row{undecided.length === 1 ? "" : "s"} need
            {undecided.length === 1 ? "s" : ""} a decision
          </span>
        ) : null}
        <span className="text-[11.5px] text-ink-3">
          {invalid.length ? `${invalid.length} invalid · ` : ""}
          What happens to each number is decided by the rules and stated in its
          row.{" "}
          {lone
            ? "One number: Enter or Log call now saves it and opens the call."
            : "Log call now appears when only one row is filled."}
        </span>
      </div>

      {confirming ? (
        <ConfirmDismiss
          mobile={normaliseMobile(confirming.mobile)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            patch(confirming.key, { decision: "dismiss" });
            setConfirming(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One row's status: the sentence, and under it what saving will do.
 *
 * Case 5 is the only one with buttons, and it has no default — a row that
 * quietly defaulted to Dismiss would drop a lead without anybody deciding to,
 * and one that defaulted the other way would send a colleague to make a call
 * that has already been made.
 */
function StatusCell({
  row,
  bad,
  verdict,
  onAddAnyway,
  onDismiss,
  onPipeline,
}: {
  row: Row;
  bad: boolean;
  verdict: DuplicateVerdict | null;
  onAddAnyway: () => void;
  onDismiss: () => void;
  onPipeline: (p: "ticket" | "purchase") => void;
}) {
  if (bad) {
    return <span className="text-[12px] font-medium text-danger">Not a valid number</span>;
  }
  if (row.checking) return <span className="text-[12px] text-ink-3">checking…</span>;
  if (!row.mobile.trim()) return <span className="text-[12px] text-ink-3">—</span>;

  if (!verdict) return <span className="text-[12px] text-ink-3">—</span>;

  const tone =
    verdict.tone === "ok"
      ? "text-ok"
      : verdict.tone === "warn"
        ? "text-warn"
        : verdict.tone === "info"
          ? "text-info"
          : "text-ink-2";

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex flex-col">
        <span className={cx("text-[12px] font-medium", tone)}>{verdict.label}</span>
        {/* §33.5. Both pipelines at once is allowed, and a purchase row that
            says nothing about a live complaint is hiding the more urgent of
            the two. */}
        {verdict.case !== 6 && row.status?.ticketEnquiryId ? (
          <span className="text-[11px] text-info">
            Also has an open ticket (#{row.status.ticketEnquiryId})
          </span>
        ) : null}
        <span className="text-[11px] text-ink-3">
          {row.decision === "dismiss"
            ? "Dismissed — nothing will be written"
            : row.decision === "add_anyway"
              ? "Source updated, follow-up cleared, back into New Calls"
              : verdict.action}
        </span>
      </span>
      {/* §38.3. Which pipeline this arrival belongs to, when the number is
          already in one. The rule's answer is the default and the other side
          is one click away — a number can legitimately end up with an open
          lead and an open ticket, so the screen has to let somebody say so. */}
      {!verdict.needsDecision && (row.status?.ticketEnquiryId || row.status?.openEnquiryId) ? (
        <span className="flex items-center gap-1.5">
          {(
            [
              { id: "ticket" as const, label: "Continue ticket", when: Boolean(row.status?.ticketEnquiryId) },
              { id: "purchase" as const, label: "New purchase enquiry", when: Boolean(row.status?.ticketEnquiryId) && !row.status?.openEnquiryId },
              { id: "ticket2" as const, label: "Log ticket instead", when: Boolean(row.status?.openEnquiryId) && !row.status?.ticketEnquiryId },
            ] as const
          )
            .filter((o) => o.when)
            .map((o) => {
              const value = o.id === "ticket2" ? "ticket" : o.id;
              const on =
                row.pipeline === value ||
                (row.pipeline === null &&
                  value === (ticketOnly(row.status!) ? "ticket" : "purchase"));
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onPipeline(value)}
                  className={cx(
                    "rounded-full border px-2 py-[2px] text-[11px]",
                    on
                      ? "border-accent bg-accent-soft font-medium text-accent"
                      : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
        </span>
      ) : null}
      {verdict.needsDecision ? (
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDismiss}
            className={cx(
              "rounded-full border px-2 py-[2px] text-[11px]",
              row.decision === "dismiss"
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
            )}
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onAddAnyway}
            className={cx(
              "rounded-full border px-2 py-[2px] text-[11px]",
              row.decision === "add_anyway"
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
            )}
          >
            Add to New Calls anyway
          </button>
        </span>
      ) : null}
    </span>
  );
}

/**
 * Dismiss asks twice.
 *
 * It is the one action here that throws a lead away, and it is offered at the
 * end of a row on a screen where everything else is decided automatically —
 * exactly the conditions for clicking it without meaning to.
 */
export function ConfirmDismiss({
  mobile,
  onCancel,
  onConfirm,
}: {
  mobile: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/25 px-4 py-20">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Dismiss this number"
        className="w-full max-w-[440px] rounded-lg border border-line bg-surface p-4 shadow-panel"
      >
        <p className="text-[13.5px] font-medium text-ink">{dismissQuestion(mobile)}</p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={onConfirm}>
            Confirm
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * What the save did, per row where it matters.
 *
 * The counts are the headline; the list under them is §30.3's rule — anything
 * the save could not apply is named, against the number it was typed on.
 */
function Summary({ result }: { result: BulkResult }) {
  const ignored = (result.rows ?? []).filter((r) => r.ignored?.length);
  return (
    <div className="rounded-md border border-ok/40 bg-ok-soft px-3 py-1.5 text-[12.5px] text-ok">
      <p>
        {result.created} new, {result.updated} already waiting and updated,{" "}
        {result.returned} returned to New Calls, {result.dismissed} left alone
        {result.failed?.length ? `, ${result.failed.length} failed` : ""}.
      </p>
      {result.failed?.length ? (
        <p className="mt-1 text-[11.5px] text-danger">
          {result.failed.map((f) => `${f.mobile}: ${f.reason}`).join(" · ")}
        </p>
      ) : null}
      {ignored.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px] text-warn">
          {ignored.map((r) => (
            <li key={r.mobile}>
              {r.mobile}: {r.ignored!.join("; ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
