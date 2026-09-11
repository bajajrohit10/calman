"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ExportButton } from "@/components/export-button";
import { MultiSelect } from "@/components/multi-select";
import {
  CommonFilterFields,
  FacetSelect,
  Labelled,
  LastCalledByField,
  LastOutcomeField,
  type FilterMasters,
} from "@/components/filter-fields";
import { Badge, Button, ErrorNote, ImportanceMark, Input, Select, cx } from "@/components/ui";
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

export type RosterEntry = {
  id: string;
  name: string;
  role: string;
  /** Leads in the list currently on screen whose last call was theirs. */
  lastCalled: number;
  /** Of this date's assignments: still to call, and already called. */
  pending: number;
  done: number;
};

const STATUS_OPTIONS = Object.entries(ENQUIRY_STATUS_LABELS).map(([id, name]) => ({
  id,
  name,
}));

/**
 * Starting points for the two things a manager does at a fixed time of day
 * (§17.2). Each is just a URL, so it can be shared, bookmarked and backed out
 * of; nothing about them is special to this component.
 */
export const PRESETS: { id: string; label: string; query: (date: string) => string }[] = [
  {
    id: "evening",
    label: "Evening call backs",
    query: (date) =>
      new URLSearchParams({
        date,
        // Needs assignment, not Any: the point of the list is what is still
        // to be handed out, and a lead vanishes from it the moment somebody
        // is given it — reappearing only once they have made the call.
        assignment: "needs",
        preset: "evening",
        lastOutcome: "call_back",
        lastCalledFrom: date,
        lastCalledTo: date,
        // Campaign mode on purpose. A call back logged this morning with no
        // next date set has no due date at all under §6, so the due-date rule
        // would hide exactly the leads this list is for.
        notDue: "1",
        more: "1",
      }).toString(),
  },
  {
    // Everything §6 has put in the Offer bucket today: an open lead matching a
    // live offer inside its reminder window. No notDue here — an offer lead is
    // due on every day of its window by construction, so the due-date rule is
    // already letting it through and campaign mode would only drag in leads
    // the offer has nothing to do with.
    id: "offers",
    label: "Offers closing",
    query: (date) =>
      new URLSearchParams({
        date,
        assignment: "needs",
        preset: "offers",
        bucket: "offer",
      }).toString(),
  },
  {
    // Importance A, re-graded today: §5.8 counts exactly that as a price list
    // issued, and "who did I promise a price list to today" is the follow-up.
    id: "pli",
    label: "PLI issued today",
    query: (date) =>
      new URLSearchParams({
        date,
        assignment: "needs",
        preset: "pli",
        // A only to begin with; the multi-select lets the manager add B or C
        // before applying (§19.3).
        importance: "a",
        lastCalledFrom: date,
        lastCalledTo: date,
        notDue: "1",
        more: "1",
      }).toString(),
  },
];

