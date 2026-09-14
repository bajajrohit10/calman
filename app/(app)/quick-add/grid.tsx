"use client";

import { useRef, useState, useTransition } from "react";

import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { useUnsavedClaim } from "@/components/unsaved-guard";
import type { EnquiryType } from "@/lib/enquiry-labels";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { lookupNumbers, type NumberStatus } from "@/app/(app)/import/actions";

import { createManyEnquiries, type BulkResult } from "./actions";

type Row = {
  key: string;
  mobile: string;
  name: string;
  type: EnquiryType;
  sourceId: string;
  status: NumberStatus | null;
  /** null until the number is looked up; then the counsellor's answer. */
  decision: "new" | "update" | "dismiss" | null;
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
  // Most calls are somebody wanting to buy, so that is what a blank row is.
  type: "purchase",
  sourceId: "",
  status: null,
  decision: null,
  checking: false,
});

const blanks = (n: number) => Array.from({ length: n }, blank);

/**
 * The hint on a locked Type control (§30.3).
 *
 * Exported because the message is the fix: changing the type of an enquiry
 * that already exists used to be accepted and then quietly dropped, and the
 * cure for a silent no-op is a sentence saying what to do instead.
 */
export const TYPE_LOCKED_HINT =
  "Type is fixed for an existing enquiry — use New enquiry, or the after-sale " +
  "switch in the call window";

/** What each §10.1 state means for somebody typing a list. */
function describe(s: NumberStatus): { text: string; needsChoice: boolean } {
  switch (s.state) {
    case "new":
      return { text: "New number", needsChoice: false };
    case "open_uncalled":
      return { text: "Open, never called", needsChoice: true };
    case "open_called_earlier":
      return { text: "Open, called earlier", needsChoice: true };
    case "open_called_today":
      return { text: "Open, called today", needsChoice: true };
    case "wrong_number":
      return { text: "Marked wrong number", needsChoice: true };
    case "resolved":
      return { text: "Closed — won or lost", needsChoice: true };
  }
}

