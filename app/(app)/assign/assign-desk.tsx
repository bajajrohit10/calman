"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ExportButton } from "@/components/export-button";
import {
  CommonFilterFields,
  FacetSelect,
  Labelled,
  type FilterMasters,
} from "@/components/filter-fields";
import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import type { FacetMap } from "@/lib/facet-shape";
import {
  BUCKET_LABELS,
  ENQUIRY_STATUS_LABELS,
  type AssignmentBucket,
} from "@/lib/enquiry-labels";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import type { RecommendedRow } from "@/lib/recommended";

import {
  assignEnquiries,
  reassignDay,
  selectAllMatching,
  unassignEnquiries,
} from "./actions";

export type DeskMasters = FilterMasters;

export type RosterEntry = { id: string; name: string; role: string; count: number };

const STATUS_OPTIONS = Object.entries(ENQUIRY_STATUS_LABELS).map(([id, name]) => ({
  id,
  name,
}));

/**
 * §5.5. Left: the recommended list for one date, with every input field
 * filterable. Right: who is calling, and how much they already have.
 *
 * Filters live in the URL and submit as a plain GET form, so the list is
 * server-rendered, pageable and shareable — a manager can send someone a link
 * to exactly the slice they mean. Only the selection is client state.
 */
export function AssignDesk({
  rows,
  total,
  error,
  facets,
  facetError,
  date,
  page,
  pageSize,
  includeNotDue,
  roster,
  masters,
  selected,
  search,
}: {
  rows: RecommendedRow[];
  total: number;
  error: string | null;
  /** Absent when the counts could not be trusted; see lib/facets.ts. */
  facets?: FacetMap;
  facetError?: string | null;
  date: string;
  page: number;
  pageSize: number;
  includeNotDue: boolean;
  roster: RosterEntry[];
  masters: DeskMasters;
  selected: Record<string, string>;
  search: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Map<number, AssignmentBucket>>(new Map());
  const [counsellor, setCounsellor] = useState("");
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");


  const allOnPage = rows.length > 0 && rows.every((r) => picked.has(r.enquiry_id));

  function toggle(row: RecommendedRow) {
    setPicked((p) => {
      const next = new Map(p);
      if (next.has(row.enquiry_id)) next.delete(row.enquiry_id);
      else next.set(row.enquiry_id, row.bucket);
      return next;
    });
  }

  /** Every row the filter matches, not just the ones on screen. */
  function selectAll() {
    setResult(null);
    start(async () => {
      const res = await selectAllMatching(window.location.search);
      if (res.error) {
        setResult({ error: res.error });
        return;
      }
      setPicked(new Map((res.rows ?? []).map((r) => [r.enquiryId, r.bucket])));
    });
  }

  function run(fn: () => Promise<{ error: string | null; ok?: string }>) {
    setResult(null);
    start(async () => {
      const res = await fn();
      setResult(res);
      if (!res.error) {
        setPicked(new Map());
        router.refresh();
      }
    });
  }

  const ids = [...picked.keys()];
  // Campaign mode is the same filter bar with the due-date restriction lifted,
  // so an assignment made from it is a campaign assignment (§5.5). Otherwise
  // each row keeps the bucket §6 derived for it.
  const toAssign = [...picked].map(([enquiryId, bucket]) => ({
    enquiryId,
    bucket: (includeNotDue ? "campaign" : bucket) as AssignmentBucket,
  }));
  const allMatchingSelected = total > 0 && picked.size === total;

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      {/* ------------------------------- left ------------------------------- */}
      <div className="min-w-0 flex-1 flex flex-col gap-3">
        <form method="GET" className="rounded-lg border border-line bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Labelled label="Date">
              <Input type="date" name="date" defaultValue={date} />
            </Labelled>
            <CommonFilterFields
              masters={masters}
              selected={selected}
              roster={roster}
              facets={facets}
            />
            <Labelled label="Type">
              <Select name="type" defaultValue={selected.type}>
                <option value="">Purchase (default)</option>
                <option value="purchase">Purchase</option>
                <option value="after_sale">After Sale</option>
              </Select>
            </Labelled>
            <Labelled label="Status">
              <FacetSelect
                name="status"
                facet="status"
                options={STATUS_OPTIONS}
                value={selected.status}
                anyLabel="Open (default)"
                facets={facets}
              />
            </Labelled>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="sm">
              Apply filters
            </Button>
            <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" name="notDue" value="1" defaultChecked={includeNotDue} />
              Campaign mode — ignore the due date
            </label>
            <Link href="/assign" className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline">
              Clear
            </Link>
            <span className="ml-auto text-[12px] text-ink-3">
              {total} enquir{total === 1 ? "y" : "ies"}
              {includeNotDue ? " matching" : ` due ${formatDate(date)}`}
            </span>
            <ExportButton source="desk" />
          </div>
        </form>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {facetError ? (
          <p className="text-[12px] text-warn" role="status">
            {facetError}
          </p>
        ) : null}

        {/* Cross-page selection. The header checkbox stays "this page only";
            this is the only way to act on rows the manager cannot see. */}
        {total > rows.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunk/40 px-3 py-1.5 text-[12px]">
            {allMatchingSelected ? (
              <>
                <span className="text-ink">
                  All {picked.size} matching enquiries selected, including rows on
                  other pages.
                </span>
                <button
                  type="button"
                  onClick={() => setPicked(new Map())}
                  className="text-ink-2 underline underline-offset-2 hover:text-ink"
                >
                  Clear selection
                </button>
              </>
            ) : (
              <>
                <span className="text-ink-2">
                  {picked.size
                    ? `${picked.size} selected on this page.`
                    : `Showing ${rows.length} of ${total}.`}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={selectAll}
                  className="text-accent underline underline-offset-2 disabled:opacity-60"
                >
                  Select all {total} matching
                </button>
              </>
            )}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={() =>
                      setPicked(
                        allOnPage
                          ? new Map()
                          : new Map(rows.map((r) => [r.enquiry_id, r.bucket])),
                      )
                    }
                  />
                </th>
                <th className="px-2 py-2">Bucket</th>
                <th className="px-2 py-2">Student</th>
                <th className="px-2 py-2">Imp</th>
                <th className="px-2 py-2">Teachers</th>
                <th className="px-2 py-2">Term</th>
                <th className="px-2 py-2">Follow-up</th>
                <th className="px-2 py-2">Slots</th>
                <th className="px-2 py-2">Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.enquiry_id}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    picked.has(r.enquiry_id) && "bg-accent-soft/40",
                  )}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Select enquiry ${r.enquiry_id}`}
                      checked={picked.has(r.enquiry_id)}
                      onChange={() => toggle(r)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <Badge tone={r.bucket === "call_back" ? "neutral" : "info"}>
                        {BUCKET_LABELS[r.bucket]}
                      </Badge>
                      {r.is_overdue ? <Badge tone="danger">Overdue</Badge> : null}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/students/${r.mobile}`}
                      className="text-ink underline-offset-2 hover:underline"
                    >
                      {r.student_name || "No name"}
                    </Link>
                    <span className="ml-1.5 tabular-nums text-ink-3">
                      {formatMobile(r.mobile)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 uppercase">{r.importance ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-2">
                    {r.teacher_names?.join(", ") || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-ink-2">{r.term_name ?? "—"}</td>
                  <td
                    className={cx(
                      "px-2 py-1.5 tabular-nums",
                      r.is_overdue ? "text-danger" : "text-ink-2",
                    )}
                  >
                    {r.next_follow_up_date ? formatDate(r.next_follow_up_date) : "—"}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-ink-2">
                    {r.follow_up_slots_used}/3
                  </td>
                  <td className="px-2 py-1.5 text-ink-2">{r.assigned_to_name ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-ink-3">
                    Nothing due on this date with these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {total > pageSize ? (
          <Pager page={page} pageSize={pageSize} total={total} search={search} />
        ) : null}
      </div>

      {/* ------------------------------- right ------------------------------ */}
      <aside className="flex w-full shrink-0 flex-col gap-3 xl:w-[320px]">
        <section className="rounded-lg border border-line bg-surface">
          <header className="border-b border-line px-3 py-2">
            <h2 className="text-[13px] font-semibold text-ink">
              Counsellors · {formatDate(date)}
            </h2>
          </header>
          <ul className="px-3 py-2 text-[12.5px]">
            {roster.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-1">
                <span className="text-ink-2">{r.name}</span>
                <span className="tabular-nums text-ink-3">{r.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-accent/40 bg-surface px-3 py-3">
          <h2 className="text-[13px] font-semibold text-ink">
            Assign {toAssign.length} selected
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            <Select
              aria-label="Assign to"
              value={counsellor}
              onChange={(e) => setCounsellor(e.target.value)}
            >
              <option value="">Choose a counsellor…</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <p className="text-[11.5px] text-ink-3">
              {includeNotDue ? (
                <>
                  Assigning as <strong>{BUCKET_LABELS.campaign}</strong> for{" "}
                  {formatDate(date)}.
                </>
              ) : (
                <>Each row keeps its own bucket, for {formatDate(date)}.</>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={pending || !toAssign.length || !counsellor}
                onClick={() =>
                  run(() =>
                    assignEnquiries({
                      rows: toAssign,
                      counsellorId: counsellor,
                      date,
                    }),
                  )
                }
              >
                Assign
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending || !ids.length}
                onClick={() => run(() => unassignEnquiries({ enquiryIds: ids, date }))}
              >
                Unassign
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface px-3 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Leave cover</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            Move one counsellor&apos;s whole day to someone else.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <Select aria-label="Move from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">From…</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.count})
                </option>
              ))}
            </Select>
            <Select aria-label="Move to" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">To…</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending || !fromId || !toId}
              onClick={() =>
                run(() => reassignDay({ fromCounsellorId: fromId, toCounsellorId: toId, date }))
              }
            >
              Move the day
            </Button>
          </div>
        </section>

        {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
        {result && !result.error ? (
          <p className="text-[12.5px] text-ok" role="status">
            {result.ok}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function Pager({
  page,
  pageSize,
  total,
  search,
}: {
  page: number;
  pageSize: number;
  total: number;
  search: string;
}) {
  const pages = Math.ceil(total / pageSize);
  const href = (p: number) => {
    const params = new URLSearchParams(search);
    params.set("page", String(p));
    return `?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-3 text-[12.5px] text-ink-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className="underline-offset-2 hover:underline">
          ← Previous
        </Link>
      ) : null}
      <span className="text-ink-3">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="underline-offset-2 hover:underline">
          Next →
        </Link>
      ) : null}
    </div>
  );
}

