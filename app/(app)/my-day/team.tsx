"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import { MY_DAY_TABS, type MyDayTabKey } from "@/lib/my-day-tabs";
import type { TeamDay } from "@/lib/my-day-team";

import { Dialog } from "./dialog";

import {
  carryForward,
  moveAssignments,
  pendingForMove,
  refreshTeamDay,
} from "./team-actions";

/** The four categories work is actually assigned in; Tickets is not one. */
const MOVABLE: MyDayTabKey[] = ["new", "offer", "assigned", "custom"];

const FIELD_LABEL =
  "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";

type MoveTarget = {
  fromId: string;
  fromName: string;
  tab: MyDayTabKey | "all";
  pending: number;
};

/**
 * The team's day (§30.4), and the two things a manager does with it.
 *
 * One row per counsellor, one pair per category, pending over total. The
 * numbers come from my_day_team() so they are the same arithmetic each
 * counsellor's own screen does — a grid that disagreed with the screen it
 * summarises would be worse than no grid at all.
 *
 * Every cell is a link into that counsellor's tab, because the first question
 * a number in a grid provokes is "which ones?". Every cell with something
 * pending also carries Move, because the second question at six in the evening
 * is "who can take these?".
 */
export function TeamDayGrid({
  initial,
  date,
  roster,
  nextWorkingDay,
}: {
  initial: TeamDay;
  date: string;
  roster: { id: string; name: string }[];
  nextWorkingDay: string | null;
}) {
  const [team, setTeam] = useState<TeamDay>(initial);
  const [move, setMove] = useState<MoveTarget | null>(null);
  const [carryAll, setCarryAll] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const totalPending = team.rows.reduce(
    (n, r) => n + MOVABLE.reduce((m, k) => m + r.cells[k].pending, 0),
    0,
  );

  function reload(message: string) {
    start(async () => {
      const next = await refreshTeamDay(date);
      if (!next.error) setTeam(next);
      setNote(message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {team.error ? <ErrorNote>{team.error}</ErrorNote> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? (
        <p
          role="status"
          className="rounded-md border border-ok/40 bg-ok-soft px-3 py-1.5 text-[12.5px] text-ok"
        >
          {note}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setNote(null)}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[940px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-2.5 py-[7px]">Counsellor</th>
              {MY_DAY_TABS.map((t) => (
                <th key={t.key} className="border-l border-line px-2 py-[7px] text-right">
                  {t.label}
                </th>
              ))}
              <th className="border-l border-line px-2 py-[7px] text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {team.rows.map((r) => (
              <tr key={r.counsellorId} className="border-b border-line last:border-b-0">
                <td className="px-2.5 py-[6px] whitespace-nowrap font-medium text-ink">
                  {r.counsellorName}
                </td>
                {MY_DAY_TABS.map((t) => {
                  const cell = r.cells[t.key];
                  const movable = MOVABLE.includes(t.key) && cell.pending > 0;
                  return (
                    <td
                      key={t.key}
                      className="border-l border-line px-2 py-[6px] text-right"
                    >
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {movable ? (
                          <button
                            type="button"
                            className="rounded-full border border-line-2 bg-surface px-1.5 py-[1px] text-[10.5px] text-ink-3 hover:border-accent hover:text-accent"
                            title={`Move ${r.counsellorName}'s pending ${t.label} to somebody else`}
                            onClick={() =>
                              setMove({
                                fromId: r.counsellorId,
                                fromName: r.counsellorName,
                                tab: t.key,
                                pending: cell.pending,
                              })
                            }
                          >
                            Move
                          </button>
                        ) : null}
                        <Link
                          href={`/my-day?date=${date}&counsellor=${r.counsellorId}&tab=${t.key}&view=pending`}
                          className={cx(
                            "tabular-nums underline-offset-2 hover:underline",
                            cell.pending > 0 ? "text-ink" : "text-ink-3",
                          )}
                        >
                          <span
                            className={cell.pending > 0 ? "font-semibold" : undefined}
                          >
                            {cell.pending}
                          </span>
                          <span className="text-ink-3"> / {cell.total}</span>
                        </Link>
                      </span>
                    </td>
                  );
                })}
                <td className="border-l border-line px-2 py-[6px] text-right font-semibold tabular-nums text-ink">
                  {r.total.pending}
                  <span className="font-normal text-ink-3"> / {r.total.total}</span>
                </td>
              </tr>
            ))}
            {team.rows.length === 0 ? (
              <tr>
                <td colSpan={MY_DAY_TABS.length + 2} className="px-3 py-8 text-center text-ink-3">
                  No active counsellors.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={totalPending > 0 ? "primary" : "secondary"}
          disabled={pending || totalPending === 0}
          onClick={() => setCarryAll(true)}
        >
          Carry forward all pending ({totalPending})
        </Button>
        <span className="text-[11.5px] leading-relaxed text-ink-3">
          Each cell is pending / assigned for {formatDate(date)}, and links to
          that counsellor&apos;s tab. Tickets are not assigned to anybody, so
          that column is the shared queue and reads the same on every row.
        </span>
      </div>

      {move ? (
        <MoveDialog
          date={date}
          target={move}
          roster={roster}
          onClose={() => setMove(null)}
          onDone={(message) => {
            setMove(null);
            reload(message);
          }}
          onError={setError}
        />
      ) : null}

      {carryAll ? (
        <CarryAllDialog
          date={date}
          rows={team.rows.map((r) => ({
            id: r.counsellorId,
            name: r.counsellorName,
            pending: MOVABLE.reduce((n, k) => n + r.cells[k].pending, 0),
          }))}
          defaultDate={nextWorkingDay}
          onClose={() => setCarryAll(false)}
          onDone={(message) => {
            setCarryAll(false);
            reload(message);
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Move pending calls from one counsellor to another (§30.5).
 *
 * Count first, rows second: at the end of a day a manager is redistributing a
 * number, not choosing enquiries — "give Neha four of Rohit's" — and the
 * function takes the four that have been waiting longest. Picking rows is
 * there for when the answer really is "these two", and switching to it is what
 * loads them.
 */
function MoveDialog({
  date,
  target,
  roster,
  onClose,
  onDone,
  onError,
}: {
  date: string;
  target: MoveTarget;
  roster: { id: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<MyDayTabKey | "all">(target.tab);
  const [count, setCount] = useState(String(target.pending));
  const [toId, setToId] = useState(
    roster.find((r) => r.id !== target.fromId)?.id ?? "",
  );
  const [targetDate, setTargetDate] = useState(date);
  const [picking, setPicking] = useState(false);
  const [rows, setRows] = useState<
    { enquiryId: number; mobile: string; name: string | null; label: string | null }[]
  >([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [pending, start] = useTransition();

  function loadRows(nextTab: MyDayTabKey | "all") {
    start(async () => {
      const res = await pendingForMove({
        date,
        counsellorId: target.fromId,
        tab: nextTab,
      });
      if (res.error) {
        onError(res.error);
        return;
      }
      setRows(res.rows ?? []);
      setPicked([]);
    });
  }

  function submit() {
    if (!toId) {
      onError("Choose who the calls are going to.");
      return;
    }
    start(async () => {
      const res = await moveAssignments({
        date,
        fromId: target.fromId,
        toId,
        tab,
        count: picking ? null : Number(count) || null,
        enquiryIds: picking ? picked : null,
        targetDate,
      });
      if (res.error) {
        onError(res.error);
        return;
      }
      const to = roster.find((r) => r.id === toId)?.name ?? "them";
      onDone(
        `Moved ${res.moved} call${res.moved === 1 ? "" : "s"} from ${target.fromName} to ${to}` +
          (targetDate !== date ? ` for ${formatDate(targetDate)}` : "") +
          (res.skipped
            ? `. ${res.skipped} already had an assignment on that date.`
            : "."),
      );
    });
  }

  return (
    <Dialog title={`Move ${target.fromName}'s pending calls`} onClose={onClose}>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Category</span>
            <Select
              value={tab}
              onChange={(e) => {
                const next = e.target.value as MyDayTabKey | "all";
                setTab(next);
                if (picking) loadRows(next);
              }}
            >
              <option value="all">Every category</option>
              {MY_DAY_TABS.filter((t) => MOVABLE.includes(t.key)).map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>To</span>
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">—</option>
              {roster
                .filter((r) => r.id !== target.fromId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </label>

          {picking ? null : (
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>How many</span>
              <Input
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
              <span className="text-[11px] text-ink-3">
                Oldest handover first. {target.pending} pending in this cell.
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Date</span>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
            <span className="text-[11px] text-ink-3">
              {targetDate === date
                ? "Same day — a straight handover."
                : "Another day — the original stays on this day, marked carried."}
            </span>
          </label>
        </div>

        <div>
          <button
            type="button"
            className="text-[12px] text-accent underline underline-offset-2"
            onClick={() => {
              const next = !picking;
              setPicking(next);
              if (next) loadRows(tab);
            }}
          >
            {picking ? "← Move by count instead" : "Pick rows instead →"}
          </button>
        </div>

        {picking ? (
          <div className="max-h-[260px] overflow-y-auto rounded-md border border-line">
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-ink-3">
                {pending ? "Loading…" : "Nothing pending in this category."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {rows.map((r) => (
                  <li key={r.enquiryId} className="border-b border-line last:border-b-0">
                    <label className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                      <input
                        type="checkbox"
                        checked={picked.includes(r.enquiryId)}
                        onChange={(e) =>
                          setPicked((p) =>
                            e.target.checked
                              ? [...p, r.enquiryId]
                              : p.filter((x) => x !== r.enquiryId),
                          )
                        }
                      />
                      <span className="tabular-nums text-ink">
                        {formatMobile(r.mobile)}
                      </span>
                      <span className="text-ink-2">{r.name ?? "—"}</span>
                      {r.label ? (
                        <span className="text-[11px] text-ink-3">{r.label}</span>
                      ) : null}
                      <span className="ml-auto text-[11px] text-ink-3">
                        #{r.enquiryId}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-sunk px-4 py-2.5">
        <Button
          variant="primary"
          disabled={pending || (picking && picked.length === 0)}
          onClick={submit}
        >
          {pending
            ? "Moving…"
            : picking
              ? `Move ${picked.length} picked`
              : `Move ${count || 0}`}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * End of day: everything still pending, onto another date (§30.6).
 *
 * Per counsellor under the bonnet — carry_forward_assignments moves one
 * person's work and keeps it theirs — so this is that call repeated, and the
 * report says how many people it touched. Nobody's work changes hands here;
 * this is the day moving, not the owner.
 */
function CarryAllDialog({
  date,
  rows,
  defaultDate,
  onClose,
  onDone,
  onError,
}: {
  date: string;
  rows: { id: string; name: string; pending: number }[];
  defaultDate: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [toDate, setToDate] = useState(defaultDate ?? date);
  const [pending, start] = useTransition();
  const withWork = rows.filter((r) => r.pending > 0);

  function submit() {
    if (toDate === date) {
      onError("Choose a different date to carry forward to.");
      return;
    }
    start(async () => {
      let moved = 0;
      let skipped = 0;
      for (const r of withWork) {
        const res = await carryForward({
          date,
          counsellorId: r.id,
          toDate,
          tab: "all",
          enquiryIds: null,
        });
        if (res.error) {
          onError(`${r.name}: ${res.error}`);
          return;
        }
        moved += res.moved ?? 0;
        skipped += res.skipped ?? 0;
      }
      onDone(
        `Carried ${moved} call${moved === 1 ? "" : "s"} for ${withWork.length} counsellor${
          withWork.length === 1 ? "" : "s"
        } to ${formatDate(toDate)}` +
          (skipped ? `. ${skipped} ${skipped === 1 ? "was" : "were"} already assigned on that date.` : "."),
      );
    });
  }

  return (
    <Dialog title={`Carry forward everything still pending on ${formatDate(date)}`} onClose={onClose}>
      <div className="flex flex-col gap-3 px-4 py-3">
        <label className="flex w-[200px] flex-col gap-1">
          <span className={FIELD_LABEL}>To</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <ul className="flex flex-col gap-0.5 text-[12px] text-ink-2">
          {withWork.map((r) => (
            <li key={r.id}>
              {r.name} — {r.pending} pending
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] text-ink-3">
          Each call stays with the counsellor who has it, keeping its bucket and
          label. Anything already assigned on {formatDate(toDate)} is left alone
          rather than doubled.
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-sunk px-4 py-2.5">
        <Button variant="primary" disabled={pending} onClick={submit}>
          {pending ? "Carrying…" : "Carry forward"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