/**
 * Quick Add (§30.1): a grid of numbers, and nothing else.
 *
 * It replaced a single-number box with a grid hidden behind a button. The box
 * was built for the phone ringing, but the phone ringing is one row of this —
 * type the number, see what Calman knows, decide — and keeping two screens
 * that do the same thing meant every change had to be made twice and the list
 * case was the one that got forgotten. One row is the ringing phone; twenty
 * are the list somebody was sent.
 *
 * Ten rows to start because a screenful that is already there reads as "type
 * here"; five more arrive as soon as the last one is reached, so the grid is
 * never the thing that runs out. Empty rows are ignored, so leaving seventeen
 * of them untouched costs nothing.
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
  // Which row's "Log call now" is in flight, so only that button says so.
  const [opening, setOpening] = useState<string | null>(null);
  const grownFor = useRef<string | null>(null);

  const filled = rows.filter((r) => r.mobile.trim());
  const invalid = filled.filter((r) => !isValidMobile(normaliseMobile(r.mobile)));
  const undecided = filled.filter(
    (r) => r.status && describe(r.status).needsChoice && !r.decision,
  );
  const saveable = filled.filter(
    (r) => isValidMobile(normaliseMobile(r.mobile)) && r.decision !== "dismiss",
  );

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
    patch(key, { mobile, status: null, decision: null });
    if (!isValidMobile(mobile)) return;
    patch(key, { checking: true });
    const res = await lookupNumbers([mobile]);
    const status = res.statuses?.[0] ?? null;
    patch(key, {
      checking: false,
      status,
      // A number nobody has seen needs no decision; the rest wait for one.
      decision: status && describe(status).needsChoice ? null : "new",
    });
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
      // Always a screenful still waiting at the end.
      if (next[next.length - 1].mobile.trim()) next.push(...blanks(GROW_BY));
      return next;
    });
    parts.forEach((p, i) => {
      const mobile = normaliseMobile(p);
      const key = keys[i];
      if (key && isValidMobile(mobile)) void settleMobile(key, mobile);
    });
  }

  /**
   * Write every filled row. Returns the result so the callers can read it —
   * "Log call now" needs the enquiry id of its own row, and the unsaved guard
   * needs to know whether the save was allowed to happen.
   */
  async function saveAll(): Promise<BulkResult | null> {
    if (!saveable.length) {
      setResult({ error: "Nothing to save — every row is empty, invalid or dismissed." });
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
        error: `${undecided.length} number${undecided.length === 1 ? "" : "s"} Calman already knows — choose what to do with each.`,
      });
      return null;
    }
    const res = await createManyEnquiries(
      filled.map((r) => ({
        mobile: r.mobile,
        name: r.name.trim() || null,
        // §30.2. The row's own choice, all the way through — not a default
        // applied here because the save happened to be a bulk one.
        type: r.type,
        sourceId: r.sourceId || null,
        decision: (r.decision ?? "new") as "new" | "update" | "dismiss",
        enquiryId: r.status?.openEnquiryId ?? null,
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
          ...(res ?? { error: null }),
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

  const busy = pending;

  return (
    <div className="flex flex-col gap-3">
      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result && !result.error ? <Summary result={result} /> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[40px] px-2 py-[7px] text-right">#</th>
              <th className="w-[155px] px-2 py-[7px]">Mobile</th>
              <th className="w-[180px] px-2 py-[7px]">Name</th>
              <th className="w-[135px] px-2 py-[7px]">Type</th>
              <th className="w-[155px] px-2 py-[7px]">Source</th>
              <th className="px-2 py-[7px]">Status</th>
              <th className="w-[130px] px-2 py-[7px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const mobile = normaliseMobile(r.mobile);
              const bad = Boolean(r.mobile.trim()) && !isValidMobile(mobile);
              const info = r.status ? describe(r.status) : null;
              // §30.3. An existing enquiry's type cannot be changed, and
              // import_lookup only ever offers an open *purchase* enquiry to
              // update — so the locked control is not just disabled, it is
              // showing the truth.
              const typeLocked = r.decision === "update";
              const ready = Boolean(mobile) && !bad && r.decision !== "dismiss" && !r.checking;

              return (
                <tr
                  key={r.key}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    bad && "bg-danger-soft/30",
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
                      onChange={(e) => patch(r.key, { mobile: e.target.value })}
                      onBlur={(e) => void settleMobile(r.key, e.target.value)}
                      onPaste={(e) => onPaste(e, i)}
                    />
                  </td>
                  <td className="px-2 py-[5px]">
                    <Input
                      value={r.name}
                      aria-label={`Name, row ${i + 1}`}
                      placeholder="Optional"
                      onChange={(e) => patch(r.key, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-[5px]">
                    <Select
                      value={typeLocked ? "purchase" : r.type}
                      aria-label={`Type, row ${i + 1}`}
                      disabled={typeLocked}
                      title={typeLocked ? TYPE_LOCKED_HINT : undefined}
                      onChange={(e) =>
                        patch(r.key, { type: e.target.value as EnquiryType })
                      }
                    >
                      <option value="purchase">Purchase</option>
                      <option value="after_sale">After Sale</option>
                    </Select>
                    {typeLocked ? (
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">
                        {TYPE_LOCKED_HINT}
                      </span>
                    ) : null}
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
                    {bad ? (
                      <span className="text-[12px] font-medium text-danger">
                        Not a valid number
                      </span>
                    ) : r.checking ? (
                      <span className="text-[12px] text-ink-3">checking…</span>
                    ) : info ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cx(
                            "text-[12px]",
                            info.needsChoice ? "text-warn" : "text-ink-2",
                          )}
                        >
                          {info.text}
                          {r.status?.studentName ? ` · ${r.status.studentName}` : ""}
                        </span>
                        {info.needsChoice
                          ? (["update", "new", "dismiss"] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => patch(r.key, { decision: d })}
                                className={cx(
                                  "rounded-full border px-2 py-[2px] text-[11px]",
                                  r.decision === d
                                    ? "border-accent bg-accent-soft font-medium text-accent"
                                    : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
                                )}
                              >
                                {d === "update"
                                  ? "Update existing"
                                  : d === "new"
                                    ? "New enquiry"
                                    : "Dismiss"}
                              </button>
                            ))
                          : null}
                      </span>
                    ) : (
                      <span className="text-[12px] text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-2 py-[5px]">
                    {ready ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        title="Saves every filled row first, then opens the call"
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
          disabled={busy}
          onClick={() => start(() => void saveAll())}
        >
          {busy && !opening ? "Saving…" : `Save all (${saveable.length})`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRows((rs) => [...rs, ...blanks(GROW_BY)])}
        >
          Add {GROW_BY} rows
        </Button>
        <span className="text-[11.5px] text-ink-3">
          {invalid.length ? `${invalid.length} invalid · ` : ""}
          {undecided.length ? `${undecided.length} waiting on a choice · ` : ""}
          Save all sends every filled row to New Calls, unassigned. Log call now
          saves them all first, then opens that row&apos;s call.
        </span>
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
        {result.created} created, {result.updated} added to an existing enquiry,{" "}
        {result.dismissed} left alone
        {result.failed?.length ? `, ${result.failed.length} failed` : ""}. New
        purchase leads are waiting in New Calls; after-sale ones are in Tickets.
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
