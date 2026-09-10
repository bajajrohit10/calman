"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import {
  BUCKET_LABELS,
  IMPORTANCE_LABELS,
  type AssignmentBucket,
} from "@/lib/enquiry-labels";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import type { RecommendedRow } from "@/lib/recommended";

import { assignEnquiries, reassignDay, unassignEnquiries } from "./actions";

type Master = { id: string; name: string };
type Subject = Master & { course_id: string };

export type DeskMasters = {
  teachers: Master[];
  courses: Master[];
  subjects: Subject[];
  contents: Master[];
  terms: Master[];
  sources: Master[];
};

export type RosterEntry = { id: string; name: string; role: string; count: number };

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
  date,
  page,
  pageSize,
  includeNotDue,
  roster,
  masters,
  selected,
}: {
  rows: RecommendedRow[];
  total: number;
  error: string | null;
  date: string;
  page: number;
  pageSize: number;
  includeNotDue: boolean;
  roster: RosterEntry[];
  masters: DeskMasters;
  selected: Record<string, string>;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [counsellor, setCounsellor] = useState("");
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");

  const subjectsForCourse = useMemo(
    () =>
      selected.course
        ? masters.subjects.filter((s) => s.course_id === selected.course)
        : masters.subjects,
    [masters.subjects, selected.course],
  );

  const allOnPage = rows.length > 0 && rows.every((r) => picked.has(r.enquiry_id));

  function toggle(id: number) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(fn: () => Promise<{ error: string | null; ok?: string }>) {
    setResult(null);
    start(async () => {
      const res = await fn();
      setResult(res);
      if (!res.error) {
        setPicked(new Set());
        router.refresh();
      }
    });
  }

  const ids = [...picked];
  // Campaign mode is the same filter bar with the due-date restriction lifted,
  // so an assignment made from it is a campaign assignment (§5.5). Otherwise
  // each row keeps the bucket §6 derived for it.
  const toAssign = rows
    .filter((r) => picked.has(r.enquiry_id))
    .map((r) => ({
      enquiryId: r.enquiry_id,
      bucket: (includeNotDue ? "campaign" : r.bucket) as AssignmentBucket,
    }));

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      {/* ------------------------------- left ------------------------------- */}
      <div className="min-w-0 flex-1 flex flex-col gap-3">
        <form method="GET" className="rounded-lg border border-line bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Labelled label="Date">
              <Input type="date" name="date" defaultValue={date} />
            </Labelled>
            <Labelled label="Counsellor">
              <Select name="counsellor" defaultValue={selected.counsellor}>
                <option value="">Anyone</option>
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
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
            <Labelled label="Subject">
              <Select name="subject" defaultValue={selected.subject}>
                <option value="">Any</option>
                {subjectsForCourse.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Labelled>
            <Labelled label="Content">
              <Select name="content" defaultValue={selected.content}>
                <option value="">Any</option>
                {masters.contents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
            <Labelled label="Source">
              <Select name="source" defaultValue={selected.source}>
                <option value="">Any</option>
                {masters.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
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
            <Labelled label="Type">
              <Select name="type" defaultValue={selected.type}>
                <option value="">Purchase (default)</option>
                <option value="purchase">Purchase</option>
                <option value="after_sale">After Sale</option>
              </Select>
            </Labelled>
            <Labelled label="Status">
              <Select name="status" defaultValue={selected.status}>
                <option value="">Open (default)</option>
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="closed">Closed</option>
              </Select>
            </Labelled>
            <Labelled label="Discussion contains">
              <Input name="q" defaultValue={selected.q} placeholder="text in any call note" />
            </Labelled>
            <Labelled label="Enquired from">
              <Input type="date" name="createdFrom" defaultValue={selected.createdFrom} />
            </Labelled>
            <Labelled label="Enquired to">
              <Input type="date" name="createdTo" defaultValue={selected.createdTo} />
            </Labelled>
            <Labelled label="Follow-up from">
              <Input type="date" name="followUpFrom" defaultValue={selected.followUpFrom} />
            </Labelled>
            <Labelled label="Follow-up to">
              <Input type="date" name="followUpTo" defaultValue={selected.followUpTo} />
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
          </div>
        </form>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

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
                      setPicked(allOnPage ? new Set() : new Set(rows.map((r) => r.enquiry_id)))
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
                      onChange={() => toggle(r.enquiry_id)}
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
          <Pager page={page} pageSize={pageSize} total={total} />
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

function Pager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const pages = Math.ceil(total / pageSize);
  const href = (p: number) => {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
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
