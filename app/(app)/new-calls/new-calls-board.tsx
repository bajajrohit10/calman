"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
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
  total_count: number;
};

type Master = { id: string; name: string };

export function NewCallsBoard({
  rows,
  total,
  error,
  page,
  pageSize,
  search,
  sourceIds,
  masters,
  selected,
}: {
  rows: PoolRow[];
  total: number;
  error: string | null;
  page: number;
  pageSize: number;
  search: string;
  sourceIds: string[];
  masters: {
    teachers: Master[];
    courses: Master[];
    terms: Master[];
    sources: Master[];
  };
  selected: Record<string, string>;
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
      <form method="GET" className="rounded-lg border border-line bg-surface p-3">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <label className="flex flex-col gap-1 sm:row-span-2">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
              Source (several)
            </span>
            <select
              name="source"
              multiple
              size={5}
              defaultValue={sourceIds}
              className="rounded-md border border-line-2 bg-surface px-2 py-1 text-[13px]"
            >
              {masters.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <Labelled label="Course">
            <Select name="course" defaultValue={selected.course}>
              <option value="">Any</option>
              {masters.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Labelled>

          <Labelled label="Teacher">
            <Select name="teacher" defaultValue={selected.teacher}>
              <option value="">Any</option>
              {masters.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Labelled>

          <Labelled label="Importance">
            <Select name="importance" defaultValue={selected.importance}>
              <option value="">Any</option>
              {Object.entries(IMPORTANCE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Labelled>

          <Labelled label="Term">
            <Select name="term" defaultValue={selected.term}>
              <option value="">Any</option>
              {masters.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Labelled>

          <Labelled label="Product text contains">
            <Input name="product" defaultValue={selected.product} placeholder="e.g. DT Full" />
          </Labelled>

          <Labelled label="Enquired from">
            <Input type="date" name="createdFrom" defaultValue={selected.createdFrom} />
          </Labelled>

          <Labelled label="Enquired to">
            <Input type="date" name="createdTo" defaultValue={selected.createdTo} />
          </Labelled>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
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
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">
          Take next acts on this filtered set, in the order shown.
        </p>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result && !result.error ? (
        <p className="text-[12.5px] text-ok" role="status">
          {result.ok}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
              <th className="px-2 py-2">Student</th>
              <th className="px-2 py-2">Imp</th>
              <th className="px-2 py-2">Source</th>
              <th className="px-2 py-2">Term</th>
              <th className="px-2 py-2">Teachers</th>
              <th className="px-2 py-2">Product</th>
              <th className="px-2 py-2">Enquired</th>
              <th className="px-2 py-2 text-right">Take</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.enquiry_id} className="border-b border-line last:border-b-0">
                <td className="px-2 py-1.5">
                  <span className="text-ink">{r.student_name || "No name"}</span>
                  <Link
                    href={`/students/${r.mobile}`}
                    className="ml-1.5 tabular-nums text-ink-3 underline-offset-2 hover:underline"
                  >
                    {formatMobile(r.mobile)}
                  </Link>
                </td>
                <td className="px-2 py-1.5">
                  {r.importance ? (
                    <Badge tone={r.importance === "a" ? "accent" : "neutral"}>
                      {r.importance.toUpperCase()}
                    </Badge>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-ink-2">{r.source_name ?? "—"}</td>
                <td className="px-2 py-1.5 text-ink-2">{r.term_name ?? "—"}</td>
                <td className="px-2 py-1.5 text-ink-2">{r.teacher_names ?? "—"}</td>
                <td className="max-w-[260px] truncate px-2 py-1.5 text-ink-3">
                  {r.product_text ?? "—"}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-ink-3">
                  {formatDate(r.created_at)}
                </td>
                <td className="px-2 py-1.5 text-right">
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

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}
