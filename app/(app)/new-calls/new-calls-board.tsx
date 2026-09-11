"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FacetSelect, Labelled } from "@/components/filter-fields";
import { MultiSelect } from "@/components/multi-select";
import { Badge, Button, ErrorNote, ImportanceMark, Input, cx } from "@/components/ui";
import type { FacetMap } from "@/lib/facet-shape";
import { IMPORTANCE_LABELS, type Importance } from "@/lib/enquiry-labels";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";

import { takeEnquiries, takeNext, type TakeResult } from "./actions";

export type PoolRow = {
  enquiry_id: number;
  student_id: string;
  mobile: string;
  student_name: string | null;
  importance: Importance | null;
  term_name: string | null;
  source_name: string | null;
  product_text: string | null;
  teacher_names: string | null;
  item_count: number;
  created_at: string;
  re_enquired_at: string | null;
  total_count: number;
};

type Master = { id: string; name: string };

const IMPORTANCE_OPTIONS: Master[] = Object.entries(IMPORTANCE_LABELS).map(
  ([id, name]) => ({ id, name }),
);

export function NewCallsBoard({
  rows,
  total,
  error,
  page,
  pageSize,
  search,
  sourceIds,
  teacherIds,
  contentIds,
  masters,
  selected,
  facets,
  facetError,
}: {
  rows: PoolRow[];
  total: number;
  error: string | null;
  page: number;
  pageSize: number;
  search: string;
  sourceIds: string[];
  teacherIds: string[];
  contentIds: string[];
  masters: {
    teachers: Master[];
    institutes: Master[];
    contents: Master[];
    courses: Master[];
    terms: Master[];
    sources: Master[];
  };
  selected: Record<string, string>;
  /** Absent when the counts could not be trusted; see lib/facets.ts. */
  facets?: FacetMap;
  facetError?: string | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<TakeResult | null>(null);
  const [pending, start] = useTransition();
  // Rows this session has claimed, hidden immediately so the list does not
  // still offer something already on your My Day.
  const [claimed, setClaimed] = useState<Set<number>>(new Set());

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visible = rows.filter((r) => !claimed.has(r.enquiry_id));

  function run(ids: number[], fn: () => Promise<TakeResult>) {
    setResult(null);
    start(async () => {
      const res = await fn();
      setResult(res);
      // Anything not reported lost was taken; anything lost is gone from the
      // pool either way, so both drop off.
      setClaimed((c) => new Set([...c, ...ids, ...(res.lost ?? []).map((l) => l.enquiryId)]));
      router.refresh();
    });
  }

  function withParam(patch: Record<string, string>) {
    const params = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    return `?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap gap-2 p-2.5">
          <Labelled label="Source">
            <MultiSelect
              name="source"
              facet="source"
              options={masters.sources}
              values={sourceIds}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Teacher">
            <MultiSelect
              name="teacher"
              facet="teacher"
              options={masters.teachers}
              values={teacherIds}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Course">
            <FacetSelect
              name="course"
              facet="course"
              options={masters.courses}
              value={selected.course}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Content">
            <MultiSelect
              name="content"
              facet="content"
              options={masters.contents}
              values={contentIds}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Importance">
            <FacetSelect
              name="importance"
              facet="importance"
              options={IMPORTANCE_OPTIONS}
              value={selected.importance}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Term">
            <FacetSelect
              name="term"
              facet="term"
              options={masters.terms}
              value={selected.term}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Institute">
            <FacetSelect
              name="institute"
              facet="institute"
              options={masters.institutes}
              value={selected.institute}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Product text contains" wide>
            <Input name="product" defaultValue={selected.product} placeholder="e.g. DT Full" />
          </Labelled>

          <Labelled label="Enquired between" wide>
            <div className="flex items-center gap-1.5">
              <Input type="date" name="createdFrom" defaultValue={selected.createdFrom} />
              <span className="text-[12px] text-ink-3">→</span>
              <Input type="date" name="createdTo" defaultValue={selected.createdTo} />
            </div>
          </Labelled>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-sunk px-2.5 py-2.5">
          <Button type="submit" variant="primary" size="sm">
            Apply filters
          </Button>
          <Link
            href="/new-calls"
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            Clear
          </Link>
          <span className="text-[12px] text-ink-3">{total} waiting</span>

          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11.5px] text-ink-3">Take the next</span>
            {[10, 25].map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending || total === 0}
                onClick={() => run([], () => takeNext(search, n))}
              >
                {n}
              </Button>
            ))}
          </span>
          <span className="w-full text-[11px] text-ink-3">
            Take next acts on this filtered set, in the order shown.
          </span>
        </div>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {facetError ? (
        <p className="text-[12px] text-warn" role="status">
          {facetError}
        </p>
      ) : null}
      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result && !result.error ? (
        <p className="text-[12.5px] text-ok" role="status">
          {result.ok}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-2 py-[7px]">Student</th>
              <th className="px-2 py-[7px]">Imp</th>
              <th className="px-2 py-[7px]">Source</th>
              <th className="px-2 py-[7px]">Term</th>
              <th className="px-2 py-[7px]">Teachers</th>
              <th className="px-2 py-[7px]">Product</th>
              <th className="px-2 py-[7px]">Arrived</th>
              <th className="px-2 py-[7px] text-right">Take</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.enquiry_id} className="border-b border-line last:border-b-0">
                <td className="px-2 py-[5px]">
                  <span className="text-ink">{r.student_name || "No name"}</span>
                  <Link
                    href={`/students/${r.mobile}`}
                    className="ml-1.5 tabular-nums text-ink-3 underline-offset-2 hover:underline"
                  >
                    {formatMobile(r.mobile)}
                  </Link>
                </td>
                <td className="px-2 py-[5px]">
                  {r.importance ? (
                    <ImportanceMark grade={r.importance} />
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="px-2 py-[5px] text-ink-2">{r.source_name ?? "—"}</td>
                <td className="px-2 py-[5px] text-ink-2">{r.term_name ?? "—"}</td>
                <td className="px-2 py-[5px] text-ink-2">{r.teacher_names ?? "—"}</td>
                <td className="max-w-[260px] truncate px-2 py-[5px] text-ink-3">
                  {r.product_text ?? "—"}
                </td>
                <td className="px-2 py-[5px] whitespace-nowrap text-ink-3">
                  {/* The list sorts by arrival, and for a re-enquired lead that
                      is the day it came back — so the column has to say so, or
                      the order reads as a bug. */}
                  {r.re_enquired_at ? (
                    <span className="flex flex-col">
                      <span className="text-ink-2">
                        {formatDate(r.re_enquired_at)}
                        <Badge dot tone="accent">back</Badge>
                      </span>
                      <span className="text-[11px]">
                        first {formatDate(r.created_at)}
                      </span>
                    </span>
                  ) : (
                    formatDate(r.created_at)
                  )}
                </td>
                <td className="px-2 py-[5px] text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={pending}
                    onClick={() => run([r.enquiry_id], () => takeEnquiries([r.enquiry_id]))}
                  >
                    Take
                  </Button>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className={cx("px-3 py-8 text-center text-ink-3")}>
                  Nothing waiting with these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div className="flex items-center gap-3 text-[12.5px] text-ink-2">
          {page > 1 ? (
            <Link href={withParam({ page: String(page - 1) })} className="hover:underline">
              ← Previous
            </Link>
          ) : null}
          <span className="text-ink-3">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={withParam({ page: String(page + 1) })} className="hover:underline">
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

