"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, Input, Select, cx } from "@/components/ui";
import { formatDate, istToday } from "@/lib/format";
import { SCOPE_LABELS, type ScopeType } from "@/lib/analytics-shape";

import {
  addAnalyticsEvent,
  deleteAnalyticsEvent,
  setAnalyticsEventEnd,
} from "./actions";

export type EventRow = {
  id: string;
  note: string;
  metric_note: string | null;
  scope_type: ScopeType;
  scope_label: string;
  start_date: string;
  end_date: string | null;
  author: string | null;
};

export type Options = {
  teachers: { id: string; name: string }[];
  institutes: { id: string; name: string }[];
  /** §84.2: the subject names the course·subject pair on its own. */
  subjects: { id: string; label: string }[];
};

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";

/**
 * §84.2. Record an experiment: what changed, who it applied to, and when.
 *
 * Six fields, which is four more than §83 had, and each one is here because the
 * Experiments tab cannot answer "did it work" without it. The scope picker collapses
 * to nothing when it says Everyone, so the common case is still two fields and a
 * date.
 */
export function EventsView({
  rows,
  options,
  loadError,
}: {
  rows: EventRow[];
  options: Options;
  loadError: string | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [scopeId, setScopeId] = useState("");
  const [startDate, setStartDate] = useState(istToday());
  const [endDate, setEndDate] = useState("");
  const [metricNote, setMetricNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choices = useMemo(() => {
    if (scopeType === "teacher") return options.teachers.map((t) => ({ id: t.id, label: t.name }));
    if (scopeType === "institute") return options.institutes.map((i) => ({ id: i.id, label: i.name }));
    if (scopeType === "course_subject") return options.subjects;
    return [];
  }, [scopeType, options]);

  function add() {
    setError(null);
    start(async () => {
      const res = await addAnalyticsEvent({
        note,
        scopeType,
        scopeId: scopeType === "all" ? null : scopeId || null,
        startDate,
        endDate: endDate || null,
        metricNote: metricNote || null,
      });
      if (res.error) setError(res.error);
      else {
        setNote("");
        setMetricNote("");
        setEndDate("");
        router.refresh();
      }
    });
  }

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface px-2.5 py-2.5 shadow-card">
        <label className="block min-w-[240px] flex-1">
          <span className={LABEL}>What changed</span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="What changed"
            placeholder="student discount 8% → 21%"
          />
        </label>
        <label className="block">
          <span className={LABEL}>Applies to</span>
          <Select
            value={scopeType}
            aria-label="Applies to"
            onChange={(e) => {
              setScopeType(e.target.value as ScopeType);
              setScopeId("");
            }}
          >
            {(Object.keys(SCOPE_LABELS) as ScopeType[]).map((k) => (
              <option key={k} value={k}>{SCOPE_LABELS[k]}</option>
            ))}
          </Select>
        </label>
        {scopeType !== "all" ? (
          <label className="block">
            <span className={LABEL}>Which</span>
            <Select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              aria-label="Which"
              className="max-w-[220px]"
            >
              <option value="">Choose…</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="block">
          <span className={LABEL}>From</span>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="From"
            className="w-[150px]"
          />
        </label>
        <label className="block">
          <span className={LABEL}>To (optional)</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="To"
            className="w-[150px]"
          />
        </label>
        <label className="block min-w-[180px]">
          <span className={LABEL}>What to watch (optional)</span>
          <Input
            value={metricNote}
            onChange={(e) => setMetricNote(e.target.value)}
            aria-label="What to watch"
            placeholder="conversion"
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
        <table className="w-full min-w-[820px] border-collapse text-[12.5px]" data-testid="events">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-1.5 py-[7px]">What changed</th>
              <th className="w-[180px] px-1.5 py-[7px]">Applies to</th>
              <th className="w-[190px] px-1.5 py-[7px]">Window</th>
              <th className="w-[120px] px-1.5 py-[7px]">Added by</th>
              <th className="w-[160px] px-1.5 py-[7px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="px-1.5 py-[5px] text-ink">
                  {r.note}
                  {r.metric_note ? (
                    <span className="ml-1.5 text-[11px] text-ink-3">watching {r.metric_note}</span>
                  ) : null}
                </td>
                <td className="px-1.5 py-[5px] text-ink-2">{r.scope_label}</td>
                <td className="px-1.5 py-[5px] whitespace-nowrap text-ink-2">
                  {formatDate(r.start_date)} →{" "}
                  {r.end_date ? (
                    formatDate(r.end_date)
                  ) : (
                    <span className="font-medium text-ok" data-testid="live">live</span>
                  )}
                </td>
                <td className="px-1.5 py-[5px] text-ink-3">{r.author ?? "—"}</td>
                <td className="px-1.5 py-[5px]">
                  <span className="flex items-center gap-2">
                    {r.end_date ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => setAnalyticsEventEnd({ id: r.id, endDate: null }))}
                        className="text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
                      >
                        Reopen
                      </button>
                    ) : (
                      <label className="flex items-center gap-1">
                        <span className="sr-only">End date</span>
                        <Input
                          type="date"
                          aria-label={`End ${r.note}`}
                          className="h-[24px] w-[128px] text-[11.5px]"
                          onChange={(e) =>
                            e.target.value &&
                            run(() => setAnalyticsEventEnd({ id: r.id, endDate: e.target.value }))
                          }
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => deleteAnalyticsEvent(r.id))}
                      className={cx(
                        "text-[11.5px] text-ink-3 underline-offset-2",
                        "hover:text-danger hover:underline disabled:opacity-60",
                      )}
                    >
                      Delete
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-3">
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
