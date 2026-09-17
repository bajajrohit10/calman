"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { IMPORTANCE_LABELS, STAGE_FILTER_LABELS } from "@/lib/enquiry-labels";
import { NO_DETAIL_ID, type FacetMap } from "@/lib/facet-shape";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";

import {
  pendingByCounsellor,
  smartAssign,
  smartAssignLoad,
  type SmartRow,
  type SmartSelection,
} from "./smart-actions";

type Master = { id: string; name: string };

/** How many named options a long column shows before folding the rest away. */
const TOP_N = 10;
const OTHER_ID = "__other__";
const NEVER_ID = "__never__";

type Column = {
  key: keyof Omit<SmartSelection, "date" | "campaign">;
  /** The facet name the counts come back under. */
  facet: string;
  label: string;
  /** Long columns get a search box and an "Other" bucket. */
  searchable?: boolean;
};

const COLUMNS: Column[] = [
  { key: "content", facet: "content", label: "Content" },
  { key: "stage", facet: "stage", label: "Stage" },
  { key: "importance", facet: "importance", label: "Importance" },
  { key: "teacher", facet: "teacher", label: "Teacher", searchable: true },
  { key: "institute", facet: "institute", label: "Institute", searchable: true },
  // §47.6. Last, because it is the column a manager reaches for least often
  // and the row is read left to right.
  { key: "source", facet: "source", label: "Source" },
  { key: "lastCalledBy", facet: "last_called_by", label: "Last called by" },
];

type Option = {
  id: string;
  label: string;
  count: number | null;
  /** "Other teachers" stands for a set of ids rather than one. */
  covers?: string[];
};

/**
 * Smart Assign (§34): the whole board as six columns of options.
 *
 * The desk's filter bar asks you to know what you want before you can see what
 * there is. This asks nothing: every option starts selected, so the panel opens
 * showing the entire needs-assignment set, and narrowing is done by taking
 * things away. Within a column the options are an OR — three content types
 * means any of those three — and across columns an AND, which is what a
 * sentence like "Full or FT, graded A, never called" already means when a
 * manager says it out loud.
 *
 * Every click re-counts every other column, because the useful question is
 * never "how many are A" but "how many are A *given everything else I have
 * already said*". That is what the leave-one-out facets have always computed;
 * this screen is the first one to put them all on screen at once.
 */