/** The filters hidden inside the collapsed panel, named for the chips. */
const CHIP_LABELS: Record<string, string> = {
  source: "Source",
  teacher: "Teacher",
  course: "Course",
  subject: "Subject",
  content: "Content",
  importance: "Importance",
  term: "Term",
  institute: "Institute",
  counsellor: "Counsellor",
  stage: "Stage",
  lastCalledBy: "Last called by",
  lastOutcome: "Last outcome",
  q: "Discussion",
  offer: "Offer",
  bucket: "Bucket",
  type: "Type",
  status: "Status",
  lastCalledFrom: "Last called from",
  lastCalledTo: "Last called to",
  createdFrom: "Enquired from",
  createdTo: "Enquired to",
  followUpFrom: "Follow-up from",
  followUpTo: "Follow-up to",
};

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
  multi,
  date,
  page,
  pageSize,
  includeNotDue,
  roster,
  masters,
  selected,
  search,
  assignment,
  showMore,
  preset,
  offers,
  bucket,
}: {
  rows: RecommendedRow[];
  total: number;
  error: string | null;
  /** Absent when the counts could not be trusted; see lib/facets.ts. */
  facets?: FacetMap;
  facetError?: string | null;
  /** Teacher and Content are multi-select (§11.2); the rest are single. */
  multi?: Record<string, string[]>;
  date: string;
  page: number;
  pageSize: number;
  includeNotDue: boolean;
  roster: RosterEntry[];
  masters: DeskMasters;
  selected: Record<string, string>;
  search: string;
  /** 'unassigned' | 'assigned' | 'any'. The desk opens on unassigned (§17.1). */
  assignment: string;
  /** Whether the More filters panel is open, carried in the URL (§17.1). */
  showMore: boolean;
  /** Which preset built this view, if any — it names the campaign (§19.2). */
  preset: string;
  /** The active offers, for the Offer filter (Brief 18). */
  offers: { id: string; name: string }[];
  /** The §6 bucket the view is pinned to, if any. */
  bucket: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Map<number, AssignmentBucket>>(new Map());
  const [counsellor, setCounsellor] = useState("");
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");

  // A campaign assignment is handed out *as* something. When a preset built
  // this view its name is the obvious answer, so it is filled in; otherwise the
  // admin names it. Keyed on the preset so switching preset re-seeds it rather
  // than leaving yesterday's name in the box.
  const presetLabel = PRESETS.find((x) => x.id === preset)?.label ?? "";
  const [label, setLabel] = useState(presetLabel);
  const [labelKey, setLabelKey] = useState(preset);
  if (labelKey !== preset) {
    setLabelKey(preset);
    setLabel(presetLabel);
  }

  // The panel toggle is a link to this same page with `more` flipped, so the
  // open/closed state rides in the URL rather than in storage the server
  // cannot see (§17.1).
  const toggleMore = (() => {
    const params = new URLSearchParams(search);
    if (showMore) params.delete("more");
    else params.set("more", "1");
    return params.toString();
  })();

  // What is set but out of sight. Read from the query string rather than from
  // the parsed filters so a chip appears for anything the URL carries, even a
  // parameter this component does not otherwise render.
  const activeChips = (() => {
    const params = new URLSearchParams(search);
    const chips: string[] = [];
    for (const [key, label] of Object.entries(CHIP_LABELS)) {
      const values = params.getAll(key).filter(Boolean);
      if (!values.length) continue;
      chips.push(values.length > 1 ? `${label} ×${values.length}` : label);
    }
    return chips;
  })();


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
        {/* One-click starting points (§17.2). They are plain links, not
            buttons: a preset is a filter state, so it should be shareable,
            bookmarkable and reachable with the back button like any other. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Presets
          </span>
          {PRESETS.map((preset) => (
            <Link
              key={preset.label}
              href={`/assign?${preset.query(date)}`}
              className="inline-flex h-[24px] items-center rounded-full border border-line-2 bg-surface px-2.5 text-[12px] text-ink-2 hover:border-accent hover:text-accent"
            >
              {preset.label}
            </Link>
          ))}
        </div>

        <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
          {/* Always visible: the two questions the desk is actually about. */}
          <div className="flex flex-wrap items-end gap-2 p-2.5">
            <Labelled label="Date">
              <Input type="date" name="date" defaultValue={date} />
            </Labelled>
            <Labelled label="Assignment">
              <Select name="assignment" defaultValue={assignment}>
                <option value="needs">Needs assignment</option>
                <option value="pending">Pending</option>
                <option value="done">Done</option>
                <option value="any">Any</option>
              </Select>
            </Labelled>

            <span className="flex flex-1 flex-wrap items-center gap-1.5 pb-1">
              {/* The toggle carries its own state in the URL, so an opened
                  panel survives Apply, the back button and a shared link —
                  and needs no storage of any kind. */}
              <Link
                href={`?${toggleMore}`}
                scroll={false}
                className="inline-flex h-[26px] items-center rounded-md border border-line-2 bg-surface px-2.5 text-[12.5px] font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                More filters {showMore ? "−" : "+"}
              </Link>
              {/* What is hidden, when it is hidden. A filter you cannot see is
                  a filter you forget you set. */}
              {!showMore && activeChips.length
                ? activeChips.map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex h-[20px] items-center rounded-full border border-accent/40 bg-accent-soft px-2 text-[11px] text-accent"
                    >
                      {chip}
                    </span>
                  ))
                : null}
              {!showMore && !activeChips.length ? (
                <span className="text-[11.5px] text-ink-3">No other filters set</span>
              ) : null}
            </span>
          </div>

          {/* Hidden rather than unmounted: an unmounted field submits nothing,
              which would silently clear every filter in the panel the moment
              somebody collapsed it and pressed Apply. */}
          <div
            className={cx(
              "flex-wrap gap-2 border-t border-line px-2.5 pb-2.5 pt-2",
              showMore ? "flex" : "hidden",
            )}
          >
            <CommonFilterFields
              masters={masters}
              selected={selected}
              multi={multi}
              roster={roster}
              facets={facets}
              noDetail
            />
            <LastCalledByField
              roster={roster}
              values={multi?.lastCalledBy ?? []}
              facets={facets}
            />
            <LastOutcomeField values={multi?.lastOutcome ?? []} facets={facets} />
            {offers.length ? (
              <Labelled label="Offer">
                <MultiSelect
                  name="offer"
                  facet="offer"
                  options={offers}
                  values={multi?.offer ?? []}
                  facets={facets}
                />
              </Labelled>
            ) : null}
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

          <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-sunk px-2.5 py-2.5">
            <Button type="submit" variant="primary" size="sm">
              Apply filters
            </Button>
            {showMore ? <input type="hidden" name="more" value="1" /> : null}
            {/* The preset's bucket is not a visible field, so it needs
                carrying by hand or Apply would silently widen the list back
                to every bucket. */}
            {bucket ? <input type="hidden" name="bucket" value={bucket} /> : null}
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

        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                <th className="w-8 px-2 py-[7px]">
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
                <th className="px-2 py-[7px]">Bucket</th>
                <th className="px-2 py-[7px]">Student</th>
                <th className="px-2 py-[7px]">Imp</th>
                <th className="px-2 py-[7px]">Teachers</th>
                <th className="px-2 py-[7px]">Term</th>
                <th className="px-2 py-[7px]">Follow-up</th>
                <th className="px-2 py-[7px]">Slots</th>
                <th className="px-2 py-[7px]">Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.enquiry_id}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    // The picked row keeps its own fill and gains an edge, so a long
                    // selection stays findable after the table scrolls sideways.
                    picked.has(r.enquiry_id) &&
                      "bg-accent-pick shadow-[inset_3px_0_0_var(--accent)]",
                  )}
                >
                  <td className="px-2 py-[5px]">
                    <input
                      type="checkbox"
                      aria-label={`Select enquiry ${r.enquiry_id}`}
                      checked={picked.has(r.enquiry_id)}
                      onChange={() => toggle(r)}
                    />
                  </td>
                  <td className="px-2 py-[5px]">
                    <span className="flex items-center gap-1.5">
                      <Badge dot tone={r.bucket === "call_back" ? "warn" : "info"}>
                        {BUCKET_LABELS[r.bucket]}
                      </Badge>
                      {/* Which offer put it here. Two offers, two names, one
                          row — the lead is called once. */}
                      {r.offer_names?.length ? (
                        <span
                          className="truncate text-[11.5px] text-ink-2"
                          title={r.offer_names.join(" · ")}
                        >
                          {r.offer_names.join(" · ")}
                        </span>
                      ) : null}
                      {r.is_overdue ? <Badge tone="danger">Overdue</Badge> : null}
                    </span>
                  </td>
                  <td className="px-2 py-[5px]">
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
                  <td className="px-2 py-[5px]">
                    {r.importance ? <ImportanceMark grade={r.importance} /> : "—"}
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">
                    {r.teacher_names?.join(", ") || "—"}
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">{r.term_name ?? "—"}</td>
                  <td
                    className={cx(
                      "px-2 py-[5px] tabular-nums",
                      r.is_overdue ? "text-danger" : "text-ink-2",
                    )}
                  >
                    {r.next_follow_up_date ? formatDate(r.next_follow_up_date) : "—"}
                  </td>
                  <td className="px-2 py-[5px] tabular-nums text-ink-2">
                    {r.follow_up_slots_used}/3
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">{r.assigned_to_name ?? "—"}</td>
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
        <section className="rounded-lg border border-line bg-surface shadow-card">
          <header className="border-b border-line px-3 py-2">
            <h2 className="text-[13px] font-semibold text-ink">
              Counsellors · {formatDate(date)}
            </h2>
            <p className="text-[11px] text-ink-3">
              &ldquo;Last called&rdquo; counts the list on screen; pending and done
              are this date&rsquo;s assignments.
            </p>
          </header>
          <ul className="px-3 py-2 text-[12.5px]">
            {roster.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-ink-2">{r.name}</span>
                <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-ink-3">
                  last called{" "}
                  <span className={cx("font-medium", r.lastCalled ? "text-ink" : "")}>
                    {r.lastCalled}
                  </span>{" "}
                  · pending{" "}
                  <span className={cx("font-medium", r.pending ? "text-ink" : "")}>
                    {r.pending}
                  </span>{" "}
                  · done{" "}
                  <span className={cx("font-medium", r.done ? "text-ink" : "")}>
                    {r.done}
                  </span>
                </span>
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

            {/* Campaign only: the ordinary buckets are named by the bucket, and
                a label on one of those would show up in My Day as a heading
                competing with the bucket it already has. */}
            {includeNotDue ? (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                  Campaign label
                </span>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="What is this batch? e.g. Evening call backs"
                />
              </label>
            ) : null}
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
                      label: includeNotDue ? label.trim() || null : null,
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

        <section className="rounded-lg border border-line bg-surface shadow-card px-3 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Leave cover</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            Move one counsellor&apos;s whole day to someone else.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <Select aria-label="Move from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">From…</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.pending + r.done})
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

