"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, Input, cx } from "@/components/ui";
import { formatDate, istToday } from "@/lib/format";

import { addAnalyticsEvent, deleteAnalyticsEvent } from "./actions";

type Row = { id: string; at: string; note: string; author: string | null };

/**
 * §83.3. Add a line, remove a line. Two fields and no taxonomy.
 *
 * A "kind of change" dropdown was the obvious thing to add and would have been
 * wrong: the value here is entirely in somebody bothering to type the sentence,
 * and every field after the second is a reason not to.
 */
export function EventsView({ rows, loadError }: { rows: Row[]; loadError: string | null }) {
  const router = useRouter();
  const [at, setAt] = useState(istToday());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setError(null);
    start(async () => {
      const res = await addAnalyticsEvent({ at, note });
      if (res.error) setError(res.error);
      else {
        setNote("");
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const res = await deleteAnalyticsEvent(id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface px-2.5 py-2.5 shadow-card">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Date
          </span>
          <Input
            type="date"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            aria-label="Event date"
            className="w-[150px]"
          />
        </label>
        <label className="block flex-1 min-w-[260px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            What changed
          </span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="What changed"
            placeholder="student discount 8% → 21%"
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) {
                e.preventDefault();
                add();
              }
            }}
          />
        </label>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending || !note.trim()}
          onClick={add}
        >
          {pending ? "Saving…" : "Add"}
        </Button>
      </div>

      {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
      {loadError ? <p className="text-[12.5px] text-danger">{loadError}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]" data-testid="events">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[120px] px-1.5 py-[7px]">Date</th>
              <th className="px-1.5 py-[7px]">What changed</th>
              <th className="w-[130px] px-1.5 py-[7px]">Added by</th>
              <th className="w-[70px] px-1.5 py-[7px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="px-1.5 py-[5px] whitespace-nowrap tabular-nums text-ink-2">
                  {formatDate(r.at)}
                </td>
                <td className="px-1.5 py-[5px] text-ink">{r.note}</td>
                <td className="px-1.5 py-[5px] text-ink-3">{r.author ?? "—"}</td>
                <td className="px-1.5 py-[5px]">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(r.id)}
                    className={cx(
                      "text-[11.5px] text-ink-3 underline-offset-2",
                      "hover:text-danger hover:underline disabled:opacity-60",
                    )}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-ink-3">
                  Nothing recorded yet. The first one might be a price change.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