export function SmartAssignPanel({
  date,
  roster,
  masters,
  backHref,
}: {
  date: string;
  roster: Master[];
  masters: {
    teachers: Master[];
    institutes: Master[];
    contents: Master[];
    sources: Master[];
  };
  /** §40.1: the desk, with the view somebody left still on it. */
  backHref: string;
}) {
  const [campaign, setCampaign] = useState(false);
  /** Per column: the ids explicitly cleared. Empty means "all of them". */
  const [cleared, setCleared] = useState<Record<string, Set<string>>>({});
  const [search, setSearch] = useState<Record<string, string>>({});
  /** Teachers and institutes pulled in by name from the search box. */
  const [pinned, setPinned] = useState<Record<string, string[]>>({});
  const [facets, setFacets] = useState<FacetMap | null>(null);
  const [facetError, setFacetError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [preview, setPreview] = useState<SmartRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  /**
   * §50.2. What this sitting has handed out, in the order it happened.
   *
   * Session-scoped and deliberately not persisted: it answers "what have I
   * just done", which is a question about the last ten minutes. Something
   * durable would be the assignments table, and that is already the answer to
   * the durable version of the question.
   */
  const [tally, setTally] = useState<
    { at: string; total: number; split: { id: string; count: number }[] }[]
  >([]);
  /** Each counsellor's whole-day pending, refreshed after every batch. */
  const [dayPending, setDayPending] = useState<Record<string, number>>({});
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const seq = useRef(0);

  // §50.2. The pending figures are useful before anything is handed out —
  // that is when a manager is deciding who to give it to — so they are loaded
  // once when the panel opens as well as after every batch.
  useEffect(() => {
    let live = true;
    pendingByCounsellor(date).then((r) => {
      if (live && !r.error) setDayPending(r.pending ?? {});
    });
    return () => {
      live = false;
    };
  }, [date]);

  const nameOf = (list: Master[], id: string) =>
    list.find((m) => m.id === id)?.name ?? id;

  /**
   * The options each column offers, in the order they are shown.
   *
   * The long columns fold everyone past the tenth into one option. Its count
   * is the number of names it covers, not the number of leads: a lead with two
   * of those teachers on it would be counted twice by any sum of per-teacher
   * numbers, and a wrong number in a place this prominent is worse than an
   * honest different one. The total on the right is the lead count, always.
   */
  const columns = useMemo(() => {
    const counts = (facet: string) => facets?.byFacet[facet] ?? {};

    return COLUMNS.map((col) => {
      const c = counts(col.facet);
      const count = (id: string) => (facets ? (c[id]?.numbers ?? 0) : null);
      let options: Option[] = [];

      if (col.key === "content") {
        options = masters.contents.map((m) => ({
          id: m.id,
          label: m.name,
          count: count(m.id),
        }));
      } else if (col.key === "source") {
        // §47.6. Every source, in the master list's own order — there are a
        // handful and they are a fixed vocabulary, so none of the top-ten
        // folding the teacher and institute columns need.
        options = masters.sources.map((m) => ({
          id: m.id,
          label: m.name,
          count: count(m.id),
        }));
      } else if (col.key === "stage") {
        options = Object.entries(STAGE_FILTER_LABELS).map(([id, name]) => ({
          id,
          label: name as string,
          count: count(id),
        }));
      } else if (col.key === "importance") {
        options = Object.entries(IMPORTANCE_LABELS).map(([id, name]) => ({
          id,
          label: name as string,
          count: count(id),
        }));
      } else if (col.key === "lastCalledBy") {
        options = [
          ...roster.map((m) => ({ id: m.id, label: m.name, count: count(m.id) })),
          { id: NEVER_ID, label: "Never called", count: count(NEVER_ID) },
        ];
      } else {
        const list = col.key === "teacher" ? masters.teachers : masters.institutes;
        const ranked = [...list]
          .map((m) => ({ id: m.id, label: m.name, count: count(m.id) ?? 0 }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        const shownIds = new Set([
          ...ranked.slice(0, TOP_N).map((r) => r.id),
          ...(pinned[col.key] ?? []),
        ]);
        const top = ranked.filter((r) => shownIds.has(r.id));
        const others = ranked.filter((r) => !shownIds.has(r.id));
        options = [
          ...top.map((r) => ({ ...r, count: facets ? r.count : null })),
          ...(others.length
            ? [
                {
                  id: OTHER_ID,
                  label: `Other ${col.key === "teacher" ? "teachers" : "institutes"}`,
                  count: others.length,
                  covers: others.map((r) => r.id),
                },
              ]
            : []),
        ];
      }

      // "No detail" is offered by every column that can be blank.
      if (col.key !== "stage" && col.key !== "lastCalledBy") {
        options.push({
          id: NO_DETAIL_ID,
          label: col.key === "importance" ? "Not graded" : "No detail",
          count: count(NO_DETAIL_ID),
        });
      }

      const q = (search[col.key] ?? "").trim().toLowerCase();
      // Searching a long column has to reach past the ten on show — the whole
      // point is to find the teacher who is not in the top ten. So the query
      // runs over the full master list and any match becomes an option in its
      // own right, whether or not "Other" currently covers it.
      let visible = options;
      if (q) {
        if (col.searchable) {
          const list = col.key === "teacher" ? masters.teachers : masters.institutes;
          const matches = list
            .filter((m) => m.name.toLowerCase().includes(q))
            .map((m) => ({
              id: m.id,
              label: m.name,
              count: count(m.id),
            }));
          visible = matches;
        } else {
          visible = options.filter((o) => o.label.toLowerCase().includes(q));
        }
      }
      return { ...col, options, visible };
    });
  }, [facets, masters, roster, pinned, search]);

  /** What is selected: every option a column offers, minus the cleared ones. */
  /**
   * The selection these columns describe, with `gone` taken out.
   *
   * Shared by the live selection and by the widened one §50.2 re-counts
   * against after a batch, because "everything selected" has to be built the
   * same way "this much selected" is — a column counts as unfiltered only
   * when it holds every id it offers, so an empty array would mean the
   * opposite of what the reset intends.
   */
  const buildSelection = useCallback(
    (gone: Record<string, Set<string>>): SmartSelection => {
      const out: Record<string, string[]> = {};
      for (const col of columns) {
        const dropped = gone[col.key] ?? new Set<string>();
        const ids: string[] = [];
        for (const o of col.options) {
          if (dropped.has(o.id)) continue;
          if (o.covers) ids.push(...o.covers);
          else ids.push(o.id);
        }
        out[col.key] = ids;
      }
      return {
        date,
        campaign,
        content: out.content ?? [],
        stage: out.stage ?? [],
        importance: out.importance ?? [],
        teacher: out.teacher ?? [],
        institute: out.institute ?? [],
        source: out.source ?? [],
        lastCalledBy: out.lastCalledBy ?? [],
      };
    },
    [columns, date, campaign],
  );

  const selection = useMemo(
    () => buildSelection(cleared),
    [buildSelection, cleared],
  );

  /** How many ids each column *could* offer, so the server can spot "all". */
  const offered = useMemo(() => {
    const out: Record<string, number> = {};
    for (const col of columns) {
      out[col.key] = col.options.reduce(
        (n, o) => n + (o.covers ? o.covers.length : 1),
        0,
      );
    }
    return out;
  }, [columns]);

  // Re-count on every change. Sequenced, because a fast series of clicks would
  // otherwise let an older answer land last and describe the wrong selection.
  useEffect(() => {
    const mine = ++seq.current;
    start(async () => {
      const res = await smartAssignLoad(selection, offered);
      // A stale answer never lands: a fast run of clicks would otherwise let
      // an older count describe a newer selection.
      if (mine !== seq.current) return;
      setError(null);
      if (res.error) {
        setError(res.error);
        return;
      }
      setFacets(res.facets ?? null);
      setFacetError(res.facetError ?? null);
      setTotal(res.total ?? 0);
      setPreview(res.preview ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(selection)]);

  const toggle = (key: string, id: string) =>
    setCleared((c) => {
      const next = new Set(c[key] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...c, [key]: next };
    });

  const setWhole = (key: string, ids: string[], on: boolean) =>
    setCleared((c) => ({ ...c, [key]: on ? new Set<string>() : new Set(ids) }));

  function assign(counsellorIds: string[]) {
    setError(null);
    setToast(null);
    start(async () => {
      const res = await smartAssign({
        selection,
        offered,
        counsellorIds,
        label: label.trim() || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      const split = (res.split ?? []).map((s) => ({ id: s.name, count: s.count }));
      const who = split.map((s) => `${nameOf(roster, s.id)} ${s.count}`).join(", ");
      setToast(`${res.ok}: ${who}`);
      setTally((t) => [
        ...t,
        {
          at: new Intl.DateTimeFormat("en-IN", {
            hour: "2-digit", minute: "2-digit", hour12: false,
            timeZone: "Asia/Kolkata",
          }).format(new Date()),
          total: split.reduce((n, s) => n + s.count, 0),
          split,
        },
      ]);

      /**
       * §50.2. Every column back to all-selected after a batch.
       *
       * A manager hands out one pile and then asks a different question; the
       * panel used to keep the narrowing that produced the pile just handed
       * out, so the next question started from a filter nobody had asked for
       * on a set that had just shrunk. The date and Campaign mode stay,
       * because those describe the sitting rather than the batch.
       */
      setCleared({});
      setSearch({});
      setPinned({});

      // Re-counted against the widened selection, not the one that was just
      // assigned from — otherwise the totals would describe a filter that is
      // no longer on screen.
      const [again, load] = await Promise.all([
        smartAssignLoad(buildSelection({}), offered),
        pendingByCounsellor(selection.date),
      ]);
      if (!again.error) {
        setFacets(again.facets ?? null);
        setTotal(again.total ?? 0);
        setPreview(again.preview ?? []);
      }
      if (!load.error) setDayPending(load.pending ?? {});
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
        <h2 className="text-[14px] font-semibold text-ink">Smart assign</h2>
        <span className="text-[12px] text-ink-3">
          Needs-assignment purchase leads for {formatDate(date)}.
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={campaign}
            onChange={(e) => setCampaign(e.target.checked)}
          />
          Campaign mode
          <span className="text-[11px] text-ink-3">(ignore the due date)</span>
        </label>
        {pending ? <span className="text-[11.5px] text-ink-3">counting…</span> : null}
        <Link
          href={backHref}
          className="ml-auto text-[12.5px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          ← Back to the desk
        </Link>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {facetError ? (
        <p className="rounded-md border border-warn/40 bg-warn-soft/40 px-3 py-1.5 text-[12px] text-warn">
          {facetError}
        </p>
      ) : null}
      {toast ? (
        <p
          role="status"
          className="rounded-md border border-ok/40 bg-ok-soft px-3 py-1.5 text-[12.5px] text-ok"
        >
          {toast}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setToast(null)}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="flex gap-3">
        {/* Six columns, one screen. Each is its own scroll region so a long
            teacher list cannot push the rail off the bottom. */}
        {/* Six across from 1280 up, which is the width the brief specifies and
            the width a desk actually is. Below that they wrap rather than
            shrink past reading — three columns of legible options beat six of
            truncated ones. */}
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
          {columns.map((col) => {
            const gone = cleared[col.key] ?? new Set<string>();
            const allIds = col.options.map((o) => o.id);
            return (
              <section
                key={col.key}
                className="flex min-w-0 flex-col rounded-lg border border-line bg-surface shadow-card"
              >
                <header className="flex items-baseline gap-1.5 border-b border-line px-2 py-1.5">
                  <h3 className="text-[11.5px] font-semibold text-ink">{col.label}</h3>
                  <button
                    type="button"
                    onClick={() => setWhole(col.key, allIds, true)}
                    className="ml-auto text-[10.5px] text-ink-3 underline-offset-2 hover:text-accent hover:underline"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhole(col.key, allIds, false)}
                    className="text-[10.5px] text-ink-3 underline-offset-2 hover:text-accent hover:underline"
                  >
                    Clear
                  </button>
                </header>

                {col.searchable ? (
                  <div className="border-b border-line px-1.5 py-1.5">
                    <Input
                      aria-label={`Search ${col.label}`}
                      placeholder="Find by name…"
                      className="h-[24px] text-[11.5px]"
                      value={search[col.key] ?? ""}
                      onChange={(e) =>
                        setSearch((s) => ({ ...s, [col.key]: e.target.value }))
                      }
                    />
                  </div>
                ) : null}

                {/* §40.2. Bound to the window, not to a number that happened
                    to fit one: on a 720px-tall laptop a fixed 420 plus the
                    chrome above it is what would push the page into a scroll.
                    The column scrolls; the page never does. */}
                <ul className="max-h-[min(420px,calc(100dvh-320px))] min-h-0 flex-1 overflow-y-auto py-1">
                  {col.visible.map((o) => {
                    const on = !gone.has(o.id);
                    const zero = o.count === 0;
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            // A searched-for name becomes a permanent option,
                            // so it is still there when the box is cleared.
                            if (col.searchable && !col.options.some((x) => x.id === o.id)) {
                              setPinned((p) => ({
                                ...p,
                                [col.key]: [...(p[col.key] ?? []), o.id],
                              }));
                            }
                            toggle(col.key, o.id);
                          }}
                          className={cx(
                            "flex w-full items-center gap-1.5 px-2 py-[3px] text-left text-[11.5px]",
                            on ? "text-ink" : "text-ink-3 line-through",
                            // Greyed, never hidden and never disabled: a zero
                            // is an answer, and clicking it is how you find
                            // out what it would take to make it non-zero.
                            zero && "opacity-55",
                            "hover:bg-surface-2",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cx(
                              "size-[11px] shrink-0 rounded-[3px] border",
                              on ? "border-accent bg-accent" : "border-line-2 bg-surface",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{o.label}</span>
                          <span className="shrink-0 tabular-nums text-ink-3">
                            {o.count ?? "—"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {col.visible.length === 0 ? (
                    <li className="px-2 py-2 text-[11px] text-ink-3">No matches.</li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>

        {/* ---- the rail ---- */}
        <aside className="flex w-[260px] shrink-0 flex-col gap-2.5 rounded-lg border border-line bg-surface px-3 py-3 shadow-card 2xl:w-[290px]">
          <div>
            <p className="text-[26px] font-semibold leading-none tabular-nums text-ink">
              {total ?? "—"}
            </p>
            <p className="text-[12px] text-ink-3">
              lead{total === 1 ? "" : "s"} match
            </p>
          </div>

          <div className="max-h-[min(210px,calc(100dvh-560px))] min-h-[88px] overflow-y-auto rounded-md border border-line">
            {preview.map((r) => (
              <div
                key={r.enquiryId}
                className="flex items-center gap-1.5 border-b border-line px-2 py-1 text-[11.5px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-ink">
                  {r.studentName || "No name"}
                </span>
                <span className="tabular-nums text-ink-3">{formatMobile(r.mobile)}</span>
              </div>
            ))}
            {preview.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11.5px] text-ink-3">
                Nothing matches.
              </p>
            ) : null}
          </div>
          {total && total > preview.length ? (
            <p className="text-[11px] text-ink-3">
              First {preview.length} of {total}.
            </p>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Counsellors
            </span>
            <Select
              multiple
              aria-label="Counsellors"
              className="h-[104px] py-1"
              value={picked}
              onChange={(e) =>
                setPicked([...e.target.selectedOptions].map((o) => o.value))
              }
            >
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </label>

          {campaign ? (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Campaign label
              </span>
              <Input
                value={label}
                placeholder="Evening call backs"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
          ) : null}

          <Button
            variant="primary"
            disabled={pending || !total || picked.length !== 1}
            onClick={() => assign(picked)}
          >
            {picked.length === 1
              ? `Assign ${total ?? 0} to ${nameOf(roster, picked[0])}`
              : "Assign to one counsellor"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending || !total || picked.length < 2}
            onClick={() => assign(picked)}
          >
            {picked.length >= 2
              ? `Split ${total ?? 0} across ${picked.length}`
              : "Split across counsellors"}
          </Button>
          <p className="text-[11px] leading-relaxed text-ink-3">
            Split deals one each in turn, oldest follow-up first, so the backlog
            is shared rather than landing on whoever is first in the list.
          </p>

          <SessionTally
            tally={tally}
            roster={roster}
            dayPending={dayPending}
            onReset={() => setTally([])}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * What this sitting has handed out (§50.2).
 *
 * Two numbers per counsellor, because one of them alone misleads. "Susmita 12"
 * says what just happened; "12 · 30 pending" says whether the next batch
 * should go to her — a manager splitting work needs the load, not the delta,
 * and the delta is the only thing the toast could ever show.
 *
 * The lines below it are the audit trail of the sitting: each batch, who got
 * what, and when. Managers hand out four or five piles in a morning and are
 * asked afterwards which one somebody was in.
 */
function SessionTally({
  tally,
  roster,
  dayPending,
  onReset,
}: {
  tally: { at: string; total: number; split: { id: string; count: number }[] }[];
  roster: Master[];
  dayPending: Record<string, number>;
  onReset: () => void;
}) {
  const perCounsellor = new Map<string, number>();
  for (const batch of tally) {
    for (const s of batch.split) {
      perCounsellor.set(s.id, (perCounsellor.get(s.id) ?? 0) + s.count);
    }
  }
  const grand = [...perCounsellor.values()].reduce((n, v) => n + v, 0);
  const nameOf = (id: string) => roster.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
      <div className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold text-ink">Assigned this session</h3>
        {tally.length ? (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Reset
          </button>
        ) : null}
      </div>

      {!tally.length ? (
        <p className="text-[11.5px] text-ink-3">
          Nothing handed out yet. Each batch is listed here as it goes.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5">
            {[...perCounsellor.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id, n]) => (
                <li key={id} className="flex items-baseline gap-1.5 text-[12px]">
                  <span className="min-w-0 flex-1 truncate text-ink-2">{nameOf(id)}</span>
                  <span className="tabular-nums font-medium text-ink">{n}</span>
                  {/* The whole day, not this sitting — see above. */}
                  <span className="tabular-nums text-[11px] text-ink-3">
                    · {dayPending[id] ?? 0} pending
                  </span>
                </li>
              ))}
          </ul>

          <div className="flex items-baseline gap-1.5 border-t border-line pt-1 text-[12px]">
            <span className="min-w-0 flex-1 text-ink-2">Total</span>
            <span className="tabular-nums font-semibold text-ink">{grand}</span>
          </div>

          <ul className="flex flex-col gap-0.5 border-t border-line pt-1">
            {tally.map((b, i) => (
              <li key={i} className="text-[11px] leading-snug text-ink-3">
                Assigned {b.total}: {b.split.map((s) => `${nameOf(s.id)} ${s.count}`).join(", ")}
                {" · "}
                {b.at}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
