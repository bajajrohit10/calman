import "server-only";

import type {
  AssignmentBucket,
  CallOutcome,
  EnquiryStatus,
  EnquiryType,
  Importance,
  IssueCategory,
} from "@/lib/enquiry-labels";
import { istDateOf, istToday } from "@/lib/format";
import {
  matchesSubTab,
  MY_DAY_TABS,
  type MyDaySubTab,
  type MyDayTabKey,
  type MyDayView,
} from "@/lib/my-day-tabs";
import { fetchAllRows } from "@/lib/paged";
import { timed } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

/**
 * One counsellor's day (§6), as the tabs render it.
 *
 * Two sources, because the day has two kinds of work in it and they are not
 * the same shape. The four bucket tabs come from my_day(), which is keyed on
 * today's assignments so a row keeps its place after the enquiry closes. The
 * Tickets tab comes from tickets_list() — the same function the Tickets screen
 * reads — because an after-sale ticket is never assigned to a day at all: it
 * is open until somebody resolves it.
 */

export type MyDayRow = {
  enquiry_id: number;
  bucket: AssignmentBucket;
  bucket_rank: number;
  student_id: string;
  mobile: string;
  student_name: string | null;
  type: EnquiryType;
  status: EnquiryStatus;
  importance: Importance | null;
  term_name: string | null;
  product_text: string | null;
  next_follow_up_date: string | null;
  is_overdue: boolean;
  follow_up_slots_used: number;
  top_content_priority: number | null;
  teacher_names: string[] | null;
  item_count: number;
  called_today: boolean;
  last_call_at: string | null;
  last_outcome: CallOutcome | null;
  /** The number arrived again on the day being viewed (§10.1). */
  re_enquired_today: boolean;
  /** What a campaign assignment was handed out as (§19.2). */
  assignment_label: string | null;
  /** Brief 18: which offers put this on the list, for the Offer Calls tab. */
  offer_names: string[] | null;
  offer_ids: string[] | null;
  /** Brief 23: an offer lead may be lost; the Offer tab filters on which. */
  lost_reason: string | null;
  /**
   * The §4.3 slot count as it stood at the start of the viewed day (§24.1).
   * The slot sub-tabs group on this rather than on follow_up_slots_used, so a
   * lead stays on the rung the counsellor is working when they call it —
   * follow_up_slots_used is where the lead is *now* and moves under them.
   */
  slots_at_open: number;
  /**
   * Where this uncalled assignment was carried to (§30.6), or null. The day it
   * was assigned to keeps the row — Tuesday really did have this work on it —
   * and this says the work has moved on, so it stops counting as not called.
   */
  carried_to: string | null;
};

/** A ticket, plus the one thing the Tickets screen does not need to know. */
export type MyDayTicket = {
  enquiry_id: number;
  mobile: string;
  student_name: string | null;
  status: EnquiryStatus;
  reminder_date: string | null;
  created_at: string;
  last_call_at: string | null;
  last_outcome: CallOutcome | null;
  last_discussion: string | null;
  issue_category: IssueCategory | null;
  last_caller_name: string | null;
  last_caller_id: string | null;
  created_by: string | null;
  /** §33.4: the reminder has passed and nobody has closed it. */
  is_overdue: boolean;
  /** The day it was resolved, for the Resolved tab. */
  resolved_on: string | null;
  /** An after-sale call logged today. `calls` rows here are after-sale only. */
  called_today: boolean;
  /** §44.1/§44.4: what the ticket carries, drawn by the shared table. */
  order_id: string | null;
  teacher_name: string | null;
  institute_name: string | null;
  escalated_to: string | null;
  escalated_to_name: string | null;
  open_days: number | null;
};

/** One offer sub-tab: the offer, and what it is aimed at (§24.2). */
export type OfferTab = { id: string; name: string; label: string | null };

export type MyDayData = {
  rows: MyDayRow[];
  tickets: MyDayTicket[];
  /** The offers behind today's offer rows, named for their sub-tabs. */
  offerTabs: OfferTab[];
  error: string | null;
};

const TICKET_LIMIT = 500;

