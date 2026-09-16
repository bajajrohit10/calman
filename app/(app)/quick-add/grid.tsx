"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { useUnsavedClaim } from "@/components/unsaved-guard";
import {
  BOTH_OPEN,
  CASE_5_ACTIONS,
  CASE_5_CHOICES,
  bothOpen,
  describeNumber,
  dismissQuestion,
  ticketOnly,
  type Case5Decision,
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
  /** §48.3: both grids carry it; only the AC grid shows it by default. */
  productText: string;
  /** §48.3: AC only — the moment the entry actually came in, as datetime-local. */
  arrivedAt: string;
  status: NumberStatus | null;
  /** Case 5 only: what the counsellor chose. */
  decision: Case5Decision | null;
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
/**
 * §39.1. How long after the last keystroke the number is looked up.
 *
 * Long enough that typing ten digits is one question rather than ten, short
 * enough that a counsellor who stops to read the row is not reading a blank.
 */
const LOOKUP_DELAY = 300;

let seq = 0;
const blank = (arrivedAt = ""): Row => ({
  key: `r${++seq}`,
  mobile: "",
  name: "",
  sourceId: "",
  productText: "",
  arrivedAt,
  status: null,
  decision: null,
  pipeline: null,
  checking: false,
});

const blanks = (n: number, arrivedAt = "") =>
  Array.from({ length: n }, () => blank(arrivedAt));

/**
 * Now, as a datetime-local value in IST (§48.3).
 *
 * datetime-local has no timezone: the browser shows whatever string it is
 * given and hands the same one back. So the value is built in IST here and
 * read back as IST on save, rather than going through the machine's own clock
 * — a counsellor on a laptop left in another timezone would otherwise stamp
 * every AC entry hours out without anything on screen saying so.
 */
/** The inverse: a datetime-local string, read as IST, as an ISO instant. */
function istLocalToIso(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m.map(Number) as unknown as number[];
  // IST is UTC+5:30 all year, so the shift is a constant rather than a lookup.
  return new Date(
    Date.UTC(y, mo - 1, d, hh, mm) - (5 * 60 + 30) * 60_000,
  ).toISOString();
}

function nowInIst(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

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
  mode = "normal",
  acSourceId = null,
}: {
  sources: { id: string; name: string }[];
  /** Open the first-call form for a row that has just been saved. */
  onLogCall: (enquiryId: number, mobile: string) => void;
  /**
   * §48.3. Which grid this is. One engine, two column sets: the duplicate
   * rules, the debounced lookup, the case-5 choice and the save path are the
   * whole substance of this component and they are identical on both, so a
   * second copy would be two places for every future rule to be forgotten.
   */
  mode?: "normal" | "ac";
  /** §48.3: the AC grid's fixed source, resolved from the master list. */
  acSourceId?: string | null;
}) {
  const ac = mode === "ac";
  const [rows, setRows] = useState<Row[]>(() =>
    blanks(OPENING_ROWS, ac ? nowInIst() : ""),
  );
  /** A fresh set of empty rows for this grid, after a save or a discard. */
  const freshRows = () => blanks(OPENING_ROWS, ac ? nowInIst() : "");
  /**
   * §48.3. Product text on the Normal grid is optional, and off by default.
   * The Normal grid's job is speed — a number, maybe a name, next row — and a
   * column nobody fills on most rows is a Tab stop everybody pays for. On the
   * AC grid it is always there, because recording what was asked about is
   * most of why that grid exists.
   */
  const [showProduct, setShowProduct] = useState(false);
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
  /**
   * §41.1. A number that is a live lead *and* a live ticket has no default.
   * Until somebody says which conversation this call belongs to, the row
   * cannot be saved and neither can the ones beside it — a grid that saved
   * nine rows and left the tenth unanswered would be a grid you had to
   * re-read to find out what it did.
   */
  const unchosen = filled.filter((r) => r.status && bothOpen(r.status) && !r.pipeline);
  const saveable = filled.filter((r) => isValidMobile(normaliseMobile(r.mobile)));
  const blocked = invalid.length > 0 || undecided.length > 0 || unchosen.length > 0;
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
    discard: () => setRows(freshRows()),
  });

  const patch = (key: string, next: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /**
   * §39.1. The status has to be about the number as it is typed now.
   *
   * It used to be looked up on blur, which meant a counsellor who corrected
   * the last digit and read the row without clicking away was reading the
   * verdict on the number they had just replaced — "Existing lead" against a
   * number nobody has ever called. So every keystroke clears the status first
   * and the lookup follows 300 ms after the typing stops.
   *
   * Two refs do the work a debounce needs. `timers` holds the pending ask per
   * row, so a further keystroke can cancel it. `asked` holds the number each
   * row last asked about, and a reply is applied only if it is still that
   * number — a slow answer about 8334808844 must not land on a row that now
   * reads 8334808845.
   */
  const timers = useRef(new Map<string, number>());
  const asked = useRef(new Map<string, string>());

  function cancelLookup(key: string) {
    const t = timers.current.get(key);
    if (t !== undefined) window.clearTimeout(t);
    timers.current.delete(key);
  }

  // Rows are cleared and replaced after a save; a timer that outlived its row
  // would ask about a number nobody is looking at any more.
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const t of pendingTimers.values()) window.clearTimeout(t);
      pendingTimers.clear();
    };
  }, []);

  /** Returns the answer, or undefined if a newer number overtook it. */
  async function lookupRow(key: string, mobile: string): Promise<NumberStatus | null | undefined> {
    cancelLookup(key);
    asked.current.set(key, mobile);
    patch(key, { checking: true });
    const res = await lookupNumbers([mobile]);
    if (asked.current.get(key) !== mobile) return undefined;
    const status = res.statuses?.[0] ?? null;
    /**
     * §42. Case 5 arrives with an answer already chosen.
     *
     * The three options are not equally likely: a number called an hour ago
     * that has rung again is almost always the same conversation continuing,
     * and the counsellor is holding the phone. So "Log another call" — the one
     * that changes nothing — is preselected, and the two that change the lead
     * are a click away. Nothing is blocked; the row still says what it will do.
     */
    const preset =
      status && describeNumber(status, "purchase").case === 5
        ? ("log_call" as const)
        : null;
    patch(key, { checking: false, status, decision: preset });
    return status;
  }

  /** Every keystroke in the mobile cell (§39.1). */
  function typeMobile(key: string, raw: string) {
    const mobile = normaliseMobile(raw);
    cancelLookup(key);
    // Written before the patch so any answer still in flight is already stale.
    asked.current.set(key, mobile);
    const valid = isValidMobile(mobile);
    patch(key, {
      mobile,
      status: null,
      decision: null,
      pipeline: null,
      // A cleared status is not a verdict. Without this the row would read
      // "New number" for the 300 ms before anybody had asked — which is the
      // same wrong answer this brief is about, just briefer.
      checking: valid,
    });
    if (!valid) return;
    timers.current.set(
      key,
      window.setTimeout(() => void lookupRow(key, mobile), LOOKUP_DELAY),
    );
  }

  /** Leaving the mobile cell, or arriving by paste: ask now, not in 300 ms. */
  function settleMobile(key: string, raw: string) {
    const mobile = normaliseMobile(raw);
    if (timers.current.has(key)) {
      cancelLookup(key);
      if (isValidMobile(mobile)) void lookupRow(key, mobile);
      return;
    }
    // Typing already asked about this exact number; asking again on the way
    // out would only replace an answer with the same answer.
    if (asked.current.get(key) === mobile) return;
    patch(key, { mobile, status: null, decision: null, pipeline: null });
    asked.current.set(key, mobile);
    if (!isValidMobile(mobile)) return;
    void lookupRow(key, mobile);
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
    setRows((rs) => [...rs, ...blanks(GROW_BY, ac ? nowInIst() : "")]);
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
    if (!isValidMobile(mobile)) return;
    e.preventDefault();

    // §39.1 made the lookup wait 300 ms, and Enter comes straight off the last
    // digit — so the answer is usually still on its way. Ask now rather than
    // opening a call on a number nothing is known about. If the answer turns
    // out to be one of the cases that asks a question, the row asks it and
    // Enter is not an answer to it.
    if (row.checking || timers.current.has(row.key)) {
      void (async () => {
        const status = await lookupRow(row.key, mobile);
        if (status === undefined) return;
        if (status) {
          const side =
            row.pipeline === "ticket"
              ? "after_sale"
              : row.pipeline === "purchase"
                ? "purchase"
                : ticketOnly(status)
                  ? "after_sale"
                  : "purchase";
          if (describeNumber(status, side)?.needsDecision) return;
        }
        logCallNow({ ...row, mobile, status });
      })();
      return;
    }
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
        if (!next[at]) next[at] = blank(ac ? nowInIst() : "");
        next[at] = {
          ...next[at],
          mobile: normaliseMobile(p),
          status: null,
          decision: null,
        };
        keys.push(next[at].key);
      });
      if (next[next.length - 1].mobile.trim())
        next.push(...blanks(GROW_BY, ac ? nowInIst() : ""));
      return next;
    });
    parts.forEach((p, i) => {
      const mobile = normaliseMobile(p);
      const key = keys[i];
      if (key && isValidMobile(mobile)) settleMobile(key, mobile);
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
    if (unchosen.length) {
      setResult({
        error: `${unchosen.length} row${unchosen.length === 1 ? " has" : "s have"} both an open lead and an open ticket. Choose "Log as purchase" or "Log as ticket" on ${unchosen.length === 1 ? "it" : "each"} first.`,
      });
      return null;
    }
    const res = await createManyEnquiries(
      filled.map((r) => ({
        mobile: r.mobile,
        name: r.name.trim() || null,
        // §48.3. The AC grid does not ask: every row on it is an AC arrival,
        // so showing a source column with one option would be a column that
        // only ever wastes a keystroke.
        sourceId: (ac ? acSourceId : r.sourceId) || null,
        productText: r.productText.trim() || null,
        arrivedAt: ac ? istLocalToIso(r.arrivedAt) : null,
        decision: r.decision,
        pipeline: r.pipeline,
      })),
    );
    setResult(res);
    if (!res.error) {
      setRows(freshRows());
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
        <table className="w-full min-w-[1040px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[40px] px-1.5 py-[7px] text-right">#</th>
              <th className="w-[150px] px-1.5 py-[7px]">Mobile</th>
              <th className="w-[200px] px-1.5 py-[7px]">Name</th>
              {/* §48.3. Always on the AC grid, where it is most of the point;
                  optional on the Normal one, so a counsellor taking a call can
                  record what was asked about without leaving the row. */}
              {ac || showProduct ? (
                <th className="w-[210px] px-1.5 py-[7px]">Product text</th>
              ) : null}
              {ac ? (
                <th className="w-[190px] px-1.5 py-[7px]">AC created time</th>
              ) : (
                <th className="w-[165px] px-1.5 py-[7px]">Source</th>
              )}
              <th className="px-1.5 py-[7px]">Status</th>
              <th className="w-[120px] px-1.5 py-[7px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const mobile = normaliseMobile(r.mobile);
              const bad = Boolean(r.mobile.trim()) && !isValidMobile(mobile);
              const verdict = verdictOf(r);
              const waiting = Boolean(verdict?.needsDecision) && !r.decision;
              // §41.1. Live on both sides and unanswered: the row is not ready
              // for either button, and a disabled button says so better than an
              // error message after the click.
              const unpicked = Boolean(r.status && bothOpen(r.status) && !r.pipeline);
              const ready =
                Boolean(mobile) && !bad && !r.checking && !waiting && !unpicked;

              return (
                <tr
                  key={r.key}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    bad && "bg-danger-soft/30",
                    (waiting || unpicked) && "bg-warn-soft/30",
                  )}
                  onFocus={() => reached(r.key)}
                >
                  <td className="px-1.5 py-[5px] text-right text-[11px] tabular-nums text-ink-3">
                    {i + 1}
                  </td>
                  <td className="px-1.5 py-[5px]">
                    <Input
                      value={r.mobile}
                      inputMode="numeric"
                      aria-label={`Mobile, row ${i + 1}`}
                      className={bad ? "border-danger" : undefined}
                      // §32.2. Normalised on the way in, not on the way out,
                      // so what is in the box is always what would be stored:
                      // pasting "+91 98765-43210" from WhatsApp shows
                      // 9876543210 at once rather than on blur.
                      onChange={(e) => typeMobile(r.key, e.target.value)}
                      onBlur={(e) => settleMobile(r.key, e.target.value)}
                      onPaste={(e) => onPaste(e, i)}
                      onKeyDown={(e) => onEnter(e, r)}
                    />
                  </td>
                  <td className="px-1.5 py-[5px]">
                    <Input
                      value={r.name}
                      aria-label={`Name, row ${i + 1}`}
                      placeholder="Optional"
                      onChange={(e) => patch(r.key, { name: e.target.value })}
                      onKeyDown={(e) => onEnter(e, r)}
                    />
                  </td>
                  {ac || showProduct ? (
                    <td className="px-1.5 py-[5px]">
                      <Input
                        value={r.productText}
                        aria-label={`Product text, row ${i + 1}`}
                        placeholder="Optional"
                        onChange={(e) => patch(r.key, { productText: e.target.value })}
                        onKeyDown={(e) => onEnter(e, r)}
                      />
                    </td>
                  ) : null}
                  {ac ? (
                    <td className="px-1.5 py-[5px]">
                      {/* Defaults to now and is left alone by Tab, so a row
                          keyed as the entry comes in needs no thought; the
                          one keyed at six for a five o'clock enquiry is two
                          keystrokes away from being right. */}
                      <Input
                        type="datetime-local"
                        value={r.arrivedAt}
                        aria-label={`AC created time, row ${i + 1}`}
                        onChange={(e) => patch(r.key, { arrivedAt: e.target.value })}
                        onKeyDown={(e) => onEnter(e, r)}
                      />
                    </td>
                  ) : (
                    <td className="px-1.5 py-[5px]">
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
                  )}
                  <td className="px-1.5 py-[5px]">
                    <StatusCell
                      row={r}
                      bad={bad}
                      verdict={verdict}
                      onDecide={(d) => patch(r.key, { decision: d })}
                      onDismiss={() => setConfirming(r)}
                      onPipeline={(p) => patch(r.key, { pipeline: p })}
                    />
                  </td>
                  <td className="px-1.5 py-[5px]">
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
          onClick={() =>
            setRows((rs) => [...rs, ...blanks(GROW_BY, ac ? nowInIst() : "")])
          }
        >
          Add {GROW_BY} rows
        </Button>
        {ac ? null : (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              checked={showProduct}
              onChange={(e) => setShowProduct(e.target.checked)}
            />
            Product text column
          </label>
        )}
        {undecided.length ? (
          <span className="rounded-md border border-warn/40 bg-warn-soft/50 px-2 py-1 text-[12px] font-medium text-warn">
            {undecided.length} row{undecided.length === 1 ? "" : "s"} need
            {undecided.length === 1 ? "s" : ""} a decision
          </span>
        ) : null}
        {unchosen.length ? (
          <span className="rounded-md border border-warn/40 bg-warn-soft/50 px-2 py-1 text-[12px] font-medium text-warn">
            {unchosen.length} row{unchosen.length === 1 ? "" : "s"} on both sides —
            purchase or ticket?
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
  onDecide,
  onDismiss,
  onPipeline,
}: {
  row: Row;
  bad: boolean;
  verdict: DuplicateVerdict | null;
  onDecide: (decision: Case5Decision) => void;
  onDismiss: () => void;
  onPipeline: (p: "ticket" | "purchase") => void;
}) {
  if (bad) {
    return <span className="text-[12px] font-medium text-danger">Not a valid number</span>;
  }
  if (row.checking) return <span className="text-[12px] text-ink-3">checking…</span>;
  if (!row.mobile.trim()) return <span className="text-[12px] text-ink-3">—</span>;

  const both = Boolean(row.status && bothOpen(row.status));

  /**
   * §41.1. Live on both sides, and nobody has said which one this is.
   *
   * Rendered before the verdict rather than beside it, because there is no
   * verdict to render: the purchase reading and the ticket reading are
   * different sentences with different consequences, and showing one of them
   * with a chooser underneath would be showing an answer and calling it a
   * question. Whichever is picked, the call window still carries the switch to
   * the other side, so this is a starting point and not a commitment.
   */
  if (row.status && bothOpen(row.status) && !row.pipeline) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex flex-col">
          <span className="text-[12px] font-medium text-warn">{BOTH_OPEN.label}</span>
          <span className="text-[11px] text-ink-3">
            Lead #{row.status.openEnquiryId} · ticket #{row.status.ticketEnquiryId}
          </span>
          <span className="text-[11px] text-ink-3">{BOTH_OPEN.action}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {BOTH_OPEN.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPipeline(c.id)}
              className="rounded-full border border-line-2 bg-surface px-2 py-[2px] text-[11px] text-ink-2 hover:border-accent hover:text-accent"
            >
              {c.label}
            </button>
          ))}
        </span>
      </span>
    );
  }

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
        {/* §41.1. Chosen, and the other side is still open — say so, because
            the row now reads as one conversation and there are two. */}
        {both && row.pipeline === "ticket" && row.status?.openEnquiryId ? (
          <span className="text-[11px] text-info">
            Also has an open lead (#{row.status.openEnquiryId})
          </span>
        ) : null}
        <span className="text-[11px] text-ink-3">
          {row.decision ? CASE_5_ACTIONS[row.decision] : verdict.action}
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
              // §41.1. On a number that is live on both sides these are the
              // two words the choice was made with, so they are the two words
              // it can be changed with.
              { id: "purchase2" as const, label: "Log as purchase", when: both },
              { id: "ticket3" as const, label: "Log as ticket", when: both },
              { id: "ticket" as const, label: "Continue ticket", when: !both && Boolean(row.status?.ticketEnquiryId) },
              { id: "purchase" as const, label: "New purchase enquiry", when: Boolean(row.status?.ticketEnquiryId) && !row.status?.openEnquiryId },
              { id: "ticket2" as const, label: "Log ticket instead", when: Boolean(row.status?.openEnquiryId) && !row.status?.ticketEnquiryId },
            ] as const
          )
            .filter((o) => o.when)
            .map((o) => {
              const value =
                o.id === "ticket2" || o.id === "ticket3"
                  ? ("ticket" as const)
                  : o.id === "purchase2"
                    ? ("purchase" as const)
                    : o.id;
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
      {/* §42. Three answers, in the order they are reached for. Dismiss is
          last and still asks twice — it is the only one that throws the
          arrival away. */}
      {verdict.needsDecision ? (
        <span className="flex items-center gap-1.5">
          {CASE_5_CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => (c.id === "dismiss" ? onDismiss() : onDecide(c.id))}
              className={cx(
                "rounded-full border px-2 py-[2px] text-[11px]",
                row.decision === c.id
                  ? "border-accent bg-accent-soft font-medium text-accent"
                  : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
              )}
            >
              {c.label}
            </button>
          ))}
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
        {result.returned} returned to New Calls,{" "}
        {/* §42. Two different kinds of "nothing changed", and they are not the
            same thing: one is a lead ready for another call, the other is an
            arrival thrown away. */}
        {result.untouched ? `${result.untouched} left as they were, ` : ""}
        {result.dismissed} dismissed
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
