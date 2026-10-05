"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Input, PageHeader, Select, cx } from "@/components/ui";
import {
  avgSale,
  change,
  closedShares,
  conversion,
  pointsChange,
  PRESET_LABELS,
  RANGE_PRESETS,
  SCOPE_LABELS,
  type AnalyticsEvent,
  type AnalyticsScope,
  type Basis,
  type CompareMode,
  type RangePreset,
  type CourseRow,
  type Experiment,
  type ExperimentResult,
  type InstituteRow,
  type ProductRow,
  type Row,
  type ScopeType,
  type TeacherRow,
  type Totals,
} from "@/lib/analytics-shape";
import { SMALL_SAMPLE_CLOSED } from "@/lib/analytics-thresholds";
import type { Bullet, Heads as HeadsType } from "@/lib/analytics-insights";
import { formatDate } from "@/lib/format";

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";
const money = (v: number) => (v ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
const num = (v: number) => (v ? String(v) : "—");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const COLLAPSED_ROWS = 10;
const pts = (v: number) => `${v > 0 ? "▲" : "▼"}${Math.abs(Math.round(v))} pts`;

/**
 * §83.3. A count's movement in %, a rate's movement in percentage points.
 *
 * Two functions because they are two different questions. 24% to 29% is five
 * points, and reporting it as "+21%" is the single most common way a dashboard
 * lies about a conversion rate — true of the ratio, misleading about the business.
 */
function Delta({
  now,
  before,
  invert,
  rate,
}: {
  now: number | null;
  before: number | null;
  invert?: boolean;
  /** Treat the values as rates and report points. */
  rate?: boolean;
}) {
  if (before === null || now === null) {
    return <span className="text-[11px] text-ink-3">—</span>;
  }
  const c = rate ? pointsChange(now, before) : change(now, before);
  if (c === null) return <span className="text-[11px] text-ink-3">—</span>;
  const tiny = rate ? Math.abs(c) < 0.5 : Math.abs(c) < 0.005;
  if (tiny) return <span className="text-[11px] text-ink-3">{rate ? "0 pts" : "0%"}</span>;
  const up = c > 0;
  const good = invert ? !up : up;
  return (
    <span className={cx("text-[11px] tabular-nums", good ? "text-ok" : "text-danger")}>
      {up ? "▲" : "▼"}
      {rate ? `${Math.abs(Math.round(c))} pts` : `${Math.abs(Math.round(c * 100))}%`}
    </span>
  );
}

/**
 * §83.1. The metrics strip, on one basis.
 *
 * Nine cards in the order the business reads: how many came in, how much is still
 * open, how much is decided, and then the decomposition of the decided half. Each
 * carries its number and, where a rate applies, the rate beside it — "110 · 32%".
 *
 * Conversion and the three Lost rates are all over `closed`, which is what makes
 * them comparable and what makes them sum. The tooltip on Conversion carries the
 * whole decomposition and its total: it should read 100%, and if it does not then
 * a closed outcome exists that none of the five names.
 */
function MetricStrip({
  now,
  prev,
  cmpLabel,
}: {
  now: Totals;
  prev: Totals | null;
  cmpLabel: string | null;
}) {
  const share = closedShares(now);
  const prevShare = prev ? closedShares(prev) : null;
  const check =
    `Of ${now.closed} closed: purchased ${pct(share.purchased)}, ` +
    `competitor ${pct(share.competitor)}, not interested ${pct(share.notInterested)}, ` +
    `no response ${pct(share.noResponse)}, wrong number ${pct(share.wrongNumber)}` +
    (now.closedOther ? `, other ${pct(share.other)}` : "") +
    ` — total ${pct(share.sum)}`;

  const cards: {
    key: string;
    label: string;
    value: string;
    rate?: string;
    now: number | null;
    before: number | null;
    isRate?: boolean;
    invert?: boolean;
    sub?: string;
    title?: string;
  }[] = [
    { key: "leads", label: "Leads", value: String(now.leads), now: now.leads, before: prev?.leads ?? null },
    {
      key: "open",
      label: "Open calls",
      value: String(now.open),
      now: now.open,
      before: prev?.open ?? null,
      sub: now.oldestOpenDays ? `oldest ${now.oldestOpenDays}d` : undefined,
    },
    {
      key: "closed",
      label: "Closed calls",
      value: String(now.closed),
      now: now.closed,
      before: prev?.closed ?? null,
      sub: "the basis for every rate",
    },
    {
      key: "purchases",
      label: "Purchases",
      value: String(now.purchased),
      rate: pct(share.purchased),
      now: now.purchased,
      before: prev?.purchased ?? null,
    },
    {
      key: "revenue",
      label: "Revenue",
      value: money(Number(now.revenue)),
      now: Number(now.revenue),
      before: prev ? Number(prev.revenue) : null,
      sub: `avg sale ${money(avgSale(Number(now.revenue), now.wonItems) ?? 0)}`,
    },
    {
      key: "conversion",
      label: "Conversion",
      value: pct(share.purchased),
      now: share.purchased,
      before: prevShare?.purchased ?? null,
      isRate: true,
      sub: `${now.purchased} of ${now.closed} closed`,
      title: check,
    },
    {
      key: "lost-competitor",
      label: "Lost · competitor",
      value: String(now.lostCompetitor),
      rate: pct(share.competitor),
      now: share.competitor,
      before: prevShare?.competitor ?? null,
      isRate: true,
      invert: true,
    },
    {
      key: "lost-not-interested",
      label: "Lost · not interested",
      value: String(now.lostNotInterested),
      rate: pct(share.notInterested),
      now: share.notInterested,
      before: prevShare?.notInterested ?? null,
      isRate: true,
      invert: true,
    },
    {
      key: "lost-no-response",
      label: "Lost · no response",
      value: String(now.lostNoResponse),
      rate: pct(share.noResponse),
      now: share.noResponse,
      before: prevShare?.noResponse ?? null,
      isRate: true,
      invert: true,
    },
  ];

  return (
    <section
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      data-testid="metric-strip"
      title={check}
    >
      {cards.map((c) => (
        <div
          key={c.key}
          data-testid={`metric-${c.key}`}
          title={c.title}
          className="flex flex-col gap-0.5 rounded-lg border border-line-2 bg-surface px-3 py-2 shadow-card"
        >
          <span className={LABEL}>{c.label}</span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[19px] font-semibold leading-tight tabular-nums text-ink">
              {c.value}
            </span>
            {c.rate ? (
              <span className="text-[12px] tabular-nums text-ink-2">· {c.rate}</span>
            ) : null}
          </span>
          <span className="flex items-baseline gap-1.5">
            {prev ? (
              <Delta now={c.now} before={c.before} invert={c.invert} rate={c.isRate} />
            ) : null}
            <span className="text-[10.5px] text-ink-3">
              {c.sub ?? (prev ? (cmpLabel ?? "vs comparison") : "no comparison")}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * §83.2. Three column sets, one per basis.
 *
 * The basis is not a filter — every row is still every row — it is a choice of
 * which question the columns answer. Closed asks "how did decided business go",
 * Open asks "where is the work that is left", Total asks "how much of each".
 *
 * On the closed basis the five percentages are over that row's own closed count
 * and sum to 100%, the same arithmetic the strip's tooltip checks.
 */
type Col = {
  key: string;
  label: string;
  more?: boolean;
  isName?: boolean;
  cell: (r: Row) => React.ReactNode;
  value: (r: Row) => string;
  sort?: (r: Row) => number;
};

const NAME_COL: Col = {
  key: "name",
  label: "Name",
  isName: true,
  cell: () => null,
  value: (r) => r.label,
};

/** n with its share of the row's closed count beneath — "38 · 11%". */
const closedShare = (pick: (r: Row) => number) => ({
  cell: (r: Row) => (
    <span className="whitespace-nowrap">
      <span className="text-ink">{num(pick(r))}</span>
      {r.closed ? (
        <span className="ml-1 text-[11px] text-ink-3">· {pct(pick(r) / r.closed)}</span>
      ) : null}
    </span>
  ),
  value: (r: Row) => (r.closed ? `${pick(r)} (${Math.round((pick(r) / r.closed) * 100)}%)` : String(pick(r))),
  sort: (r: Row) => (r.closed ? pick(r) / r.closed : -1),
});

const COLUMNS: Record<Basis, Col[]> = {
  closed: [
    NAME_COL,
    {
      key: "closed",
      label: "Closed",
      cell: (r) => <span className="font-semibold text-ink">{r.closed}</span>,
      value: (r) => String(r.closed),
      sort: (r) => r.closed,
    },
    { key: "purchased", label: "Purchased", ...closedShare((r) => r.purchased) },
    {
      key: "revenue",
      label: "Revenue",
      cell: (r) => <span className="text-ink-2">{money(Number(r.revenue))}</span>,
      value: (r) => String(Number(r.revenue)),
      sort: (r) => Number(r.revenue),
    },
    { key: "lost_competitor", label: "Competitor", ...closedShare((r) => r.lost_competitor) },
    { key: "lost_not_interested", label: "Not interested", ...closedShare((r) => r.lost_not_interested) },
    { key: "lost_no_response", label: "No response", ...closedShare((r) => r.lost_no_response) },
    { key: "lost_wrong_number", label: "Wrong number", ...closedShare((r) => r.lost_wrong_number) },
    {
      key: "prev",
      label: "vs prev",
      cell: (r) => <Delta now={r.leads} before={r.prev_leads} />,
      value: (r) => String(r.prev_leads),
      sort: (r) => change(r.leads, r.prev_leads) ?? -Infinity,
    },
    {
      key: "items_lost_competitor",
      label: "Items lost to competitor",
      more: true,
      cell: (r) => <span className="text-ink-3">{num(r.items_lost_competitor)}</span>,
      value: (r) => String(r.items_lost_competitor),
      sort: (r) => r.items_lost_competitor,
    },
  ],
  open: [
    NAME_COL,
    {
      key: "open_leads",
      label: "Open",
      cell: (r) => <span className="font-semibold text-ink">{r.open_leads}</span>,
      value: (r) => String(r.open_leads),
      sort: (r) => r.open_leads,
    },
    {
      key: "at_fu1",
      label: "At 1st follow-up",
      cell: (r) => <span className="text-ink-2">{num(r.at_fu1)}</span>,
      value: (r) => String(r.at_fu1),
      sort: (r) => r.at_fu1,
    },
    {
      key: "at_fu2",
      label: "At 2nd",
      cell: (r) => <span className="text-ink-2">{num(r.at_fu2)}</span>,
      value: (r) => String(r.at_fu2),
      sort: (r) => r.at_fu2,
    },
    {
      key: "at_fu3",
      label: "At 3rd",
      cell: (r) => <span className="text-ink-2">{num(r.at_fu3)}</span>,
      value: (r) => String(r.at_fu3),
      sort: (r) => r.at_fu3,
    },
    {
      key: "overdue",
      label: "Overdue",
      cell: (r) =>
        r.overdue ? (
          <span className="font-medium text-warn">{r.overdue}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      value: (r) => String(r.overdue),
      sort: (r) => r.overdue,
    },
    {
      key: "oldest_open_days",
      label: "Oldest open",
      cell: (r) =>
        r.oldest_open_days ? (
          <span className="text-ink-2">{r.oldest_open_days}d</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      value: (r) => String(r.oldest_open_days),
      sort: (r) => r.oldest_open_days,
    },
    {
      key: "prev",
      label: "vs prev",
      cell: (r) => <Delta now={r.leads} before={r.prev_leads} />,
      value: (r) => String(r.prev_leads),
      sort: (r) => change(r.leads, r.prev_leads) ?? -Infinity,
    },
  ],
  total: [
    NAME_COL,
    {
      key: "leads",
      label: "Leads",
      cell: (r) => <span className="font-semibold text-ink">{r.leads}</span>,
      value: (r) => String(r.leads),
      sort: (r) => r.leads,
    },
    {
      key: "open_leads",
      label: "Open",
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="text-ink">{num(r.open_leads)}</span>
          {r.leads ? (
            <span className="ml-1 text-[11px] text-ink-3">· {pct(r.open_leads / r.leads)}</span>
          ) : null}
        </span>
      ),
      value: (r) => String(r.open_leads),
      sort: (r) => (r.leads ? r.open_leads / r.leads : -1),
    },
    {
      key: "closed",
      label: "Closed",
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="text-ink">{num(r.closed)}</span>
          {r.leads ? (
            <span className="ml-1 text-[11px] text-ink-3">· {pct(r.closed / r.leads)}</span>
          ) : null}
        </span>
      ),
      value: (r) => String(r.closed),
      sort: (r) => (r.leads ? r.closed / r.leads : -1),
    },
    // §83.2. Purchased is a share of closed even here, because a share of leads
    // would be a different number from the one every other basis shows.
    { key: "purchased", label: "Purchased", ...closedShare((r) => r.purchased) },
    {
      key: "revenue",
      label: "Revenue",
      cell: (r) => <span className="text-ink-2">{money(Number(r.revenue))}</span>,
      value: (r) => String(Number(r.revenue)),
      sort: (r) => Number(r.revenue),
    },
    {
      key: "prev",
      label: "vs prev",
      cell: (r) => <Delta now={r.leads} before={r.prev_leads} />,
      value: (r) => String(r.prev_leads),
      sort: (r) => change(r.leads, r.prev_leads) ?? -Infinity,
    },
  ],
};

/** The default sort per basis: the column the basis is about. */
const DEFAULT_SORT: Record<Basis, string> = {
  closed: "closed",
  open: "open_leads",
  total: "leads",
};

function DemandTable({
  rows,
  basis,
  sort,
  onSort,
  showMore,
  expanded,
  onExpand,
  nameHeader,
}: {
  rows: Row[];
  basis: Basis;
  sort: { key: string; desc: boolean };
  onSort: (key: string) => void;
  showMore: boolean;
  expanded: boolean;
  onExpand: () => void;
  nameHeader: string;
}) {
  const cols = COLUMNS[basis].filter((c) => showMore || !c.more);
  const real = rows.filter((r) => r.id);
  const untagged = rows.filter((r) => !r.id);
  const col = COLUMNS[basis].find((c) => c.key === sort.key);
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
                  className={cx("px-1.5 py-[7px]", c.isName ? "text-left" : "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={cx("hover:text-ink", sort.key === c.key && "text-ink")}
                  >
                    {c.isName ? nameHeader : c.label}
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
                  {r.sub ? <span className="ml-1.5 text-[11px] text-ink-3">{r.sub}</span> : null}
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
    cmpFrom: string | null;
    cmpTo: string | null;
    courseId: string | null;
    subjectId: string | null;
    sourceId: string | null;
    counsellorId: string | null;
    termId: string | null;
    scopeType: ScopeType;
    scopeId: string | null;
  };
  preset: RangePreset;
  compareMode: CompareMode;
  query: string;
  tab: "teachers" | "products" | "experiments";
  by: "teacher" | "institute";
  basis: Basis;
  error: string | null;
  scope: AnalyticsScope | null;
  teachers: TeacherRow[];
  institutes: InstituteRow[];
  courses: CourseRow[];
  products: ProductRow[];
  events: AnalyticsEvent[];
  experiments: Experiment[];
  results: ExperimentResult[];
  heads: HeadsType | null;
  timings: Record<string, number>;
  masters: {
    courses: { id: string; name: string }[];
    subjects: { id: string; name: string; course_id: string | null }[];
    sources: { id: string; name: string }[];
    terms: { id: string; name: string }[];
    teachers: { id: string; name: string }[];
    institutes: { id: string; name: string }[];
  };
  staff: { id: string; full_name: string | null }[];
}) {
  const { scope, filters, query, tab, by, basis, preset, compareMode } = props;
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: DEFAULT_SORT[basis],
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

  const rows: Row[] = useMemo(() => {
    if (tab === "products") {
      return props.courses.map((r) => ({
        ...r,
        // Composite: a course has one row per subject, so the course alone is not
        // the row's identity. §82 found this as duplicate React keys.
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

  /** §83.2. The CSV follows the basis, so it is the table you were looking at. */
  function exportCsv() {
    const cols = COLUMNS[basis].filter((c) => showMore || !c.more);
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
    a.download = `calman-analytics-${tab}-${basis}-${filters.from}-to-${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const subjects = filters.courseId
    ? props.masters.subjects.filter((s) => s.course_id === filters.courseId)
    : props.masters.subjects;
  const slowest = Math.max(0, ...Object.values(props.timings));
  const cmpLabel =
    filters.cmpFrom && filters.cmpTo
      ? `vs ${formatDate(filters.cmpFrom)} – ${formatDate(filters.cmpTo)}`
      : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Analytics"
        description="Which teachers and courses students ask for, what they buy, and where demand is going. Read-only."
      />

      {/* §83.3. Range on the left, comparison on the right, both in one GET form
          so a reload lands on the same view. */}
      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="by" value={by} />
        <input type="hidden" name="basis" value={basis} />
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-2.5">
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Date range</span>
            <div className="flex flex-wrap items-center gap-1">
              {RANGE_PRESETS.map((p) => (
                <Link
                  key={p}
                  href={href({ preset: p, from: "", to: "" })}
                  prefetch={false}
                  aria-current={preset === p ? "page" : undefined}
                  data-testid={`preset-${p}`}
                  className={cx(
                    "rounded-full border px-2.5 py-[3px] text-[11.5px]",
                    preset === p
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line-2 bg-surface text-ink-2 hover:text-ink",
                  )}
                >
                  {PRESET_LABELS[p]}
                </Link>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={LABEL}>From</span>
            <Input type="date" name="from" defaultValue={filters.from} aria-label="From" />
          </label>
          <label className="block">
            <span className={LABEL}>To</span>
            <Input type="date" name="to" defaultValue={filters.to} aria-label="To" />
          </label>
          <label className="block">
            <span className={LABEL}>Compare to</span>
            <Select name="compare" defaultValue={compareMode} aria-label="Compare to">
              <option value="none">None</option>
              <option value="previous">Previous period</option>
              <option value="custom">Custom range</option>
            </Select>
          </label>
          {compareMode === "custom" ? (
            <>
              <label className="block">
                <span className={LABEL}>Compare from</span>
                <Input
                  type="date"
                  name="cmpFrom"
                  defaultValue={filters.cmpFrom ?? ""}
                  aria-label="Compare from"
                />
              </label>
              <label className="block">
                <span className={LABEL}>Compare to date</span>
                <Input
                  type="date"
                  name="cmpTo"
                  defaultValue={filters.cmpTo ?? ""}
                  aria-label="Compare to date"
                />
              </label>
            </>
          ) : null}
          <Button type="submit" variant="primary" size="sm">Show</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 p-2.5">
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
          <label className="block">
            <span className={LABEL}>Term</span>
            <Select name="term" defaultValue={filters.termId ?? ""} aria-label="Term filter">
              <option value="">All</option>
              {props.masters.terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </label>
          {/* §84.4. The scope as a filter, which is what makes an experiment's
              numbers checkable against these tables. */}
          <label className="block">
            <span className={LABEL}>Scope</span>
            <Select
              name="scopeType"
              defaultValue={filters.scopeType}
              aria-label="Scope type"
            >
              {(Object.keys(SCOPE_LABELS) as ScopeType[]).map((k) => (
                <option key={k} value={k}>{SCOPE_LABELS[k]}</option>
              ))}
            </Select>
          </label>
          {filters.scopeType !== "all" ? (
            <label className="block">
              <span className={LABEL}>Which</span>
              <Select
                name="scopeId"
                defaultValue={filters.scopeId ?? ""}
                aria-label="Scope which"
                className="max-w-[200px]"
              >
                <option value="">Choose…</option>
                {(filters.scopeType === "teacher"
                  ? props.masters.teachers.map((t) => ({ id: t.id, label: t.name }))
                  : filters.scopeType === "institute"
                    ? props.masters.institutes.map((i) => ({ id: i.id, label: i.name }))
                    : props.masters.subjects.map((sj) => ({
                        id: sj.id,
                        label: `${props.masters.courses.find((c) => c.id === sj.course_id)?.name ?? "?"} · ${sj.name}`,
                      }))
                ).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </Select>
            </label>
          ) : null}
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
          <Button type="submit" variant="secondary" size="sm">Apply filters</Button>
          <span className="ml-auto">
            <Button type="button" size="sm" variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
          </span>
        </div>
      </form>

      {/* §83.3. What changed, in either window. A comparison without this invites
          a causal reading the page cannot support. */}
      {props.events.length ? (
        <div
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-line-2 bg-surface-2 px-3 py-1.5 text-[11.5px]"
          data-testid="events-bar"
        >
          <span className={LABEL}>Events in range</span>
          {props.events.map((e) => (
            <span key={e.id} className="text-ink-2">
              <span className="tabular-nums text-ink">{formatDate(e.at)}</span> — {e.note}
              {e.scope === "comparison" ? (
                <span className="ml-1 text-ink-3">(comparison)</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {props.error ? (
        <p className="rounded-md border border-danger/50 bg-danger-soft/40 px-3 py-2 text-[12.5px] text-danger">
          {props.error}
        </p>
      ) : null}

      {scope ? (
        <MetricStrip now={scope.now} prev={scope.prev} cmpLabel={cmpLabel} />
      ) : null}

      {props.heads ? <Heads heads={props.heads} /> : null}

      <div className="flex flex-wrap items-center gap-1.5" role="tablist">
        {([
          { key: "teachers", label: "Teachers" },
          { key: "products", label: "Products" },
          { key: "experiments", label: "Experiments" },
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
          <span className="ml-2 flex items-center gap-1.5">
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
        {/* §83.2. The basis toggle: which question the columns answer. Not on the
            Experiments tab, whose cards carry their own windows. */}
        <span className={cx("ml-3 flex items-center gap-1.5", tab === "experiments" && "hidden")}>
          {([
            { key: "closed", label: "Closed calls" },
            { key: "open", label: "Open calls" },
            { key: "total", label: "Total calls" },
          ] as const).map((b) => (
            <Link
              key={b.key}
              href={href({ basis: b.key })}
              prefetch={false}
              aria-current={basis === b.key ? "page" : undefined}
              data-testid={`basis-${b.key}`}
              className={cx(
                "rounded-full border px-2.5 py-[3px] text-[11.5px]",
                basis === b.key
                  ? "border-accent bg-accent font-medium text-accent-ink"
                  : "border-line-2 bg-surface text-ink-2 hover:text-ink",
              )}
            >
              {b.label}
            </Link>
          ))}
        </span>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          data-testid="more-columns"
          className={cx(
            "ml-auto text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline",
            tab === "experiments" && "hidden",
          )}
        >
          {showMore ? "Fewer columns" : "More columns"}
        </button>
      </div>

      {tab === "experiments" ? (
        <div className="flex flex-col gap-3">
          {props.results.length ? (
            props.results.map((r) => (
              <ExperimentCard
                key={r.id}
                r={r}
                scopeLabel={
                  props.experiments.find((e) => e.id === r.id)?.scope_label ?? "Everyone"
                }
                /* §84.3. Opens the full tables on the experiment's own slice: its
                   scope as the filter, its window as the range, and the Before
                   window as the comparison. */
                onOpen={`/analytics?tab=teachers&basis=closed&preset=custom&from=${r.duringFrom}&to=${r.duringTo}&compare=custom&cmpFrom=${r.beforeFrom}&cmpTo=${r.beforeTo}&scopeType=${r.scopeType}${r.scopeId ? `&scopeId=${r.scopeId}` : ""}`}
              />
            ))
          ) : (
            <p className="rounded-lg border border-line bg-surface px-3 py-8 text-center text-[12.5px] text-ink-3 shadow-card">
              No experiments recorded. Add one in Settings → Analytics events.
            </p>
          )}
        </div>
      ) : (
        <>
          <DemandTable
            rows={rows}
            basis={basis}
            sort={sort}
            onSort={(key) =>
              setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))
            }
            showMore={showMore}
            expanded={expanded}
            onExpand={() => setExpanded(true)}
            nameHeader={
              tab === "products" ? "Course · Subject" : by === "institute" ? "Institute" : "Teacher"
            }
          />
          {tab === "products" ? <ProductsTable rows={props.products} /> : null}
        </>
      )}

      {scope ? (
        <footer
          className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[11.5px] text-ink-2"
          data-testid="reconciliation"
        >
          <span>
            <strong className="text-ink">
              {scope.now.leads} leads = {scope.now.open} open + {scope.now.closed} closed
            </strong>
            . Every rate on this page is over the closed count; the five shares of it
            — purchased, competitor, not interested, no response, wrong number — sum to 100%.
          </span>
          <span>
            <strong className="text-ink">
              {scope.taggedLeads} leads, {scope.teacherRows} teacher rows
            </strong>{" "}
            — a lead naming two teachers counts under both. Untagged {scope.untagged};{" "}
            {scope.untagged} + {scope.taggedLeads} = {scope.now.leads}. Products is the same
            shape: {scope.courseLeads} leads across {scope.courseRows} rows, {scope.untaggedCourse}{" "}
            naming no course.
          </span>
          <span>
            Excluded from every figure above: {scope.bookkeeping.handedToSupport} handed to Support
            and {scope.bookkeeping.superseded} superseded — bookkeeping rather than demand. So{" "}
            {scope.now.leads} + {scope.bookkeeping.handedToSupport + scope.bookkeeping.superseded} ={" "}
            {scope.now.leads + scope.bookkeeping.handedToSupport + scope.bookkeeping.superseded},
            which is the Enquiries list for the same window.
          </span>
          <span className="text-ink-3">
            Purchased counts leads whose own outcome is won, which is what makes the shares sum.
            Revenue sums won lines wherever they sit, so it includes{" "}
            {scope.now.purchasedAnyLine - scope.now.purchased} lead
            {scope.now.purchasedAnyLine - scope.now.purchased === 1 ? "" : "s"} that sold a line
            while keeping others in play and are therefore not counted as purchases.
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

/**
 * §84.1. "What stands out", in three heads.
 *
 * Headed lists rather than a grid of cards. A card grid made every finding compete
 * with every other for five slots, so a tagging note could displace a teacher losing
 * half their business to a competitor. Three heads, each one question, each bullet
 * ordered by effect size — which is the only ordering that means anything inside a
 * single question.
 */
/**
 * One head: a title, its bullets, an empty note, and the team line beneath.
 *
 * At module scope rather than inside Heads. A component declared during render is a
 * new component type on every render — React remounts the subtree and the lint rule
 * says so — and this one takes everything it needs as props anyway.
 */
function Head({
  title,
  bullets,
  note,
  teamLine,
  testid,
}: {
  title: string;
  bullets: Bullet[];
  note?: string | null;
  teamLine?: string | null;
  testid: string;
}) {
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
      <h3 className="text-[12px] font-semibold text-ink">{title}</h3>
      {bullets.length ? (
        <ul className="flex flex-col gap-0.5" data-testid={testid}>
          {bullets.map((b) => (
            <li key={b.id}>
              <Link
                href={b.href}
                prefetch={false}
                data-testid={`bullet-${testid}`}
                className={cx(
                  "text-[12.5px] leading-relaxed underline-offset-2 hover:underline",
                  b.tone === "ok" && "text-ok",
                  b.tone === "warn" && "text-warn",
                  b.tone === "danger" && "text-danger",
                  b.tone === "neutral" && "text-ink-2",
                )}
              >
                {b.text}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] italic text-ink-3" data-testid={`${testid}-empty`}>
          {note ?? "Nothing stands out."}
        </p>
      )}
      {teamLine ? (
        <p className="mt-0.5 border-t border-line pt-1 text-[11.5px] text-ink-3">{teamLine}</p>
      ) : null}
    </section>
  );
}

function Heads({ heads }: { heads: HeadsType }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-ink">What stands out</h2>
      <div className="grid gap-2 lg:grid-cols-3">
        <Head
          title="Demand — rising and falling"
          bullets={heads.demand.bullets}
          note={heads.demand.note}
          testid="head-demand"
        />
        <Head
          title="Competitor losses by teacher"
          bullets={heads.competitor.bullets}
          teamLine={heads.competitor.teamLine}
          testid="head-competitor"
        />
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
          <h3 className="text-[12px] font-semibold text-ink">Conversion by teacher</h3>
          {heads.conversion.best.length || heads.conversion.weakest.length ? (
            <div className="flex flex-col gap-1.5" data-testid="head-conversion">
              {heads.conversion.best.length ? (
                <div>
                  <span className={LABEL}>Best</span>
                  <ul className="flex flex-col gap-0.5">
                    {heads.conversion.best.map((b) => (
                      <li key={b.id}>
                        <Link
                          href={b.href}
                          prefetch={false}
                          data-testid="bullet-head-conversion"
                          className="text-[12.5px] leading-relaxed text-ok underline-offset-2 hover:underline"
                        >
                          {b.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {heads.conversion.weakest.length ? (
                <div>
                  <span className={LABEL}>Weakest</span>
                  <ul className="flex flex-col gap-0.5">
                    {heads.conversion.weakest.map((b) => (
                      <li key={b.id}>
                        <Link
                          href={b.href}
                          prefetch={false}
                          data-testid="bullet-head-conversion"
                          className="text-[12.5px] leading-relaxed text-warn underline-offset-2 hover:underline"
                        >
                          {b.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] italic text-ink-3">
              No teacher has enough closed calls to rank yet.
            </p>
          )}
          {heads.conversion.teamLine ? (
            <p className="mt-0.5 border-t border-line pt-1 text-[11.5px] text-ink-3">
              {heads.conversion.teamLine}
            </p>
          ) : null}
        </section>
      </div>
      {/* §84.1. Housekeeping below the three, and only when it fires: it is about
          the page's own reliability rather than about the business. */}
      {heads.housekeeping.length ? (
        <p className="text-[11.5px] text-ink-3" data-testid="housekeeping">
          {heads.housekeeping.map((h, i) => (
            <span key={h.id}>
              {i ? " · " : ""}
              <Link href={h.href} prefetch={false} className="underline-offset-2 hover:underline">
                {h.text}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * §84.3. One experiment, read as Before / During / Change / Rest of team.
 *
 * The fourth column is the point of the card. A conversion rise during a discount
 * is not evidence the discount worked if everybody else rose too, so the verdict
 * sentence beneath sets the scope's move against everyone else's over the same days.
 */
function ExperimentCard({
  r,
  scopeLabel,
  onOpen,
}: {
  r: ExperimentResult;
  scopeLabel: string;
  onOpen: string;
}) {
  const conv = (t: Totals) => conversion(t.purchased, t.closed);
  const rate = (n: number, t: Totals) => (t.closed > 0 ? n / t.closed : null);

  const rows: {
    label: string;
    before: string;
    during: string;
    change: React.ReactNode;
    rest: string;
  }[] = [
    {
      label: "Leads",
      before: String(r.before.leads),
      during: String(r.during.leads),
      change: <Delta now={r.during.leads} before={r.before.leads} />,
      rest: r.rest ? String(r.rest.leads) : "—",
    },
    {
      label: "Closed",
      before: String(r.before.closed),
      during: String(r.during.closed),
      change: <Delta now={r.during.closed} before={r.before.closed} />,
      rest: r.rest ? String(r.rest.closed) : "—",
    },
    {
      label: "Purchased",
      before: `${r.before.purchased} · ${pct(rate(r.before.purchased, r.before))}`,
      during: `${r.during.purchased} · ${pct(rate(r.during.purchased, r.during))}`,
      change: <Delta now={conv(r.during)} before={conv(r.before)} rate />,
      rest: r.rest ? `${r.rest.purchased} · ${pct(rate(r.rest.purchased, r.rest))}` : "—",
    },
    {
      label: "Lost · competitor",
      before: `${r.before.lostCompetitor} · ${pct(rate(r.before.lostCompetitor, r.before))}`,
      during: `${r.during.lostCompetitor} · ${pct(rate(r.during.lostCompetitor, r.during))}`,
      change: (
        <Delta
          now={rate(r.during.lostCompetitor, r.during)}
          before={rate(r.before.lostCompetitor, r.before)}
          rate
          invert
        />
      ),
      rest: r.rest ? `${r.rest.lostCompetitor} · ${pct(rate(r.rest.lostCompetitor, r.rest))}` : "—",
    },
    {
      label: "Lost · not interested",
      before: `${r.before.lostNotInterested} · ${pct(rate(r.before.lostNotInterested, r.before))}`,
      during: `${r.during.lostNotInterested} · ${pct(rate(r.during.lostNotInterested, r.during))}`,
      change: (
        <Delta
          now={rate(r.during.lostNotInterested, r.during)}
          before={rate(r.before.lostNotInterested, r.before)}
          rate
          invert
        />
      ),
      rest: r.rest
        ? `${r.rest.lostNotInterested} · ${pct(rate(r.rest.lostNotInterested, r.rest))}`
        : "—",
    },
    {
      label: "Lost · no response",
      before: `${r.before.lostNoResponse} · ${pct(rate(r.before.lostNoResponse, r.before))}`,
      during: `${r.during.lostNoResponse} · ${pct(rate(r.during.lostNoResponse, r.during))}`,
      change: (
        <Delta
          now={rate(r.during.lostNoResponse, r.during)}
          before={rate(r.before.lostNoResponse, r.before)}
          rate
          invert
        />
      ),
      rest: r.rest
        ? `${r.rest.lostNoResponse} · ${pct(rate(r.rest.lostNoResponse, r.rest))}`
        : "—",
    },
    {
      label: "Revenue",
      before: money(Number(r.before.revenue)),
      during: money(Number(r.during.revenue)),
      change: <Delta now={Number(r.during.revenue)} before={Number(r.before.revenue)} />,
      rest: r.rest ? money(Number(r.rest.revenue)) : "—",
    },
    {
      label: "Avg sale",
      before: money(avgSale(Number(r.before.revenue), r.before.wonItems) ?? 0),
      during: money(avgSale(Number(r.during.revenue), r.during.wonItems) ?? 0),
      change: (
        <Delta
          now={avgSale(Number(r.during.revenue), r.during.wonItems)}
          before={avgSale(Number(r.before.revenue), r.before.wonItems)}
        />
      ),
      rest: r.rest ? money(avgSale(Number(r.rest.revenue), r.rest.wonItems) ?? 0) : "—",
    },
  ];

  const scopeMove = pointsChange(conv(r.during), conv(r.before));
  const restMove =
    r.rest && r.restBefore ? pointsChange(conv(r.rest), conv(r.restBefore)) : null;
  const thin = r.before.closed < SMALL_SAMPLE_CLOSED || r.during.closed < SMALL_SAMPLE_CLOSED;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card"
      data-testid="experiment-card"
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[13px] font-semibold text-ink">{r.note}</h3>
        <span className="text-[11.5px] text-ink-2">{scopeLabel}</span>
        <span className="text-[11.5px] tabular-nums text-ink-3">
          {formatDate(r.startDate)} →{" "}
          {r.endDate ? formatDate(r.endDate) : formatDate(r.duringTo)}
        </span>
        {r.live ? (
          <span
            className="rounded-full border border-ok/50 bg-ok-soft/40 px-1.5 text-[10.5px] font-medium text-ok"
            data-testid="experiment-live"
          >
            {r.dayM ? `day ${r.dayN} of ${r.dayM}` : `live · day ${r.dayN}`}
          </span>
        ) : null}
        {r.metricNote ? (
          <span className="text-[11px] text-ink-3">watching {r.metricNote}</span>
        ) : null}
        <Link
          href={onOpen}
          prefetch={false}
          data-testid="experiment-open"
          className="ml-auto text-[11.5px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          Read the tables on this slice →
        </Link>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="py-[5px] pr-2" />
              <th className="py-[5px] pr-2 text-right">
                Before
                <span className="block font-normal normal-case text-ink-3">
                  {formatDate(r.beforeFrom)} – {formatDate(r.beforeTo)}
                </span>
              </th>
              <th className="py-[5px] pr-2 text-right">
                During
                <span className="block font-normal normal-case text-ink-3">
                  {formatDate(r.duringFrom)} – {formatDate(r.duringTo)}
                </span>
              </th>
              <th className="py-[5px] pr-2 text-right">Change</th>
              <th className="py-[5px] text-right">
                Rest of team
                <span className="block font-normal normal-case text-ink-3">during</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-line last:border-b-0">
                <td className="py-[4px] pr-2 text-ink-2">{row.label}</td>
                <td className="py-[4px] pr-2 text-right tabular-nums text-ink-2">{row.before}</td>
                <td className="py-[4px] pr-2 text-right tabular-nums text-ink">{row.during}</td>
                <td className="py-[4px] pr-2 text-right tabular-nums">{row.change}</td>
                <td className="py-[4px] text-right tabular-nums text-ink-3">{row.rest}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The verdict. One sentence, and the only one on the card that draws a
          conclusion — which is why it sets the scope against everyone else rather
          than reporting the scope alone. */}
      <p className="text-[12.5px] text-ink" data-testid="experiment-verdict">
        {scopeMove === null
          ? "No closed business before this started, so there is nothing to compare against yet."
          : `Conversion moved ${pts(scopeMove)} for ${scopeLabel}` +
            (restMove === null
              ? " — and there is no comparison for the rest of the team."
              : ` vs ${pts(restMove)} for everyone else.`)}
      </p>
      {thin ? (
        <p className="text-[11.5px] text-warn" data-testid="experiment-thin">
          Too few closed calls to read a trend yet — {r.before.closed} before,{" "}
          {r.during.closed} during.
        </p>
      ) : null}
    </section>
  );
}
