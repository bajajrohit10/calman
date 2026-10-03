"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Input, PageHeader, Select, cx } from "@/components/ui";
import {
  avgSale,
  change,
  conversion,
  type AnalyticsScope,
  type CourseRow,
  type InstituteRow,
  type ProductRow,
  type Row,
  type TeacherRow,
  type Totals,
} from "@/lib/analytics-shape";
import type { Insight } from "@/lib/analytics-insights";

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";
const money = (v: number) => (v ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
const num = (v: number) => (v ? String(v) : "—");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** §82.4. How many rows before the list is folded behind "Show all". */
const COLLAPSED_ROWS = 10;

/** ▲12% / ▼30% / nothing when the previous window had no basis for a comparison. */
function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  const c = change(now, before);
  if (c === null) return <span className="text-[11px] text-ink-3">—</span>;
  if (Math.abs(c) < 0.005) return <span className="text-[11px] text-ink-3">0%</span>;
  const up = c > 0;
  // §82.1. On a Lost column a rise is bad news, so the colour follows the
  // meaning rather than the arithmetic. The arrow still follows the number.
  const good = invert ? !up : up;
  return (
    <span className={cx("text-[11px] tabular-nums", good ? "text-ok" : "text-danger")}>
      {up ? "▲" : "▼"}
      {Math.abs(Math.round(c * 100))}%
    </span>
  );
}

/**
 * §82.1. The metrics strip.
 *
 * Nine figures for the period with the change in each beneath, from one SQL
 * function called twice — so the strip cannot drift from the tables about what
 * "purchased" counts. It sits above the insights because it is the thing a
 * manager came to read; the cards are what they would not have thought to look
 * for.
 */
