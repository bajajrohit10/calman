"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Input, PageHeader, Select, cx } from "@/components/ui";
import {
  change,
  conversion,
  ticketsPer10,
  type AnalyticsScope,
  type DemandRow,
  type PivotRow,
  type ProductRow,
} from "@/lib/analytics-shape";
import type { Insight } from "@/lib/analytics-insights";

type Metric = "enquiries" | "purchased" | "revenue" | "conversion";

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";
const money = (v: number) => (v ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
const num = (v: number) => (v ? String(v) : "—");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** ▲12% / ▼30% / — when the previous window had nothing to compare with. */
function Delta({ now, before }: { now: number; before: number }) {
  const c = change(now, before);
  if (c === null) {
    return (
      <span className="text-[11.5px] text-ink-3" title="No leads in the previous period">
        —
      </span>
    );
  }
  if (Math.abs(c) < 0.005) return <span className="text-[11.5px] text-ink-3">0%</span>;
  const up = c > 0;
  return (
    <span className={cx("text-[11.5px] tabular-nums", up ? "text-ok" : "text-danger")}>
      {up ? "▲" : "▼"}
      {Math.abs(Math.round(c * 100))}%
    </span>
  );
}

/** The demand table's columns, in screen order. Shared with the CSV export. */
const DEMAND_COLUMNS: {
  key: string;
  label: string;
  /** Right-aligned numerics, which is all of them except the name. */
  num?: boolean;
  pick: (r: DemandRow) => string | number;
  sort?: (r: DemandRow) => number;
}[] = [
  {
    key: "name",
    label: "Name",
    pick: (r) => r.teacher_name ?? r.institute_name ?? "—",
  },
  { key: "enquiries", label: "Enquiries", num: true, pick: (r) => r.enquiries, sort: (r) => r.enquiries },
  {
    key: "prev",
    label: "vs prev",
    num: true,
    pick: (r) => r.prev_enquiries,
    sort: (r) => change(r.enquiries, r.prev_enquiries) ?? -Infinity,
  },
  { key: "in_progress", label: "Follow-ups in progress", num: true, pick: (r) => r.in_progress, sort: (r) => r.in_progress },
  { key: "purchased", label: "Purchased", num: true, pick: (r) => r.purchased, sort: (r) => r.purchased },
  { key: "amount", label: "Amount", num: true, pick: (r) => r.amount, sort: (r) => Number(r.amount) },
  {
    key: "conversion",
    label: "Conversion %",
    num: true,
    pick: (r) => {
      const c = conversion(r.purchased, r.enquiries);
      return c === null ? "" : `${Math.round(c * 100)}%`;
    },
    sort: (r) => conversion(r.purchased, r.enquiries) ?? -1,
  },
  { key: "lost_competitor", label: "Competitor", num: true, pick: (r) => r.lost_competitor, sort: (r) => r.lost_competitor },
  { key: "lost_not_interested", label: "Not interested", num: true, pick: (r) => r.lost_not_interested, sort: (r) => r.lost_not_interested },
  { key: "lost_no_response", label: "No response", num: true, pick: (r) => r.lost_no_response, sort: (r) => r.lost_no_response },
  { key: "lost_wrong_number", label: "Wrong number", num: true, pick: (r) => r.lost_wrong_number, sort: (r) => r.lost_wrong_number },
  {
    key: "items_lost_competitor",
    label: "Items lost to competitor",
    num: true,
    pick: (r) => r.items_lost_competitor,
    sort: (r) => r.items_lost_competitor,
  },
  { key: "tickets", label: "Support tickets", num: true, pick: (r) => r.tickets, sort: (r) => r.tickets },
  {
    key: "per10",
    label: "Tickets / 10 sales",
    num: true,
    pick: (r) => {
      const v = ticketsPer10(r.tickets, r.purchased);
      return v === null ? "" : v.toFixed(1);
    },
    sort: (r) => ticketsPer10(r.tickets, r.purchased) ?? -1,
  },
];

export function AnalyticsView(props: {
  filters: {
    from: string;
    to: string;
    courseId: string | null;
    subjectId: string | null;
    sourceId: string | null;
    counsellorId: string | null;
  };
  query: string;
  tab: "teachers" | "products";
  by: "teacher" | "institute";
  metric: Metric;
  institute: string | null;
  error: string | null;
  scope: AnalyticsScope | null;
  teachers: DemandRow[];
  institutes: DemandRow[];
  pivot: PivotRow[];
  products: ProductRow[];
  insights: Insight[];
  timings: Record<string, number>;
  masters: {
    courses: { id: string; name: string }[];
    subjects: { id: string; name: string; course_id: string | null }[];
    sources: { id: string; name: string }[];
  };
  staff: { id: string; full_name: string | null }[];
}) {
  const { scope, filters, query, tab, by, metric, institute } = props;
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: "enquiries",
    desc: true,
  });

  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams(query);
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/analytics?${p.toString()}`;
  };

  /**
   * Untagged always last, whatever the sort.
   *
   * It is not a competitor for "busiest teacher" — it is the measure of how much
   * of the page cannot be attributed — so letting it sort into second place
   * would read as a teacher called Untagged.
   */
  const demandRows = useMemo(() => {
    const all = by === "teacher" ? props.teachers : props.institutes;
    const scoped =
      by === "teacher" && institute
        ? all.filter((r) => r.institute_id === institute || !r.teacher_id)
        : all;
    const col = DEMAND_COLUMNS.find((c) => c.key === sort.key);
    const real = scoped.filter((r) => r.teacher_id || r.institute_id);
    const untagged = scoped.filter((r) => !r.teacher_id && !r.institute_id);
    const sorted = [...real].sort((a, b) => {
      if (!col?.sort) {
        const an = a.teacher_name ?? a.institute_name ?? "";
        const bn = b.teacher_name ?? b.institute_name ?? "";
        return sort.desc ? bn.localeCompare(an) : an.localeCompare(bn);
      }
      const d = col.sort(a) - col.sort(b);
      return sort.desc ? -d : d;
    });
    return [...sorted, ...untagged];
  }, [by, institute, props.teachers, props.institutes, sort]);

  /** The pivot's columns: only the terms that actually appear, in master order. */
  const terms = useMemo(() => {
    const seen = new Map<string, { name: string; sort: number }>();
    for (const c of props.pivot) {
      seen.set(c.term_name, { name: c.term_name, sort: c.term_sort });
    }
    return [...seen.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }, [props.pivot]);

  /** The pivot's rows: course × subject, busiest first. */
  const pivotRows = useMemo(() => {
    const byRow = new Map<
      string,
      { label: string; courseSort: number; subjectSort: number; cells: Map<string, PivotRow> }
    >();
    for (const c of props.pivot) {
      const key = `${c.course_id}|${c.subject_id ?? "none"}`;
      const row =
        byRow.get(key) ??
        {
          label: `${c.course_name} · ${c.subject_name}`,
          courseSort: c.course_sort,
          subjectSort: c.subject_sort,
          cells: new Map<string, PivotRow>(),
        };
      row.cells.set(c.term_name, c);
      byRow.set(key, row);
    }
    const total = (r: { cells: Map<string, PivotRow> }) =>
      [...r.cells.values()].reduce((n, c) => n + c.enquiries, 0);
    return [...byRow.values()].sort((a, b) => total(b) - total(a));
  }, [props.pivot]);

  const cellValue = (c: PivotRow | undefined): string => {
    if (!c) return "";
    if (metric === "enquiries") return String(c.enquiries);
    if (metric === "purchased") return String(c.purchased);
    if (metric === "revenue") return money(Number(c.revenue));
    const v = conversion(c.purchased, c.enquiries);
    return v === null ? "—" : `${Math.round(v * 100)}%`;
  };

  /** Column and row totals, summed from the same cells the grid prints. */
  const colTotal = (termName: string) =>
    props.pivot
      .filter((c) => c.term_name === termName)
      .reduce(
        (acc, c) => ({
          enquiries: acc.enquiries + c.enquiries,
          purchased: acc.purchased + c.purchased,
          revenue: acc.revenue + Number(c.revenue),
        }),
        { enquiries: 0, purchased: 0, revenue: 0 },
      );
  const grand = props.pivot.reduce(
    (acc, c) => ({
      enquiries: acc.enquiries + c.enquiries,
      purchased: acc.purchased + c.purchased,
      revenue: acc.revenue + Number(c.revenue),
    }),
    { enquiries: 0, purchased: 0, revenue: 0 },
  );

  /** The current tab, as CSV with a BOM — the convention everywhere else here. */
  function exportCsv() {
    const rows: string[][] = [];
    if (tab === "teachers") {
      rows.push(DEMAND_COLUMNS.map((c) => c.label));
      for (const r of demandRows) rows.push(DEMAND_COLUMNS.map((c) => String(c.pick(r))));
    } else {
      rows.push(["Course · Subject", ...terms.map((t) => t.name), "Total"]);
      for (const r of pivotRows) {
        const cells = terms.map((t) => cellValue(r.cells.get(t.name)));
        const total = [...r.cells.values()].reduce((n, c) => n + c.enquiries, 0);
        rows.push([r.label, ...cells, String(total)]);
      }
      rows.push([]);
      rows.push(["Product text", "Enquiries", "Purchased", "Conversion %", "Revenue"]);
      for (const p of props.products) {
        const c = conversion(p.purchased, p.enquiries);
        rows.push([
          p.product,
          String(p.enquiries),
          String(p.purchased),
          c === null ? "" : `${Math.round(c * 100)}%`,
          String(Number(p.revenue)),
        ]);
      }
    }
    const esc = (v: string) =>
      /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = `﻿${rows.map((r) => r.map(esc).join(",")).join("\r\n")}\r\n`;
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
            <span className={LABEL}>Course (level)</span>
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
          <span className="ml-auto flex items-center gap-2">
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

      {scope ? (
        <p className="text-[12px] text-ink-2" data-testid="scope-line">
          <strong className="text-ink">{scope.leads}</strong> leads arrived{" "}
          {scope.from} → {scope.to}, {scope.purchasedLeads} bought (
          {pct(scope.teamConversion)} team conversion), {money(Number(scope.revenue))} recorded.
          {" "}Uncalled: {scope.uncalled}
          {scope.uncalled > 0 && scope.uncalled === scope.uncalledUntagged
            ? " (all untagged)"
            : ""}
          .
        </p>
      ) : null}

      {props.insights.length ? (
        <section className="flex flex-col gap-1.5" data-testid="insights">
          <h2 className="text-[13px] font-semibold text-ink">
            What stands out{" "}
            <span className="font-normal text-ink-3">({props.insights.length})</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
                href={href({ by: o.key, institute: "" })}
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
        ) : (
          <span className="ml-3 flex items-center gap-1.5">
            {([
              { key: "enquiries", label: "Enquiries" },
              { key: "purchased", label: "Purchased" },
              { key: "revenue", label: "Revenue" },
              { key: "conversion", label: "Conversion %" },
            ] as const).map((m) => (
              <Link
                key={m.key}
                href={href({ metric: m.key })}
                prefetch={false}
                aria-current={metric === m.key ? "page" : undefined}
                className={cx(
                  "rounded-full border px-2.5 py-[3px] text-[11.5px]",
                  metric === m.key
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-2 bg-surface text-ink-2 hover:text-ink",
                )}
              >
                {m.label}
              </Link>
            ))}
          </span>
        )}
      </div>

      {institute && by === "teacher" ? (
        <p className="text-[12px] text-ink-2">
          Teachers of one institute.{" "}
          <Link href={href({ institute: "" })} className="underline underline-offset-2">
            Show all
          </Link>
        </p>
      ) : null}

      {tab === "teachers" ? (
        <DemandTable
          rows={demandRows}
          by={by}
          sort={sort}
          onSort={(key) =>
            setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))
          }
          from={filters.from}
          to={filters.to}
          instituteHref={(id) => href({ by: "teacher", institute: id })}
        />
      ) : (
        <>
          <PivotTable
            terms={terms}
            rows={pivotRows}
            metric={metric}
            cellValue={cellValue}
            colTotal={colTotal}
            grand={grand}
          />
          <ProductsTable rows={props.products} />
        </>
      )}

      {scope ? (
        <footer
          className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[11.5px] text-ink-2"
          data-testid="reconciliation"
        >
          <span>
            <strong className="text-ink">{scope.taggedLeads} leads, {scope.teacherRows} teacher
            rows</strong>{" "}
            — a lead naming two teachers counts under both. Untagged{" "}
            {scope.untagged}; {scope.untagged} + {scope.taggedLeads} = {scope.leads}.
          </span>
          <span>
            The pivot is the same shape: {scope.courseLeads} leads across {scope.pivotCells} cells,
            with {scope.untaggedCourse} naming no course.
          </span>
          {/* The whole chain, because the first line alone does not tie: the
              Enquiries list has no reason to exclude bookkeeping and does not,
              so the two screens differ by exactly these rows and the footer has
              to say so or it is a reconciliation that does not reconcile. */}
          <span>
            Excluded from every figure above: {scope.bookkeeping.handedToSupport} handed to Support
            and {scope.bookkeeping.superseded} superseded — bookkeeping rather than demand. So{" "}
            {scope.leads} + {scope.bookkeeping.handedToSupport + scope.bookkeeping.superseded} ={" "}
            {scope.leads + scope.bookkeeping.handedToSupport + scope.bookkeeping.superseded}, which
            is the Enquiries list for the same window.
          </span>
          <span className="text-ink-3">
            &ldquo;Competitor&rdquo; counts leads the enquiry recorded as lost to one; &ldquo;Items
            lost to competitor&rdquo; counts the teacher&rsquo;s own lines. The two will not tie.
            Purchased and Conversion % are counted in leads; Amount sums the won lines.
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

function SortHead({
  col,
  sort,
  onSort,
}: {
  col: (typeof DEMAND_COLUMNS)[number];
  sort: { key: string; desc: boolean };
  onSort: (key: string) => void;
}) {
  const active = sort.key === col.key;
  return (
    <th className={cx("px-1.5 py-[7px]", col.num ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className={cx("hover:text-ink", active && "text-ink")}
      >
        {col.label}
        {active ? (sort.desc ? " ▾" : " ▴") : ""}
      </button>
    </th>
  );
}

function DemandTable({
  rows,
  by,
  sort,
  onSort,
  from,
  to,
  instituteHref,
}: {
  rows: DemandRow[];
  by: "teacher" | "institute";
  sort: { key: string; desc: boolean };
  onSort: (key: string) => void;
  from: string;
  to: string;
  instituteHref: (id: string) => string;
}) {
  // Both tables carry the same columns; only the name column's meaning differs.
  const cols = DEMAND_COLUMNS;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-[1180px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            {cols.map((c) => (
              <SortHead key={c.key} col={c} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const untagged = !r.teacher_id && !r.institute_id;
            const name = r.teacher_name ?? r.institute_name ?? "—";
            /**
             * A teacher row opens the Enquiries list for that teacher and
             * period. An institute row cannot: the Enquiries list has no
             * institute filter, so it narrows this table to that institute's
             * teachers instead, each of which does open the list.
             */
            const to_ =
              by === "teacher" && r.teacher_id
                ? `/enquiries?teacher=${r.teacher_id}&createdFrom=${from}&createdTo=${to}`
                : r.institute_id
                  ? instituteHref(r.institute_id)
                  : null;
            const per10 = ticketsPer10(r.tickets, r.purchased);
            return (
              <tr
                key={r.teacher_id ?? r.institute_id ?? "untagged"}
                id={
                  untagged
                    ? "untagged"
                    : by === "teacher"
                      ? `teacher-${r.teacher_id}`
                      : `institute-${r.institute_id}`
                }
                data-testid={untagged ? "row-untagged" : "row-demand"}
                className={cx(
                  "border-b border-line last:border-b-0",
                  untagged && "bg-warn-soft/25 italic",
                )}
              >
                <td className="px-1.5 py-[5px] text-ink">
                  {to_ ? (
                    <Link href={to_} prefetch={false} className="hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                  {by === "teacher" && r.institute_name ? (
                    <span className="ml-1.5 text-[11px] text-ink-3">{r.institute_name}</span>
                  ) : null}
                </td>
                <td className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                  {r.enquiries}
                </td>
                <td className="px-1.5 py-[5px] text-right">
                  <Delta now={r.enquiries} before={r.prev_enquiries} />
                </td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-2">{num(r.in_progress)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink">{num(r.purchased)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-2">{money(Number(r.amount))}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink">
                  {pct(conversion(r.purchased, r.enquiries))}
                </td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-2">{num(r.lost_competitor)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-2">{num(r.lost_not_interested)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-2">{num(r.lost_no_response)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-3">{num(r.lost_wrong_number)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-3">{num(r.items_lost_competitor)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-2">{num(r.tickets)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums">
                  {per10 === null ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <span className={per10 >= 3 ? "font-medium text-warn" : "text-ink-2"}>
                      {per10.toFixed(1)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
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
  );
}

function PivotTable({
  terms,
  rows,
  metric,
  cellValue,
  colTotal,
  grand,
}: {
  terms: { name: string; sort: number }[];
  rows: { label: string; cells: Map<string, PivotRow> }[];
  metric: Metric;
  cellValue: (c: PivotRow | undefined) => string;
  colTotal: (t: string) => { enquiries: number; purchased: number; revenue: number };
  grand: { enquiries: number; purchased: number; revenue: number };
}) {
  const totalOf = (t: { enquiries: number; purchased: number; revenue: number }) =>
    metric === "revenue"
      ? money(t.revenue)
      : metric === "purchased"
        ? String(t.purchased)
        : metric === "conversion"
          ? pct(conversion(t.purchased, t.enquiries))
          : String(t.enquiries);

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full border-collapse text-[12.5px]" data-testid="pivot">
        <thead>
          <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            <th className="sticky left-0 bg-surface-2 px-1.5 py-[7px]">Course · Subject</th>
            {terms.map((t) => (
              <th key={t.name} className="px-1.5 py-[7px] text-right">{t.name}</th>
            ))}
            <th className="px-1.5 py-[7px] text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rowTotals = [...r.cells.values()].reduce(
              (acc, c) => ({
                enquiries: acc.enquiries + c.enquiries,
                purchased: acc.purchased + c.purchased,
                revenue: acc.revenue + Number(c.revenue),
              }),
              { enquiries: 0, purchased: 0, revenue: 0 },
            );
            return (
              <tr key={r.label} className="border-b border-line last:border-b-0">
                <td className="sticky left-0 bg-surface px-1.5 py-[5px] text-ink">{r.label}</td>
                {terms.map((t) => {
                  const c = r.cells.get(t.name);
                  return (
                    <td key={t.name} className="px-1.5 py-[5px] text-right tabular-nums">
                      {c ? (
                        <>
                          <span className="text-ink">{cellValue(c)}</span>
                          {/* §81.2. The purchased count under the headline
                              number, which is what "48 / 6" means. */}
                          {metric === "enquiries" ? (
                            <span className="block text-[10.5px] text-ink-3">/ {c.purchased}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                  {totalOf(rowTotals)}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={terms.length + 2} className="px-3 py-8 text-center text-ink-3">
                No tagged leads in this period with these filters.
              </td>
            </tr>
          ) : null}
        </tbody>
        {rows.length ? (
          <tfoot>
            <tr className="border-t border-line-2 bg-surface-2 font-semibold">
              <td className="sticky left-0 bg-surface-2 px-1.5 py-[6px] text-ink">Total</td>
              {terms.map((t) => (
                <td key={t.name} className="px-1.5 py-[6px] text-right tabular-nums text-ink">
                  {totalOf(colTotal(t.name))}
                </td>
              ))}
              <td className="px-1.5 py-[6px] text-right tabular-nums text-ink">{totalOf(grand)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

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
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]" data-testid="products">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-1.5 py-[7px]">Product text</th>
              <th className="w-[90px] px-1.5 py-[7px] text-right">Enquiries</th>
              <th className="w-[90px] px-1.5 py-[7px] text-right">Purchased</th>
              <th className="w-[100px] px-1.5 py-[7px] text-right">Conversion %</th>
              <th className="w-[110px] px-1.5 py-[7px] text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.product} className="border-b border-line last:border-b-0">
                <td className="px-1.5 py-[5px] text-ink-2">{p.product}</td>
                <td className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                  {p.enquiries}
                </td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink">{num(p.purchased)}</td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink">
                  {pct(conversion(p.purchased, p.enquiries))}
                </td>
                <td className="px-1.5 py-[5px] text-right tabular-nums text-ink-2">
                  {money(Number(p.revenue))}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-3">
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
