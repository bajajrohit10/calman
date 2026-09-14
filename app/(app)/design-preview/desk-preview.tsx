"use client";

import { useState } from "react";

import { Badge, Button, ImportanceMark, Input, Select, cx } from "@/components/ui";

/* Invented data. Enough rows to judge density, enough variety to judge colour. */
const ROWS = [
  { id: 4821, name: "Ritu Agarwal", mobile: "9876543210", bucket: "follow_up", importance: "A", teachers: ["Bhanwar Borana", "Vijay Sarda"], term: "Nov-26", due: "14 Sept", stage: "1st follow-up", last: "Neha · 11 Sept" },
  { id: 4822, name: "Karan Mehta", mobile: "9812003456", bucket: "call_back", importance: "B", teachers: ["Darshan Khare"], term: "May-27", due: "14 Sept", stage: "Fresh – Call back", last: "Susmita · 12 Sept" },
  { id: 4823, name: "Priya Nair", mobile: "9900112233", bucket: "fresh", importance: "A", teachers: [], term: "Nov-26", due: "—", stage: "Not yet called", last: "never" },
  { id: 4824, name: "Amit Shah", mobile: "9745001122", bucket: "offer", importance: "C", teachers: ["Pranav Popat", "CA Ranjan"], term: "Jan-27", due: "14 Sept", stage: "2nd", last: "Akanksha · 9 Sept" },
  { id: 4825, name: "Sneha Rao", mobile: "9663554411", bucket: "campaign", importance: "B", teachers: ["Shubham Keswani"], term: "May-27", due: "14 Sept", stage: "3rd", last: "Neha · 8 Sept" },
  { id: 4826, name: "Imran Qureshi", mobile: "9821445566", bucket: "follow_up", importance: "D", teachers: ["Aaditya Jain"], term: "Nov-26", due: "13 Sept", stage: "1st follow-up", last: "Udesh · 10 Sept" },
  { id: 4827, name: "Deepa Iyer", mobile: "9448899001", bucket: "fresh", importance: null, teachers: [], term: "—", due: "—", stage: "Not yet called", last: "never" },
  { id: 4828, name: "Rahul Verma", mobile: "9930011223", bucket: "follow_up", importance: "A", teachers: ["Bhanwar Borana"], term: "Nov-26", due: "12 Sept", stage: "2nd", last: "Susmita · 7 Sept" },
];

const ROSTER = [
  { name: "Neha Saraf", pending: 12, done: 18 },
  { name: "Susmita Barua", pending: 4, done: 21 },
  { name: "Akanksha", pending: 19, done: 3 },
  { name: "Udesh Mishara", pending: 0, done: 14 },
  { name: "Bipasha Dutta", pending: 7, done: 9 },
];

/** The bucket, as a colour on the row's edge rather than a word in a column. */
const BUCKET_EDGE: Record<string, string> = {
  follow_up: "var(--info)",
  call_back: "var(--warn)",
  fresh: "var(--accent)",
  offer: "var(--ok)",
  campaign: "var(--ink-3)",
};
const BUCKET_NAME: Record<string, string> = {
  follow_up: "Follow-up",
  call_back: "Call back",
  fresh: "Fresh",
  offer: "Offer",
  campaign: "Campaign",
};

const PRESETS = ["Today's follow-ups", "Call backs", "Never called", "Offer leads", "Overdue"];

