"use client";


import { StudentLink } from "@/components/student-link";
import { useConfirmLeave } from "@/components/unsaved-guard";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { loadPanelEnquiry, type PanelPayload } from "@/components/call-log/actions";
import { CallLogPanel, type PanelMasters } from "@/components/call-log/panel";
import { ExportButton } from "@/components/export-button";
import { TicketTable } from "@/components/ticket-table";
import {
  Badge,
  Button,
  ErrorNote,
  FIELD_LABEL,
  ImportanceMark,
  Input,
  Select,
  cx,
} from "@/components/ui";
import {
  ENQUIRY_STATUS_LABELS,
  OFFER_STATUS_FILTER,
  OUTCOME_SHORT,
  offerStatusLabel,
  offerStatusOf,
} from "@/lib/enquiry-labels";
import { formatDate, formatTime } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import type { MyDayData, MyDayRow, MyDayTicket } from "@/lib/my-day";
import {
  ALL_SUB_TAB,
  formatSubTab,
  matchesSubTab,
  SLOT_SUB_TABS,
  SLOT_TABS,
  type MyDaySubTab,
} from "@/lib/my-day-tabs";
import { MY_DAY_TABS, type MyDayTabKey } from "@/lib/my-day-tabs";
import type { RecommendedRow } from "@/lib/recommended";

import { dismissOverdue } from "../assign/actions";
import { refreshMyDay } from "./actions";

/**
 * The day, as five boxes.
 *
 * It used to be one scrolling column of bucket sections, which answered "what
 * is next" and nothing else — not how much is left, not what has already been
 * done, and not where the after-sale work was. The tabs answer all three at a
 * glance: each carries "still to call / assigned today", and the one you are
 * in splits into Pending and Done.
 *
 * The buckets map to the tabs rather than being shown raw, because two of them
 * mean the same thing to a counsellor: a follow-up and a call back are both
 * "the desk gave me this", which is what Assigned Calls says.
 */
// The tab table lives in lib/my-day-tabs so the export can mean the same thing
// by "Assigned Calls" that this screen does.
type TabKey = MyDayTabKey;
const TABS = MY_DAY_TABS;

/** Newest call first — the Done list reads as a log of the day. */
const byCallTimeDesc = <T extends { last_call_at: string | null }>(a: T, b: T) =>
  (b.last_call_at ?? "").localeCompare(a.last_call_at ?? "");