function MetricStrip({ now, prev, days }: { now: Totals; prev: Totals; days: number }) {
  const cards: {
    label: string;
    value: string;
    now: number;
    before: number;
    invert?: boolean;
    hint?: string;
  }[] = [
    { label: "Leads", value: String(now.leads), now: now.leads, before: prev.leads },
    {
      label: "Called",
      value: pct(conversion(now.called, now.leads)),
      now: now.called,
      before: prev.called,
      hint: `${now.called} of ${now.leads}`,
    },
    { label: "Purchased", value: String(now.purchased), now: now.purchased, before: prev.purchased },
    {
      label: "Revenue",
      value: money(Number(now.revenue)),
      now: Number(now.revenue),
      before: Number(prev.revenue),
    },
    {
      label: "Conversion",
      value: pct(conversion(now.purchased, now.leads)),
      now: now.purchased,
      before: prev.purchased,
    },
    {
      label: "Avg sale",
      value: money(avgSale(Number(now.revenue), now.wonItems) ?? 0),
      now: Number(now.revenue),
      before: Number(prev.revenue),
      hint: `over ${now.wonItems} sold lines`,
    },
    {
      label: "Lost · competitor",
      value: String(now.lostCompetitor),
      now: now.lostCompetitor,
      before: prev.lostCompetitor,
      invert: true,
    },
    {
      label: "Lost · not interested",
      value: String(now.lostNotInterested),
      now: now.lostNotInterested,
      before: prev.lostNotInterested,
      invert: true,
    },
    {
      label: "Lost · no response",
      value: String(now.lostNoResponse),
      now: now.lostNoResponse,
      before: prev.lostNoResponse,
      invert: true,
    },
    {
      label: "Open follow-ups",
      value: String(now.openFollowUps),
      now: now.openFollowUps,
      before: prev.openFollowUps,
    },
  ];

  return (
    <section
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      data-testid="metric-strip"
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-0.5 rounded-lg border border-line-2 bg-surface px-3 py-2 shadow-card"
          data-testid={`metric-${c.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
        >
          <span className={LABEL}>{c.label}</span>
          <span className="text-[19px] font-semibold leading-tight tabular-nums text-ink">
            {c.value}
          </span>
          <span className="flex items-baseline gap-1.5">
            <Delta now={c.now} before={c.before} invert={c.invert} />
            <span className="text-[10.5px] text-ink-3">
              {c.hint ?? `vs prev ${days}d`}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * §82.4. The columns, split into the ones worth the width and the rest.
 *
 * Seven core columns is what fits without scrolling on a laptop, and the four
 * behind the toggle are the ones that answered a question somebody asked once.
 * Hidden rather than removed: "items lost to competitor" is the only place the
 * teacher-level competitor signal lives, and dropping it would lose the answer
 * rather than tidy the table.
 */
type Col = {
  key: string;
  /** Marks the one column the body renders itself. */
  key_is_name?: boolean;
  label: string;
  more?: boolean;
  /** Right-aligned, which is everything except the name. */
  cell: (r: Row) => React.ReactNode;
  /** CSV value, and the sort key. */
  value: (r: Row) => string;
  sort?: (r: Row) => number;
};

const COLUMNS: Col[] = [
  {
    key: "name",
    // The name cell carries a link and an institute sub-label, so the table body
    // renders it directly; this entry exists for the header, the sort and the CSV.
    key_is_name: true,
    label: "Name",
    cell: () => null,
    value: (r) => r.label,
  },
  {
    key: "enquiries",
    label: "Enquiries",
    cell: (r) => <span className="font-semibold text-ink">{r.enquiries}</span>,
    value: (r) => String(r.enquiries),
    sort: (r) => r.enquiries,
  },
  {
    key: "purchased",
    label: "Purchased",
    cell: (r) => <span className="text-ink">{num(r.purchased)}</span>,
    value: (r) => String(r.purchased),
    sort: (r) => r.purchased,
  },
  {
    key: "amount",
    label: "Revenue",
    cell: (r) => <span className="text-ink-2">{money(Number(r.amount))}</span>,
    value: (r) => String(Number(r.amount)),
    sort: (r) => Number(r.amount),
  },
  {
    key: "conversion",
    label: "Conversion %",
    cell: (r) => <span className="text-ink">{pct(conversion(r.purchased, r.enquiries))}</span>,
    value: (r) => {
      const c = conversion(r.purchased, r.enquiries);
      return c === null ? "" : `${Math.round(c * 100)}%`;
    },
    sort: (r) => conversion(r.purchased, r.enquiries) ?? -1,
  },
  {
    key: "lost_competitor",
    label: "Competitor",
    cell: (r) => <span className="text-ink-2">{num(r.lost_competitor)}</span>,
    value: (r) => String(r.lost_competitor),
    sort: (r) => r.lost_competitor,
  },
  {
    key: "lost_no_response",
    label: "No response",
    cell: (r) => <span className="text-ink-2">{num(r.lost_no_response)}</span>,
    value: (r) => String(r.lost_no_response),
    sort: (r) => r.lost_no_response,
  },
  {
    key: "prev",
    label: "vs prev",
    cell: (r) => <Delta now={r.enquiries} before={r.prev_enquiries} />,
    value: (r) => String(r.prev_enquiries),
    sort: (r) => change(r.enquiries, r.prev_enquiries) ?? -Infinity,
  },
  {
    key: "lost_not_interested",
    label: "Not interested",
    more: true,
    cell: (r) => <span className="text-ink-2">{num(r.lost_not_interested)}</span>,
    value: (r) => String(r.lost_not_interested),
    sort: (r) => r.lost_not_interested,
  },
  {
    key: "lost_wrong_number",
    label: "Wrong number",
    more: true,
    cell: (r) => <span className="text-ink-3">{num(r.lost_wrong_number)}</span>,
    value: (r) => String(r.lost_wrong_number),
    sort: (r) => r.lost_wrong_number,
  },
  {
    key: "items_lost_competitor",
    label: "Items lost to competitor",
    more: true,
    cell: (r) => <span className="text-ink-3">{num(r.items_lost_competitor)}</span>,
    value: (r) => String(r.items_lost_competitor),
    sort: (r) => r.items_lost_competitor,
  },
  {
    key: "in_progress",
    label: "Open follow-ups",
    more: true,
    cell: (r) => <span className="text-ink-2">{num(r.in_progress)}</span>,
    value: (r) => String(r.in_progress),
    sort: (r) => r.in_progress,
  },
];

/**
 * One table for all three grains.
 *
 * §82.2 made Products a table with the teacher table's columns, so there is one
 * component rather than three — which is also what stops the three drifting
 * apart the way the panel's two layouts did in §79.
 */
function DemandTable({
  rows,
  sort,
  onSort,
  showMore,
  expanded,
  onExpand,
  nameHeader,
}: {
  rows: Row[];
  sort: { key: string; desc: boolean };
  onSort: (key: string) => void;
  showMore: boolean;
  expanded: boolean;
  onExpand: () => void;
  nameHeader: string;
}) {
  const cols = COLUMNS.filter((c) => showMore || !c.more);
  // Untagged is pinned last whatever the sort: it is the measure of how much of
  // the page cannot be attributed, not a competitor for "busiest".
  const real = rows.filter((r) => r.id);
  const untagged = rows.filter((r) => !r.id);
  const col = COLUMNS.find((c) => c.key === sort.key);
  const sorted = [...real].sort((a, b) => {
    if (!col?.sort) {
      return sort.desc ? b.label.localeCompare(a.label) : a.label.localeCompare(b.label);
    }
    const d = col.sort(a) - col.sort(b);
    return sort.desc ? -d : d;
  });
  const shown = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const hidden = sorted.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[12.5px]" data-testid="demand-table">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={cx("px-1.5 py-[7px]", c.key === "name" ? "text-left" : "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={cx("hover:text-ink", sort.key === c.key && "text-ink")}
                  >
                    {c.key === "name" ? nameHeader : c.label}
                    {sort.key === c.key ? (sort.desc ? " ▾" : " ▴") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...shown, ...untagged].map((r) => (
              <tr
                key={r.id ?? "untagged"}
                id={r.id ? `row-${r.id}` : "row-untagged"}
                data-testid={r.id ? "row-demand" : "row-untagged"}
                className={cx(
                  "border-b border-line last:border-b-0",
                  !r.id && "bg-warn-soft/25 italic",
                )}
              >
                <td className="px-1.5 py-[5px] text-ink">
                  {r.href ? (
                    <Link href={r.href} prefetch={false} className="hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                  {r.sub ? (
                    <span className="ml-1.5 text-[11px] text-ink-3">{r.sub}</span>
                  ) : null}
                </td>
                {cols.slice(1).map((c) => (
                  <td key={c.key} className="px-1.5 py-[5px] text-right tabular-nums">
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-3 py-8 text-center text-ink-3">
                  No leads in this period with these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={onExpand}
          data-testid="show-all"
          className="self-start text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          Show all ({sorted.length})
        </button>
      ) : null}
    </div>
  );
}

export function AnalyticsView(props: {
  filters: {
    from: string;
    to: string;
    courseId: string | null;
    subjectId: string | null;
    sourceId: string | null;
    counsellorId: string | null;
    termId: string | null;
  };
  query: string;
  tab: "teachers" | "products";
  by: "teacher" | "institute";
  error: string | null;
  scope: AnalyticsScope | null;
  teachers: TeacherRow[];
  institutes: InstituteRow[];
  courses: CourseRow[];
  products: ProductRow[];
  insights: Insight[];
  timings: Record<string, number>;
  masters: {
    courses: { id: string; name: string }[];
    subjects: { id: string; name: string; course_id: string | null }[];
    sources: { id: string; name: string }[];
    terms: { id: string; name: string }[];
  };
  staff: { id: string; full_name: string | null }[];
}) {
  const { scope, filters, query, tab, by } = props;
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: "enquiries",
    desc: true,
  });
  const [showMore, setShowMore] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams(query);
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/analytics?${p.toString()}`;
  };

  const period = `createdFrom=${filters.from}&createdTo=${filters.to}`;

  /** The three grains, flattened into the one row shape the table takes. */
  const rows: Row[] = useMemo(() => {
    if (tab === "products") {
      return props.courses.map((r) => ({
        ...r,
        /**
         * Composite, because the course alone is not the row.
         *
         * A course has one row per subject, so keying on course_id gave React
         * duplicate keys — it was omitting and re-using rows, and the anchors
         * the insight links point at collided too. The subject is part of the
         * identity here in a way it is not on the teacher table.
         */
        id: r.course_id ? `${r.course_id}:${r.subject_id ?? "none"}` : null,
        label: r.course_id ? `${r.course_name} · ${r.subject_name}` : "Untagged",
        href: r.course_id
          ? `/enquiries?course=${r.course_id}${r.subject_id ? `&subject=${r.subject_id}` : ""}&${period}`
          : null,
      }));
    }
    if (by === "institute") {
      return props.institutes.map((r) => ({
        ...r,
        id: r.institute_id,
        label: r.institute_name,
        // The Enquiries list has no institute filter, so an institute row has no
        // list of its own to open. Its teachers each do.
        href: null,
      }));
    }
    return props.teachers.map((r) => ({
      ...r,
      id: r.teacher_id,
      label: r.teacher_name,
      sub: r.institute_name,
      href: r.teacher_id ? `/enquiries?teacher=${r.teacher_id}&${period}` : null,
    }));
  }, [tab, by, props.teachers, props.institutes, props.courses, period]);

  /** The current tab as CSV, with a BOM — the convention everywhere else here. */
  function exportCsv() {
    const cols = COLUMNS.filter((c) => showMore || !c.more);
    const out: string[][] = [cols.map((c) => c.label)];
    for (const r of rows) out.push(cols.map((c) => c.value(r)));
    if (tab === "products") {
      out.push([]);
      out.push(["Product text", "Enquiries", "Purchased", "Conversion %"]);
      for (const p of props.products) {
        const c = conversion(p.purchased, p.enquiries);
        out.push([
          p.product,
          String(p.enquiries),
          String(p.purchased),
          c === null ? "" : `${Math.round(c * 100)}%`,
        ]);
      }
    }
    const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = `﻿${out.map((r) => r.map(esc).join(",")).join("\r\n")}\r\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = `calman-analytics-${tab}-${filters.from}-to-${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const subjects = filters.courseId
    ? props.masters.subjects.filter((s) => s.course_id === filters.courseId)
    : props.masters.subjects;
  const slowest = Math.max(0, ...Object.values(props.timings));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Analytics"
        description="Which teachers and courses students ask for, what they buy, and where demand is going. Read-only."
      />

      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-end gap-2 p-2.5">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="by" value={by} />
          <label className="block">
            <span className={LABEL}>Period</span>
            <div className="flex items-center gap-1.5">
              <Input type="date" name="from" defaultValue={filters.from} aria-label="From" />
              <span className="text-[12px] text-ink-3">→</span>
              <Input type="date" name="to" defaultValue={filters.to} aria-label="To" />
            </div>
          </label>
          <label className="block">
            <span className={LABEL}>Course</span>
            <Select name="course" defaultValue={filters.courseId ?? ""} aria-label="Course filter">
              <option value="">All</option>
              {props.masters.courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className={LABEL}>Subject</span>
            <Select name="subject" defaultValue={filters.subjectId ?? ""} aria-label="Subject filter">
              <option value="">All</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </label>
          {/* §82.2. Term's only home now: a filter, not a dimension. */}
          <label className="block">
            <span className={LABEL}>Term</span>
            <Select name="term" defaultValue={filters.termId ?? ""} aria-label="Term filter">
              <option value="">All</option>
              {props.masters.terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className={LABEL}>Source</span>
            <Select name="source" defaultValue={filters.sourceId ?? ""} aria-label="Source filter">
              <option value="">All</option>
              {props.masters.sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className={LABEL}>Counsellor (called by)</span>
            <Select
              name="counsellor"
              defaultValue={filters.counsellorId ?? ""}
              aria-label="Counsellor filter"
            >
              <option value="">All</option>
              {props.staff.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name ?? "(no name)"}</option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="primary" size="sm">Show</Button>
          <span className="ml-auto">
            <Button type="button" size="sm" variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
          </span>
        </div>
      </form>

      {props.error ? (
        <p className="rounded-md border border-danger/50 bg-danger-soft/40 px-3 py-2 text-[12.5px] text-danger">
          {props.error}
        </p>
      ) : null}

      {scope ? <MetricStrip now={scope.now} prev={scope.prev} days={scope.days} /> : null}

      {props.insights.length ? (
        <section className="flex flex-col gap-1.5" data-testid="insights">
          <h2 className="text-[13px] font-semibold text-ink">
            What stands out{" "}
            <span className="font-normal text-ink-3">({props.insights.length})</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {props.insights.map((i) => (
              <Link
                key={i.id}
                href={i.href}
                prefetch={false}
                data-testid={`insight-${i.kind}`}
                className={cx(
                  "flex flex-col gap-1 rounded-lg border px-3 py-2 shadow-card hover:border-accent",
                  i.tone === "danger" && "border-danger/45 bg-danger-soft/30",
                  i.tone === "warn" && "border-warn/45 bg-warn-soft/30",
                  i.tone === "ok" && "border-ok/45 bg-ok-soft/30",
                  i.tone === "info" && "border-line-2 bg-surface-2",
                )}
              >
                <span className="text-[12.5px] leading-relaxed text-ink">{i.text}</span>
                <span className="text-[11.5px] text-ink-2">{i.action}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5" role="tablist">
        {([
          { key: "teachers", label: "Teachers" },
          { key: "products", label: "Products" },
        ] as const).map((t) => (
          <Link
            key={t.key}
            href={href({ tab: t.key })}
            prefetch={false}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx(
              "rounded-full border px-3 py-1 text-[12.5px]",
              tab === t.key
                ? "border-accent bg-accent font-medium text-accent-ink"
                : "border-line-2 bg-surface text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
        {tab === "teachers" ? (
          <span className="ml-3 flex items-center gap-1.5">
            {([
              { key: "teacher", label: "By teacher" },
              { key: "institute", label: "By institute" },
            ] as const).map((o) => (
              <Link
                key={o.key}
                href={href({ by: o.key })}
                prefetch={false}
                aria-current={by === o.key ? "page" : undefined}
                className={cx(
                  "rounded-full border px-2.5 py-[3px] text-[11.5px]",
                  by === o.key
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-2 bg-surface text-ink-2 hover:text-ink",
                )}
              >
                {o.label}
              </Link>
            ))}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          data-testid="more-columns"
          className="ml-auto text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          {showMore ? "Fewer columns" : "More columns"}
        </button>
      </div>

      <DemandTable
        rows={rows}
        sort={sort}
        onSort={(key) =>
          setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))
        }
        showMore={showMore}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        nameHeader={tab === "products" ? "Course · Subject" : by === "institute" ? "Institute" : "Teacher"}
      />

      {tab === "products" ? <ProductsTable rows={props.products} /> : null}

      {scope ? (
        <footer
          className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[11.5px] text-ink-2"
          data-testid="reconciliation"
        >
          <span>
            <strong className="text-ink">
              {scope.taggedLeads} leads, {scope.teacherRows} teacher rows
            </strong>{" "}
            — a lead naming two teachers counts under both. Untagged {scope.untagged};{" "}
            {scope.untagged} + {scope.taggedLeads} = {scope.now.leads}.
          </span>
          <span>
            Products is the same shape: {scope.courseLeads} leads across {scope.courseRows} rows,
            with {scope.untaggedCourse} naming no course.
          </span>
          <span>
            Excluded from every figure above: {scope.bookkeeping.handedToSupport} handed to Support
            and {scope.bookkeeping.superseded} superseded — bookkeeping rather than demand. So{" "}
            {scope.now.leads} + {scope.bookkeeping.handedToSupport + scope.bookkeeping.superseded} ={" "}
            {scope.now.leads + scope.bookkeeping.handedToSupport + scope.bookkeeping.superseded},
            which is the Enquiries list for the same window.
          </span>
          <span className="text-ink-3">
            &ldquo;Competitor&rdquo; counts leads the enquiry recorded as lost to one;
            &ldquo;Items lost to competitor&rdquo; counts the dimension&rsquo;s own lines. The two
            will not tie. Purchased and Conversion % are counted in leads; Revenue and Avg sale sum
            the won lines.
          </span>
          <span className="text-ink-3">
            Read in {Object.entries(props.timings).map(([k, v]) => `${v}ms (${k})`).join(" · ")}
            {slowest < 1000
              ? " — plain SQL, no summary table needed"
              : " — over 1s, worth a summary table"}
          </span>
        </footer>
      ) : null}
    </div>
  );
}

/** §82.2. Trimmed to the three things this block is read for. */
function ProductsTable({ rows }: { rows: ProductRow[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-semibold text-ink">
        What students typed{" "}
        <span className="font-normal text-ink-3">
          — top {rows.length} by enquiries, grouped case-insensitively
        </span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]" data-testid="products">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-1.5 py-[7px]">Product text</th>
              <th className="w-[90px] px-1.5 py-[7px] text-right">Enquiries</th>
              <th className="w-[90px] px-1.5 py-[7px] text-right">Purchased</th>
              <th className="w-[110px] px-1.5 py-[7px] text-right">Conversion %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.product} className="border-b border-line last:border-b-0">
                <td className="px-1.5 py-[5px] text-ink-2">{p.product}</td>
                <td className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                  {p.enquiries}
                </td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink">
                  {num(p.purchased)}
                </td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink">
                  {pct(conversion(p.purchased, p.enquiries))}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-ink-3">
                  Nobody typed a product line in this period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