export async function loadMyDay(input: {
  date: string;
  counsellorId: string;
}): Promise<MyDayData> {
  const supabase = await createClient();
  const today = istToday();

  const [day, tickets, resolved] = await timed("list", () => Promise.all([
    // Paged even though a day is rarely more than a hundred rows: PostgREST
    // caps an RPC at max_rows without saying so, and a campaign day is exactly
    // the day somebody would notice the list stopping at 1,000.
    fetchAllRows<MyDayRow>((from, to) =>
      supabase
        .rpc("my_day", {
          p_date: input.date,
          p_counsellor_id: input.counsellorId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .range(from, to) as never,
    ),
    // §33.3. Two questions, because they are two different questions: every
    // unresolved ticket regardless of the date, and the ones resolved on the
    // day being looked at. The first is not date-bound on purpose — a ticket
    // raised last Tuesday is still somebody's problem today.
    supabase.rpc("tickets_list", {
      p_include_resolved: false,
      p_sort: "reminder",
      p_dir: "asc",
      p_as_of: input.date,
      p_limit: TICKET_LIMIT,
      p_offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    supabase.rpc("tickets_list", {
      p_resolved_on: input.date,
      p_sort: "reminder",
      p_dir: "asc",
      p_as_of: input.date,
      p_limit: TICKET_LIMIT,
      p_offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  ]));

  type RawTicket = {
    enquiry_id: number;
    mobile: string;
    student_name: string | null;
    status: EnquiryStatus;
    reminder_date: string | null;
    created_at: string;
    last_call_at: string | null;
    last_outcome: CallOutcome | null;
    last_discussion: string | null;
    issue_category: IssueCategory | null;
    last_caller_name: string | null;
    last_caller_id: string | null;
    created_by: string | null;
    is_overdue: boolean;
    resolved_on: string | null;
    order_id: string | null;
    teacher_name: string | null;
    institute_name: string | null;
    escalated_to: string | null;
    escalated_to_name: string | null;
    open_days: number | null;
  };
  const ticketRows = [
    ...((tickets.data ?? []) as unknown as RawTicket[]),
    ...((resolved.data ?? []) as unknown as RawTicket[]),
  ];

  // The offers actually on this day, named. Asked only when there are offer
  // rows, so an ordinary day pays nothing for a feature it is not using.
  const offerIds = [...new Set(day.rows.flatMap((r) => r.offer_ids ?? []))];
  const offerTabs = offerIds.length
    ? await (async () => {
        const { data } = await supabase.rpc("offer_tab_labels", {
          p_ids: offerIds,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        return ((data ?? []) as unknown as {
          offer_id: string;
          name: string;
          target_label: string | null;
        }[]).map((o) => ({ id: o.offer_id, name: o.name, label: o.target_label }));
      })()
    : [];

  return {
    rows: day.rows,
    offerTabs,
    // "Done" for a ticket means it was called today, so it is the viewed day
    // that decides — and on any day but today, nothing counts as done, which
    // is the honest answer: tickets_list only carries the *latest* call.
    tickets: ticketRows.map((t) => ({
      ...t,
      called_today:
        input.date === today && istDateOf(t.last_call_at) === today,
    })),
    error: day.error ?? tickets.error?.message ?? resolved.error?.message ?? null,
  };
}

/**
 * The enquiry ids behind one tab and toggle, for the export.
 *
 * Two things were wrong with reading recommended_calls() here. It is the
 * open-only list, so the moment My Day started counting closed rows in its
 * totals "export my day" would have quietly left them out — the Done rows,
 * which are the ones worth exporting. And it knows nothing about the tabs, so
 * every export was the whole day whatever the counsellor was looking at,
 * against this project's one rule for Export: what you see is what you get.
 *
 * The caller names the view; the rows are still built here, so a tampered
 * request can ask for a different tab but never for somebody else's day.
 */
export async function loadMyDayIds(input: {
  date: string;
  counsellorId: string;
  tab: MyDayTabKey;
  view: MyDayView;
  /** §24: the export is of the sub-tab on screen, not of the whole tab. */
  subTab?: MyDaySubTab;
}): Promise<{ ids: number[]; error: string | null }> {
  const { rows, tickets, error } = await loadMyDay({
    date: input.date,
    counsellorId: input.counsellorId,
  });
  if (error) return { ids: [], error };

  const done = input.view === "done";
  const sub = input.subTab ?? { kind: "all" as const };

  if (input.tab === "tickets") {
    return {
      ids: tickets.filter((t) => t.called_today === done).map((t) => t.enquiry_id),
      error: null,
    };
  }

  const buckets = MY_DAY_TABS.find((t) => t.key === input.tab)?.buckets ?? [];
  return {
    ids: rows
      .filter(
        (r) =>
          buckets.includes(r.bucket) &&
          r.called_today === done &&
          matchesSubTab(r, sub),
      )
      .map((r) => r.enquiry_id),
    error: null,
  };
}