export function MyDay({
  initial,
  date,
  isAdmin,
  counsellorName,
  counsellorId,
  roster,
  overdue,
  overdueDismissed,
  masters,
}: {
  initial: MyDayData;
  date: string;
  isAdmin: boolean;
  counsellorName: string | null;
  counsellorId: string;
  roster: { id: string; name: string }[];
  overdue: RecommendedRow[];
  overdueDismissed: boolean;
  masters: PanelMasters;
}) {
  const router = useRouter();

  // The day is client state after the first paint so a saved call can move the
  // counts without the route re-rendering and losing the open tab (see
  // refreshMyDay). `initial` is the server's copy and seeds it.
  const [data, setData] = useState<MyDayData>(initial);
  const [tab, setTab] = useState<TabKey>("new");
  const [view, setView] = useState<"pending" | "done">("pending");
  const [open, setOpen] = useState<PanelPayload | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // §27.2. Where the list was scrolled when a first call took the screen, so
  // Back puts the counsellor where they left off rather than at the top.
  const scrollBeforeOpen = useRef(0);
  const confirmLeave = useConfirmLeave();
  // §23.4. All three to begin with: an offer is aimed at people who have not
  // bought, and most of those were given up on long ago.
  const [offerStatuses, setOfferStatuses] = useState<string[]>(
    OFFER_STATUS_FILTER.map((o) => o.id),
  );
  // §24. Kept across a save on purpose: a counsellor working the 2/3 rung
  // logs a call and expects to still be on 2/3 with one fewer to do, not
  // thrown back to the whole list to find their place again.
  const [subTab, setSubTab] = useState<MyDaySubTab>(ALL_SUB_TAB);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // One button per visible row, in render order, so focus can move to the next
  // row after a call is logged without waiting for the list to come back.
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const openIndex = useRef<number>(-1);

  const groups = useMemo(() => {
    const out = {} as Record<
      TabKey,
      { pending: number; total: number; rows: MyDayRow[]; tickets: MyDayTicket[] }
    >;
    for (const t of TABS) {
      if (t.key === "tickets") {
        out[t.key] = {
          pending: data.tickets.filter((x) => !x.called_today).length,
          total: data.tickets.length,
          rows: [],
          tickets: data.tickets,
        };
        continue;
      }
      // my_day() already returns §6 order, so filtering preserves it.
      const rows = data.rows.filter(
        (r) =>
          t.buckets.includes(r.bucket) &&
          (t.key !== "offer" ||
            offerStatuses.includes(offerStatusOf(r.status, r.lost_reason) ?? "open")),
      );
      out[t.key] = {
        pending: rows.filter((r) => !r.called_today).length,
        total: rows.length,
        rows,
        tickets: [],
      };
    }
    return out;
  }, [data, offerStatuses]);

  const current = groups[tab];

  /**
   * The sub-tabs for the tab in view, each counted over that tab's own rows
   * (§24). Counted before the sub-tab filter, or every tab but the selected
   * one would read zero.
   */
  const subTabs = useMemo((): {
    key: string;
    label: string;
    sub: MyDaySubTab;
    pending: number;
    total: number;
  }[] => {
    const count = (sub: MyDaySubTab) => {
      const rows = current.rows.filter((r) => matchesSubTab(r, sub));
      return { total: rows.length, pending: rows.filter((r) => !r.called_today).length };
    };
    const all = { key: "all", label: "All", sub: ALL_SUB_TAB, ...count(ALL_SUB_TAB) };

    if (SLOT_TABS.includes(tab)) {
      return [
        all,
        ...SLOT_SUB_TABS.map((slot) => ({
          key: `slot:${slot}`,
          label: `${slot}/3`,
          sub: { kind: "slot" as const, slot },
          ...count({ kind: "slot", slot }),
        })),
      ];
    }

    if (tab === "offer") {
      // Only the offers this counsellor actually has leads for today — a tab
      // per offer in the database would be a row of empty tabs.
      const present = new Set(current.rows.flatMap((r) => r.offer_ids ?? []));
      const tabs = data.offerTabs
        .filter((o) => present.has(o.id))
        .map((o) => ({
          key: `offer:${o.id}`,
          label: o.label ? `${o.name} (${o.label})` : o.name,
          sub: { kind: "offer" as const, offerId: o.id },
          ...count({ kind: "offer", offerId: o.id }),
        }));
      return tabs.length ? [all, ...tabs] : [];
    }

    return [];
  }, [tab, current.rows, data.offerTabs]);

  // An offer can close, or its last lead can be called, between renders. A
  // sub-tab that is no longer offered falls back to All rather than showing an
  // empty list with nothing selected.
  const subTabKey = formatSubTab(subTab);
  const activeSub =
    subTabs.length && !subTabs.some((t) => t.key === subTabKey) ? ALL_SUB_TAB : subTab;
  // What the Pending/Done toggle is counting: the sub-tab in view, not the
  // whole tab, or the toggle would promise rows the list is filtering out.
  const subCounts = useMemo(() => {
    const rows = current.rows.filter((r) => matchesSubTab(r, activeSub));
    return { total: rows.length, pending: rows.filter((r) => !r.called_today).length };
  }, [current.rows, activeSub]);

  const activeSubName =
    activeSub.kind === "offer"
      ? (data.offerTabs.find((o) => o.id === activeSub.offerId)?.name ?? null)
      : null;

  // The Customised tab is a pile of campaigns, not one list: a counsellor with
  // "Evening call backs" and "PLI issued today" on the same day needs to know
  // which is which and how much of each is left. Unlabelled work sorts last —
  // it is the residue, not a campaign.
  const labelGroups = useMemo(() => {
    if (tab !== "custom") return [];
    const by = new Map<string, MyDayRow[]>();
    for (const r of current.rows) {
      const key = r.assignment_label?.trim() || "";
      (by.get(key) ?? by.set(key, []).get(key)!).push(r);
    }
    return [...by.entries()]
      .sort((a, b) =>
        a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0]),
      )
      .map(([label, rows]) => ({
        label,
        rows,
        pending: rows.filter((r) => !r.called_today).length,
        total: rows.length,
      }));
  }, [tab, current.rows]);

  const visibleRows = useMemo(() => {
    const rows = current.rows.filter(
      (r) =>
        (view === "done" ? r.called_today : !r.called_today) &&
        matchesSubTab(r, activeSub),
    );
    return view === "done" ? [...rows].sort(byCallTimeDesc) : rows;
  }, [current.rows, view, activeSub]);

  const visibleTickets = useMemo(() => {
    const rows = current.tickets.filter((t) =>
      view === "done" ? t.called_today : !t.called_today,
    );
    return view === "done" ? [...rows].sort(byCallTimeDesc) : rows;
  }, [current.tickets, view]);

  async function openEnquiry(enquiryId: number, index: number) {
    // §27.4. Swapping rows throws away whatever is typed in the panel just as
    // surely as navigating away does, so it asks the same question first.
    if (!(await confirmLeave())) return;
    setLoadError(null);
    openIndex.current = index;
    scrollBeforeOpen.current = window.scrollY;
    start(async () => {
      const res = await loadPanelEnquiry(enquiryId);
      if (res.error || !res.enquiry) {
        setLoadError(res.error ?? "Could not open that enquiry.");
        return;
      }
      setOpen(res.enquiry);
    });
  }

  /**
   * §27.2. A lead nobody has called opens the full-width first-call form in
   * place of the list; a follow-up keeps the side drawer. The form is the
   * whole job on a first call — a 520px drawer cannot hold twelve fields
   * without scrolling, which is the thing the layout exists to avoid.
   */

  function closeOpen() {
    void confirmLeave().then((ok) => {
      if (!ok) return;
      setOpen(null);
      // After the list is back, not before: the scroll target does not exist
      // while the form is standing in its place.
      requestAnimationFrame(() => window.scrollTo({ top: scrollBeforeOpen.current }));
    });
  }

  function afterSave(note?: string) {
    const next = openIndex.current;
    setSaveNote(note ?? null);
    setOpen(null);
    start(async () => {
      const fresh = await refreshMyDay({ date, counsellorId });
      setData(fresh);
      // The row just called leaves Pending, so whatever now sits at the same
      // position is the next call — the list shortened under the cursor rather
      // than the cursor moving down it.
      window.setTimeout(() => {
        const list = buttons.current.filter(Boolean);
        (list[next] ?? list[list.length - 1])?.focus();
      }, 60);
    });
  }


  /** One row of the day. Shared by the flat list and the labelled groups. */
  function rowFor(r: MyDayRow, i: number) {
    return (
                <li
                  key={r.enquiry_id}
                  className={cx(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0",
                    open?.id === r.enquiry_id &&
                      "bg-accent-pick shadow-[inset_3px_0_0_var(--accent)]",
                  )}
                >
                  <StudentLink
                    mobile={r.mobile}
                    className="text-[13px] font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {r.student_name || "No name"}
                  </StudentLink>
                  <span className="text-[12.5px] tabular-nums text-ink-2">
                    {formatMobile(r.mobile)}
                  </span>
                  {r.importance ? <ImportanceMark grade={r.importance} /> : null}
                  {r.is_overdue && !r.called_today ? (
                    <Badge tone="danger">Overdue</Badge>
                  ) : null}
                  {/* The lead came in again today and is still yours. Without
                      this the only record is the import report, which the
                      person holding the lead has no reason to open. */}
                  {r.re_enquired_today ? (
                    <Badge tone="warn" dot>
                      Re-enquired
                    </Badge>
                  ) : null}
                  {r.status !== "open" ? (
                    <Badge
                      dot
                      tone={r.status === "won" ? "ok" : "neutral"}
                    >
                      {ENQUIRY_STATUS_LABELS[r.status]}
                    </Badge>
                  ) : null}
                  {/* Which offer this is about. The counsellor is about to say
                      it out loud, so it belongs on the row rather than behind
                      a click (Brief 18). */}
                  {r.offer_names?.length ? (
                    <Badge tone="info">{r.offer_names.join(" · ")}</Badge>
                  ) : null}
                  {offerStatusLabel(r.status, r.lost_reason) ? (
                    <Badge tone="warn">
                      {offerStatusLabel(r.status, r.lost_reason)}
                    </Badge>
                  ) : null}
                  <span className="text-[12px] text-ink-3">
                    {r.teacher_names?.join(", ") || "no interests yet"}
                  </span>

                  {r.called_today ? (
                    <span className="text-[12px] text-ink-2">
                      {r.last_outcome ? OUTCOME_SHORT[r.last_outcome] : "Called"}{" "}
                      <span className="tabular-nums text-ink-3">
                        {formatTime(r.last_call_at)}
                      </span>
                    </span>
                  ) : (
                    <span
                      className={cx(
                        "text-[12px] tabular-nums",
                        r.is_overdue ? "text-danger" : "text-ink-3",
                      )}
                    >
                      {r.next_follow_up_date ? formatDate(r.next_follow_up_date) : "—"}
                    </span>
                  )}

                  <span className="text-[12px] tabular-nums text-ink-3">
                    {r.follow_up_slots_used}/3
                  </span>
                  <span className="ml-auto">
                    <Button
                      ref={(el) => {
                        buttons.current[i] = el;
                      }}
                      size="sm"
                      variant={r.called_today ? "secondary" : "primary"}
                      disabled={pending}
                      onClick={() => openEnquiry(r.enquiry_id, i)}
                    >
                      {r.called_today ? "Log another" : "Log call"}
                    </Button>
                  </span>
                </li>
    );
  }

  const tabsTotal = TABS.reduce((n, t) => n + groups[t.key].total, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2.5 shadow-card">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-[3px]">
            <span className={FIELD_LABEL}>Date</span>
            <Input type="date" name="date" defaultValue={date} className="w-[150px]" />
          </label>
          {isAdmin ? (
            <label className="flex flex-col gap-[3px]">
              <span className={FIELD_LABEL}>Counsellor</span>
              <Select
                name="counsellor"
                defaultValue={counsellorId}
                className="w-[190px]"
              >
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button type="submit" variant="primary">
            Show
          </Button>
        </form>
        <span className="ml-auto pb-1 text-[12px] text-ink-3">
          {tabsTotal} assigned for {formatDate(date)}
        </span>
      </div>

      {data.error ? <ErrorNote>{data.error}</ErrorNote> : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
      {saveNote ? (
        <p
          className="rounded-md border border-accent/40 bg-accent-soft px-3 py-1.5 text-[12.5px] text-accent"
          role="status"
        >
          {saveNote}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setSaveNote(null)}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {/* ---- the five boxes ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {TABS.map((t) => {
          const g = groups[t.key];
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setTab(t.key);
                setSubTab(ALL_SUB_TAB);
                // Landing on a tab with nothing left to call and showing an
                // empty Pending list would look broken; the work is in Done.
                setView(g.pending === 0 && g.total > 0 ? "done" : "pending");
                setOpen(null);
              }}
              className={cx(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                active
                  ? "border-accent bg-accent-soft shadow-card"
                  : "border-line bg-surface shadow-card hover:border-ink-3",
              )}
            >
              <span
                className={cx(
                  "block text-[11.5px] font-medium",
                  active ? "text-accent" : "text-ink-2",
                )}
              >
                {t.label}
              </span>
              <span className="mt-0.5 block text-[17px] font-semibold tabular-nums text-ink">
                {g.pending}
                <span className="text-[13px] font-normal text-ink-3"> / {g.total}</span>
              </span>
              <span className="block text-[10.5px] text-ink-3">
                {g.total === 0 ? "nothing today" : "to call / assigned"}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---- sub-tabs: the slot ladder, or one per offer (§24) ---- */}
      {subTabs.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {subTabs.map((t) => {
            const on = t.key === formatSubTab(activeSub);
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                onClick={() => setSubTab(t.sub)}
                // An empty sub-tab is greyed rather than hidden: the slot
                // ladder is a fixed shape and a rung vanishing when it empties
                // would move every tab under the cursor.
                className={cx(
                  "rounded-full border px-2.5 py-[3px] text-[12px] transition-colors",
                  on
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : t.total === 0
                      ? "border-line-2 bg-surface text-ink-3"
                      : "border-line-2 bg-surface-2 text-ink-2 hover:border-ink-3 hover:text-ink",
                )}
              >
                {t.label}
                <span className="ml-1.5 tabular-nums opacity-80">
                  {t.pending}/{t.total}
                </span>
              </button>
            );
          })}
          <span className="text-[11.5px] text-ink-3">
            {tab === "offer"
              ? "pending / total per offer"
              : "pending / total by follow-ups used at the start of the day"}
          </span>
        </div>
      ) : null}

      {/* ---- pending / done ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-line-2">
          {(["pending", "done"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cx(
                "px-3 py-1 text-[12.5px] capitalize transition-colors",
                view === v
                  ? "bg-accent font-medium text-accent-ink"
                  : "bg-surface text-ink-2 hover:bg-surface-2",
              )}
            >
              {v}
              <span className="ml-1.5 tabular-nums opacity-80">
                {v === "pending" ? subCounts.pending : subCounts.total - subCounts.pending}
              </span>
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-ink-3">
          {view === "pending"
            ? "Still to call today, in the order §6 recommends."
            : "Called today, most recent first."}
        </span>
        {pending ? <span className="text-[11.5px] text-ink-3">working…</span> : null}
        {/* Only on the Offer tab: every other tab is open leads by
            construction, and three checkboxes that do nothing are worse than
            no checkboxes. */}
        {tab === "offer" ? (
          <span className="flex flex-wrap items-center gap-2 text-[11.5px]">
            {OFFER_STATUS_FILTER.map((o) => {
              const on = offerStatuses.includes(o.id);
              return (
                <label key={o.id} className="flex cursor-pointer items-center gap-1 text-ink-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setOfferStatuses((s) =>
                        on ? s.filter((v) => v !== o.id) : [...s, o.id],
                      )
                    }
                  />
                  {o.name}
                </label>
              );
            })}
          </span>
        ) : null}
        {/* Beside the toggle, not up in the date bar: it exports this tab and
            this half of it, and the control should sit where that is legible. */}
        <span className="ml-auto">
          <ExportButton
            source="myday"
            date={date}
            counsellorId={counsellorId}
            tab={tab}
            view={view}
            subTab={formatSubTab(activeSub)}
            subTabName={activeSubName}
          />
        </span>
      </div>

      {open ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={closeOpen}
            className="self-start text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
          >
            ← Back to {TABS.find((t) => t.key === tab)?.label ?? "the list"}
          </button>
          <CallLogPanel
            enquiry={open}
            masters={masters}
            counsellorName={counsellorName}
            onSaved={afterSave}
            onCancel={closeOpen}
          />
        </div>
      ) : null}

      <div className={cx("gap-4 lg:flex-row", open ? "hidden" : "flex flex-col")}>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {tab === "tickets" ? (
            <TicketTable
              rows={visibleTickets}
              openId={open?.id ?? null}
              onOpen={(row) => {
                // Closed tickets open too — Reopen lives in the panel (§26.1).
                openEnquiry(
                  row.enquiry_id,
                  visibleTickets.findIndex((t) => t.enquiry_id === row.enquiry_id),
                );
              }}
              empty={
                view === "pending"
                  ? "No open tickets waiting — every one has been called today."
                  : "No ticket has been called today."
              }
            />
          ) : tab === "custom" && labelGroups.length > 1 ? (
            // More than one campaign on the day, so the headings earn their
            // room. A single campaign is just "the list" and gets none.
            <div className="flex flex-col gap-3">
              {labelGroups.map((group) => {
                const shown = group.rows.filter((r) =>
                  view === "done" ? r.called_today : !r.called_today,
                );
                if (!shown.length) return null;
                return (
                  <section key={group.label || "_none"}>
                    <h3 className="mb-1 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                      {group.label || "No label"}
                      <span className="tabular-nums text-ink-2">
                        {group.pending} / {group.total}
                      </span>
                    </h3>
                    <ul className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
                      {shown.map((r) => rowFor(r, visibleRows.indexOf(r)))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : visibleRows.length ? (
            <ul className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
              {visibleRows.map((r, i) => rowFor(r, i))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-line-2 px-4 py-8 text-center text-[13px] text-ink-3">
              {current.total === 0
                ? `Nothing in ${TABS.find((t) => t.key === tab)?.label} for ${formatDate(date)}.`
                : view === "pending"
                  ? "All called — everything here is in Done."
                  : "Nothing called yet in this tab."}
            </p>
          )}

          {isAdmin ? (
            <OverdueReport
              rows={overdue}
              date={date}
              dismissed={overdueDismissed}
              onDismissed={() => router.refresh()}
            />
          ) : null}
        </div>

        {/* §28.3: no side drawer. Every call opens in the window above. */}
      </div>
    </div>
  );
}

function OverdueReport({
  rows,
  date,
  dismissed,
  onDismissed,
}: {
  rows: RecommendedRow[];
  date: string;
  dismissed: boolean;
  onDismissed: () => void;
}) {
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  if (!rows.length) return null;

  return (
    <section className="rounded-lg border border-warn/40 bg-warn-soft/30">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold text-ink">
          Overdue follow-ups ({rows.length})
        </h2>
        <span className="text-[11.5px] text-ink-3">
          Past their date and not called since. They still roll forward.
        </span>
        {dismissed ? (
          <Badge tone="neutral">Dismissed for {formatDate(date)}</Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await dismissOverdue(date);
                setResult(res);
                if (!res.error) onDismissed();
              })
            }
          >
            Dismiss
          </Button>
        )}
      </header>
      <ul className="px-3 py-2 text-[12.5px]">
        {rows.map((r) => (
          <li key={r.enquiry_id} className="flex flex-wrap items-center gap-2 py-0.5">
            <StudentLink
              mobile={r.mobile}
              className="text-ink underline-offset-2 hover:underline"
            >
              {r.student_name || "No name"}
            </StudentLink>
            <span className="tabular-nums text-ink-3">{formatMobile(r.mobile)}</span>
            <span className="text-danger">due {formatDate(r.next_follow_up_date)}</span>
            <span className="text-ink-3">{r.assigned_to_name ?? "unassigned"}</span>
          </li>
        ))}
      </ul>
      {result?.error ? (
        <div className="px-3 pb-2">
          <ErrorNote>{result.error}</ErrorNote>
        </div>
      ) : null}
    </section>
  );
}
