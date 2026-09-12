"use client";

import { useRef, useState, useTransition } from "react";

import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { useUnsavedClaim } from "@/components/unsaved-guard";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { lookupNumbers, type NumberStatus } from "@/app/(app)/import/actions";

import { createManyEnquiries, type BulkResult } from "./actions";

type Row = {
  key: string;
  mobile: string;
  name: string;
  sourceId: string;
  status: NumberStatus | null;
  /** null until the number is looked up; then the counsellor's answer. */
  decision: "new" | "update" | "dismiss" | null;
  checking: boolean;
};

let seq = 0;
const blank = (): Row => ({
  key: `r${++seq}`,
  mobile: "",
  name: "",
  sourceId: "",
  status: null,
  decision: null,
  checking: false,
});

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
 * A screenful of numbers at once (§29.3).
 *
 * The single-number box is right for the phone ringing; it is the wrong shape
 * for a list somebody has been sent, where the same three interactions —
 * type, look up, decide — are repeated twenty times. This is that list, with
 * the lookup happening as the counsellor leaves each number rather than after
 * they have typed them all.
 */
export function AddMany({
  sources,
  onDone,
}: {
  sources: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank(), blank()]);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, start] = useTransition();
  const gridRef = useRef<HTMLDivElement | null>(null);

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
      return !res?.error;
    },
    discard: () => setRows([blank(), blank(), blank()]),
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

  /** A pasted column fills rows rather than one cell (§29.3). */
  function onPaste(e: React.ClipboardEvent, index: number) {
    const text = e.clipboardData.getData("text");
    const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    setRows((rs) => {
      const next = [...rs];
      parts.forEach((p, i) => {
        const at = index + i;
        if (!next[at]) next[at] = blank();
        next[at] = { ...next[at], mobile: normaliseMobile(p), status: null, decision: null };
      });
      // Always one empty row waiting at the end.
      if (next[next.length - 1].mobile.trim()) next.push(blank());
      return next;
    });
    parts.forEach((p, i) => {
      const mobile = normaliseMobile(p);
      if (isValidMobile(mobile)) {
        setTimeout(() => {
          setRows((rs) => {
            const row = rs[index + i];
            if (row) void settleMobile(row.key, mobile);
            return rs;
          });
        }, 0);
      }
    });
  }

  /** Tab out of the last cell of the last row grows the grid. */
  function onKeyDown(e: React.KeyboardEvent, rowIndex: number, lastCell: boolean) {
    if (e.key !== "Tab" || e.shiftKey || !lastCell) return;
    if (rowIndex !== rows.length - 1) return;
    setRows((rs) => [...rs, blank()]);
  }

  async function saveAll(): Promise<BulkResult | null> {
    if (!saveable.length) {
      setResult({ error: "Nothing to save — every row is empty, invalid or dismissed." });
      return null;
    }
    if (invalid.length) {
      setResult({ error: `${invalid.length} number${invalid.length === 1 ? " is" : "s are"} not valid. Fix or clear them first.` });
      return null;
    }
    if (undecided.length) {
      setResult({ error: `${undecided.length} number${undecided.length === 1 ? "" : "s"} Calman already knows — choose what to do with each.` });
      return null;
    }
    const res = await createManyEnquiries(
      filled.map((r) => ({
        mobile: r.mobile,
        name: r.name.trim() || null,
        sourceId: r.sourceId || null,
        decision: (r.decision ?? "new") as "new" | "update" | "dismiss",
        enquiryId: r.status?.openEnquiryId ?? null,
      })),
    );
    setResult(res);
    if (!res.error) setRows([blank(), blank(), blank()]);
    return res;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-semibold text-ink">Add many</h2>
        <span className="text-[12px] text-ink-3">
          Paste a column of numbers, or type them. Tab moves along the row; Tab
          from the last cell adds another.
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
          Back to one number
        </Button>
      </div>

      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result && !result.error ? (
        <p className="rounded-md border border-ok/40 bg-ok-soft px-3 py-1.5 text-[12.5px] text-ok">
          {result.created} created, {result.updated} added to an existing enquiry,{" "}
          {result.dismissed} left alone
          {result.failed?.length ? `, ${result.failed.length} failed` : ""}. The new
          ones are waiting in New Calls.
          {result.failed?.length ? (
            <span className="mt-1 block text-[11.5px] text-ink-2">
              {result.failed.map((f) => `${f.mobile}: ${f.reason}`).join(" · ")}
            </span>
          ) : null}
        </p>
      ) : null}

      <div ref={gridRef} className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[170px] px-2 py-[7px]">Mobile</th>
              <th className="w-[200px] px-2 py-[7px]">Name</th>
              <th className="w-[170px] px-2 py-[7px]">Source</th>
              <th className="px-2 py-[7px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const mobile = normaliseMobile(r.mobile);
              const bad = Boolean(r.mobile.trim()) && !isValidMobile(mobile);
              const info = r.status ? describe(r.status) : null;
              return (
                <tr key={r.key} className={cx("border-b border-line last:border-b-0", bad && "bg-danger-soft/30")}>
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
                      value={r.sourceId}
                      aria-label={`Source, row ${i + 1}`}
                      onChange={(e) => patch(r.key, { sourceId: e.target.value })}
                      onKeyDown={(e) => onKeyDown(e, i, true)}
                    >
                      <option value="">—</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
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
                        <span className={cx("text-[12px]", info.needsChoice ? "text-warn" : "text-ink-2")}>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={pending} onClick={() => start(() => void saveAll())}>
          {pending ? "Saving…" : `Save all (${saveable.length})`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, blank()])}>
          Add a row
        </Button>
        <span className="text-[11.5px] text-ink-3">
          {invalid.length ? `${invalid.length} invalid · ` : ""}
          {undecided.length ? `${undecided.length} waiting on a choice · ` : ""}
          everything saved here goes to New Calls, unassigned.
        </span>
      </div>
    </div>
  );
}