export function DeskPreview() {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);

  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="relative flex flex-col gap-3 pb-16">
      {/* ---- 1. the state of the day, then the ways in ---- */}
      <div className="flex flex-wrap items-end gap-6 rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
        {[
          { label: "Needs assignment", value: 34, tone: "text-accent" },
          { label: "Pending", value: 42, tone: "text-ink" },
          { label: "Done", value: 65, tone: "text-ink-2" },
        ].map((c) => (
          <div key={c.label}>
            <p className={cx("text-[30px] font-semibold leading-none tabular-nums", c.tone)}>
              {c.value}
            </p>
            <p className="mt-1 text-[11.5px] text-ink-3">{c.label}</p>
          </div>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-1">
          {PRESETS.map((p, i) => (
            <span
              key={p}
              className={cx(
                "cursor-pointer rounded-full border px-2.5 py-[3px] text-[11.5px]",
                i === 0
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-line-2 bg-surface-2 text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* ---- 2. the filter card, reduced to what is actually set ---- */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-card">
        <Input type="date" defaultValue="2026-09-14" className="h-[26px] w-[140px]" />
        <Select defaultValue="needs" className="h-[26px] w-[150px]">
          <option value="needs">Needs assignment</option>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
          <option value="any">Any</option>
        </Select>

        {/* The chips are the filters that are on. Nothing set, nothing shown. */}
        <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-[2px] text-[11.5px] text-accent">
          Teacher: Bhanwar Borana
          <button type="button" className="opacity-60 hover:opacity-100">×</button>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-[2px] text-[11.5px] text-accent">
          Importance: A, B
          <button type="button" className="opacity-60 hover:opacity-100">×</button>
        </span>

        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="inline-flex h-[26px] items-center rounded-md border border-line-2 bg-surface px-2.5 text-[12.5px] font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
        >
          Filters {filtersOpen ? "−" : "+"}
        </button>
        <button
          type="button"
          className="inline-flex h-[26px] items-center rounded-md border border-accent/50 bg-accent-soft px-2.5 text-[12.5px] font-medium text-accent"
        >
          Smart assign
        </button>
        <span className="ml-auto text-[12px] text-ink-3">34 leads</span>
      </div>

      {filtersOpen ? (
        <div className="rounded-lg border border-line bg-surface p-3 shadow-panel">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Every filter, in one place
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11.5px] text-ink-3 sm:grid-cols-4 lg:grid-cols-6">
            {["Teacher", "Institute", "Course", "Subject", "Content", "Term", "Source",
              "Importance", "Stage", "Last called by", "Last outcome", "Offer",
              "Status", "Type", "Created", "Follow-up", "Discussion", "No detail"].map((f) => (
              <label key={f} className="flex flex-col gap-1">
                <span className="font-semibold text-ink-3">{f}</span>
                <Select className="h-[26px]">
                  <option>Any</option>
                </Select>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-3">
        {/* ---- 3. the table, denser ---- */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                <th className="w-[28px] px-2 py-[6px]" />
                <th className="px-2 py-[6px]">Student</th>
                <th className="w-[30px] px-1 py-[6px]" />
                <th className="px-2 py-[6px]">Interests</th>
                <th className="w-[70px] px-2 py-[6px]">Term</th>
                <th className="w-[90px] px-2 py-[6px]">Stage</th>
                <th className="w-[70px] px-2 py-[6px]">Due</th>
                <th className="w-[120px] px-2 py-[6px]">Last called</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => toggle(r.id)}
                  title={BUCKET_NAME[r.bucket]}
                  className={cx(
                    "cursor-pointer border-b border-line last:border-b-0",
                    picked.has(r.id) && "bg-accent-pick",
                  )}
                  style={{ boxShadow: `inset 3px 0 0 ${BUCKET_EDGE[r.bucket]}` }}
                >
                  <td className="px-2 py-[4px]">
                    <input type="checkbox" checked={picked.has(r.id)} readOnly />
                  </td>
                  <td className="px-2 py-[4px] whitespace-nowrap">
                    <span className="text-ink">{r.name}</span>
                    <span className="ml-1.5 tabular-nums text-ink-3 underline-offset-2 hover:underline">
                      {r.mobile}
                    </span>
                  </td>
                  <td className="px-1 py-[4px]">
                    {r.importance ? <ImportanceMark grade={r.importance as "A"} /> : null}
                  </td>
                  <td className="px-2 py-[4px]">
                    {r.teachers.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.teachers.map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-line-2 bg-surface-2 px-1.5 py-[1px] text-[11px] whitespace-nowrap text-ink-2"
                          >
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-[11.5px] italic text-ink-3">no interests</span>
                    )}
                  </td>
                  <td className="px-2 py-[4px] whitespace-nowrap text-ink-3">{r.term}</td>
                  <td className="px-2 py-[4px] whitespace-nowrap text-ink-3">{r.stage}</td>
                  <td className="px-2 py-[4px] whitespace-nowrap text-ink-3">{r.due}</td>
                  <td className="px-2 py-[4px] whitespace-nowrap text-ink-3">{r.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
            {Object.entries(BUCKET_NAME).map(([k, name]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-[10px] w-[3px] rounded-sm"
                  style={{ background: BUCKET_EDGE[k] }}
                />
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* ---- 4. the roster, as a sidebar you can read at a glance ---- */}
        <aside className="w-[230px] shrink-0 rounded-lg border border-line bg-surface px-3 py-3 shadow-card">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Today&apos;s load
          </p>
          <ul className="flex flex-col gap-2.5">
            {ROSTER.map((c) => {
              const total = c.pending + c.done || 1;
              return (
                <li key={c.name}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {c.name}
                    </span>
                    <span className="text-[11.5px] tabular-nums text-ink-2">
                      {c.pending}
                      <span className="text-ink-3">/{c.pending + c.done}</span>
                    </span>
                  </div>
                  <div className="mt-1 flex h-[5px] overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="bg-accent"
                      style={{ width: `${(c.pending / total) * 100}%` }}
                    />
                    <span
                      className="bg-ok/60"
                      style={{ width: `${(c.done / total) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Accent is still to call, green is done. The bar is the day, so a
            counsellor with nothing left reads as full green at a glance.
          </p>
        </aside>
      </div>

      {/* ---- 5. the action, only when there is something to act on ---- */}
      {picked.size ? (
        <div className="sticky bottom-3 z-20 mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-surface px-3 py-2 shadow-panel">
          <span className="text-[13px] font-semibold text-ink">
            {picked.size} selected
          </span>
          <Button variant="primary" size="sm">
            Assign {picked.size} to ▾
          </Button>
          <Button variant="secondary" size="sm">
            Split {picked.size} across ▾
          </Button>
          <Select className="h-[26px] w-[150px]">
            <option>Campaign label…</option>
          </Select>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className="ml-auto text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Clear
          </button>
        </div>
      ) : (
        <p className="text-center text-[11.5px] text-ink-3">
          Select rows to assign — the action bar appears here.
        </p>
      )}

      <div className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[12px] leading-relaxed text-ink-3">
        <Badge tone="warn">Preview</Badge> Nothing on this page is wired up. The
        data is invented; the density, the colour coding and the interactions
        are the proposal.
      </div>
    </div>
  );
}
