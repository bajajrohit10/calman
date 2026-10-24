"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import {
  CALENDAR_KINDS,
  CALENDAR_KIND_LABELS,
  overrideToKind,
  type CalendarKind,
} from "@/lib/calendar-kinds";
import { formatDate } from "@/lib/format";

import { addHoliday, deleteHoliday, setHolidayKind } from "./actions";

export type HolidayRow = {
  date: string;
  name: string | null;
  is_active: boolean;
  is_working_override: boolean;
};

/** The next Sunday strictly after a YYYY-MM-DD date. */
function nextSunday(from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  const delta = ((7 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function HolidaysView({
  rows,
  today,
  error,
}: {
  rows: HolidayRow[];
  today: string;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CalendarKind>("holiday");
  const [note, setNote] = useState<string | null>(null);

  function run(fn: () => Promise<{ error: string | null }>) {
    setNote(null);
    start(async () => {
      const res = await fn();
      if (res.error) setNote(res.error);
      else router.refresh();
    });
  }

  const past = rows.filter((r) => r.date < today);
  const upcoming = rows.filter((r) => r.date >= today);
  const working = kind === "working_day";

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <ErrorNote>{note}</ErrorNote> : null}

      {/* §88. One form, two kinds, chosen by name.
          Until now the second kind was a separate "Add working Sunday" button,
          which both hid the kind behind a verb and promised less than the row
          can do: an open-this-date row opens any date, including a listed
          holiday the team decides to work after all. */}
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          // The old button's one-press convenience, kept: asking for a working
          // day without naming a date almost always means the Sunday coming.
          run(() =>
            addHoliday({ date: date || (working ? nextSunday(today) : ""), name, kind }),
          );
          setDate("");
          setName("");
        }}
      >
        <label className="flex flex-col gap-[3px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Date
          </span>
          <Input
            type="date"
            className="w-[160px]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Kind
          </span>
          <Select
            className="w-[150px]"
            aria-label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CalendarKind)}
          >
            {CALENDAR_KINDS.map((k) => (
              <option key={k} value={k}>
                {CALENDAR_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Name {working ? "(optional)" : null}
          </span>
          <Input
            value={name}
            placeholder={working ? "Why we are open" : "Diwali"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {working ? "Add working day" : "Add holiday"}
        </Button>
      </form>

      <p className="text-[12px] text-ink-3">
        {working
          ? "A working day opens a date the calendar would otherwise close — a Sunday, or a holiday the team has decided to work. Leave the date empty for the Sunday coming."
          : "A holiday closes a date, and any follow-up landing on it moves to the next working day."}
      </p>

      <Table
        title={`Upcoming (${upcoming.length})`}
        rows={upcoming}
        pending={pending}
        onFlip={(r, next) => run(() => setHolidayKind({ date: r.date, kind: next }))}
        onDelete={(r) => run(() => deleteHoliday(r.date))}
      />
      {past.length ? (
        <Table
          title={`Past (${past.length})`}
          rows={past}
          pending={pending}
          muted
          onFlip={(r, next) => run(() => setHolidayKind({ date: r.date, kind: next }))}
          onDelete={(r) => run(() => deleteHoliday(r.date))}
        />
      ) : null}
    </div>
  );
}

function Table({
  title,
  rows,
  pending,
  muted,
  onFlip,
  onDelete,
}: {
  title: string;
  rows: HolidayRow[];
  pending: boolean;
  muted?: boolean;
  onFlip: (r: HolidayRow, next: CalendarKind) => void;
  onDelete: (r: HolidayRow) => void;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[150px] px-2 py-[7px]">Date</th>
              <th className="w-[130px] px-2 py-[7px]">Kind</th>
              <th className="px-2 py-[7px]">Name</th>
              <th className="w-[170px] px-2 py-[7px]" />
            </tr>
          </thead>
          <tbody className={cx(muted ? "opacity-70" : "")}>
            {rows.map((r) => {
              const kind = overrideToKind(r.is_working_override);
              const next: CalendarKind = kind === "working_day" ? "holiday" : "working_day";
              return (
                <tr
                  key={r.date}
                  data-testid={`holiday-${r.date}`}
                  data-kind={kind}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-2 py-[6px] whitespace-nowrap text-ink">
                    {formatDate(r.date)}
                  </td>
                  <td className="px-2 py-[6px]">
                    {/* The kind as a pill, not a checkbox labelled "Open".
                        A list where every row is one of two things should be
                        readable down the column without parsing a control. */}
                    <Badge tone={kind === "working_day" ? "ok" : "warn"} dot>
                      {CALENDAR_KIND_LABELS[kind]}
                    </Badge>
                  </td>
                  <td className="px-2 py-[6px] text-ink-2">
                    {r.name || <span className="italic text-ink-3">—</span>}
                  </td>
                  <td className="flex gap-1 px-2 py-[6px]">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onFlip(r, next)}
                    >
                      Make {CALENDAR_KIND_LABELS[next].toLowerCase()}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onDelete(r)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-ink-3">
                  Nothing listed.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
