"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, ErrorNote, Input, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";

import { addHoliday, deleteHoliday, setHolidayWorking } from "./actions";

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

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <ErrorNote>{note}</ErrorNote> : null}

      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addHoliday({ date, name, isWorkingOverride: false }));
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
        <label className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Name
          </span>
          <Input
            value={name}
            placeholder="Diwali"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          Add holiday
        </Button>
        {/* §54.2(b). The other kind of row, one click away: the team has
            decided to work a Sunday and the picker needs to know. The date
            defaults to the next one so the common case is a single press. */}
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(() =>
              addHoliday({
                date: date || nextSunday(today),
                name: "",
                isWorkingOverride: true,
              }),
            )
          }
        >
          Add working Sunday
        </Button>
      </form>

      <Table
        title={`Upcoming (${upcoming.length})`}
        rows={upcoming}
        pending={pending}
        onToggle={(r) =>
          run(() => setHolidayWorking({ date: r.date, working: !r.is_working_override }))
        }
        onDelete={(r) => run(() => deleteHoliday(r.date))}
      />
      {past.length ? (
        <Table
          title={`Past (${past.length})`}
          rows={past}
          pending={pending}
          muted
          onToggle={(r) =>
            run(() => setHolidayWorking({ date: r.date, working: !r.is_working_override }))
          }
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
  onToggle,
  onDelete,
}: {
  title: string;
  rows: HolidayRow[];
  pending: boolean;
  muted?: boolean;
  onToggle: (r: HolidayRow) => void;
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
              <th className="px-2 py-[7px]">Name</th>
              <th className="w-[150px] px-2 py-[7px]">Working day</th>
              <th className="w-[90px] px-2 py-[7px]" />
            </tr>
          </thead>
          <tbody className={cx(muted ? "opacity-70" : "")}>
            {rows.map((r) => (
              <tr key={r.date} className="border-b border-line last:border-b-0">
                <td className="px-2 py-[6px] whitespace-nowrap text-ink">
                  {formatDate(r.date)}
                </td>
                <td className="px-2 py-[6px] text-ink-2">
                  {r.name || (
                    <span className="italic text-ink-3">working Sunday</span>
                  )}
                </td>
                <td className="px-2 py-[6px]">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={r.is_working_override}
                      disabled={pending}
                      onChange={() => onToggle(r)}
                    />
                    {r.is_working_override ? "Open" : "Closed"}
                  </label>
                </td>
                <td className="px-2 py-[6px]">
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
            ))}
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
