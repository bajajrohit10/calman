import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import { dayAfter, istDatePlus, istToday } from "@/lib/format";
import { loadMasters } from "@/lib/masters";
import { logServerTiming } from "@/lib/server-timing";
import { loadMyDay } from "@/lib/my-day";
import { loadEscalatees } from "@/lib/escalatees";
import { TICKET_OWNER_MINE } from "@/lib/ticket-tabs";
import { loadOfferCallBadges } from "@/lib/offer-badges";
import { loadTeamDay } from "@/lib/my-day-team";
import { parseTicketTab } from "@/lib/ticket-tabs";
import {
  ALL_COUNSELLORS,
  ALL_COUNSELLORS_LABEL,
  parseMyDayTab,
  parseSubTab,
} from "@/lib/my-day-tabs";
import { loadRecommended } from "@/lib/recommended";
import { createClient } from "@/lib/supabase/server";

import { MyDay } from "./my-day";
import { TeamDayGrid } from "./team";

export const metadata = { title: "My Day · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const admin = isAdmin(viewer.profile?.role ?? "counsellor");

  const date = one(sp.date) ?? istToday();
  // A counsellor only ever sees their own day; the picker is ignored for them
  // here as well as hidden in the UI, because a query string is not a
  // permission.
  const wanted = one(sp.counsellor);
  // §30.4. "All counsellors" is a different screen, not a different filter:
  // the team grid counts everybody's day and has nothing to show a counsellor
  // about their own, so it is admin-only in the same breath as the picker.
  const team = admin && wanted === ALL_COUNSELLORS;
  const counsellorId = admin ? (wanted && !team ? wanted : viewer.userId!) : viewer.userId!;

  const supabase = await createClient();

  if (team) {
    const [teamDay, roster, nextWorkingDay] = await Promise.all([
      loadTeamDay(date),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .neq("role", "ticket_team")
        .order("full_name"),
      // §30.6's default target: the next working day *after* the day being
      // looked at. next_working_day(d) answers "d, or the next working day
      // after it", so carrying forward from a Tuesday has to ask from
      // Wednesday or the answer is Tuesday again.
      supabase.rpc("next_working_day", {
        p_from: dayAfter(date),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ]);

    logServerTiming("/my-day");
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="My Day"
          description="Every counsellor's day at once — what is left, and who could take it."
        />
        <TeamHeader date={date} roster={roster.data ?? []} />
        <TeamDayGrid
          initial={teamDay}
          date={date}
          roster={(roster.data ?? []).map((p) => ({
            id: p.id,
            name: p.full_name ?? "(no name)",
          }))}
          nextWorkingDay={(nextWorkingDay.data as string | null) ?? null}
        />
      </div>
    );
  }

  const masters = await loadMasters();

  const [day, roster, dismissal, nextWorkingDay] = await Promise.all([
    loadMyDay({ date, counsellorId }),
    admin
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("is_active", true)
          .neq("role", "ticket_team")
          .order("full_name")
      : Promise.resolve({ data: null }),
    admin
      ? supabase.from("overdue_dismissals").select("date").eq("date", date).maybeSingle()
      : Promise.resolve({ data: null }),
    // §30.6's default: the next day work happens on, after this one.
    supabase.rpc("next_working_day", {
      p_from: dayAfter(date),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  ]);

  // §5.8 overdue report: open follow-ups whose date has passed, uncalled since.
  const overdue = admin
    ? await loadRecommended({
        date,
        includeNotDue: true,
        followUpTo: istDatePlus(-1),
        limit: 500,
      })
    : { rows: [], total: 0, error: null };


  // §42.4. The day's rows, asked once. A counsellor's day is tens of leads,
  // so this is one round trip whose answer is pure decoration — if it fails
  // the rows are still right, they simply say less.
  // §46.1, as on the desk: no offer running, no badge to draw, no round trip.
  const offerCalls = day.offerTabs.length
    ? await loadOfferCallBadges(day.rows.map((r) => r.enquiry_id))
    : {};
  // §45.3. Not the admin-only roster above: the escalate-to picker is on every
  // counsellor's ticket rows, and for them that list was empty.
  const escalatees = await loadEscalatees();

  // One line per render, so the phase breakdown is in the server log.
  logServerTiming("/my-day");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My Day"
        description="Today's assigned calls, in the order the spec recommends working them."
      />
      <MyDay
        initial={day}
        date={date}
        initialTab={parseMyDayTab(one(sp.tab))}
        initialView={one(sp.view) === "done" ? "done" : "pending"}
        initialSubTab={parseSubTab(one(sp.sub))}
        initialTicketTab={parseTicketTab(one(sp.ticket))}
        // §45.2: "Pending with me" is the default — what a counsellor opens
        // this tab to find out.
        initialTicketOwner={one(sp.owner) ?? TICKET_OWNER_MINE}
        nextWorkingDay={(nextWorkingDay.data as string | null) ?? null}
        viewerId={viewer.userId ?? null}
        isAdmin={admin}
        counsellorName={viewer.profile?.full_name ?? null}
        counsellorId={counsellorId}
        roster={(roster.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
        overdue={overdue.rows.filter((r) => r.is_overdue)}
        overdueDismissed={Boolean(dismissal.data)}
        escalatees={escalatees}
        offerCalls={offerCalls}
        masters={{
          teachers: masters.teachers,
          courses: masters.courses,
          subjects: masters.subjects,
          contents: masters.contents,
          terms: masters.terms,
          sources: masters.sources,
        }}
      />
    </div>
  );
}

/**
 * The date and counsellor picker, for the team grid.
 *
 * A copy of My Day's own bar rather than a shared component: this one has no
 * tabs behind it, and the two will diverge further the moment either grows a
 * filter. Both offer ALL_COUNSELLORS, so either can navigate to the other —
 * the constant is shared even though the markup is not, because it is the one
 * thing that has to match.
 */
function TeamHeader({
  date,
  roster,
}: {
  date: string;
  roster: { id: string; full_name: string | null }[];
}) {
  return (
    <form
      method="GET"
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface px-2.5 py-2.5 shadow-card"
    >
      <label className="flex flex-col gap-[3px]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
          Date
        </span>
        <input
          type="date"
          name="date"
          defaultValue={date}
          className="h-[30px] w-[150px] rounded-md border border-line-2 bg-surface px-2 text-[12.5px] text-ink"
        />
      </label>
      <label className="flex flex-col gap-[3px]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
          Counsellor
        </span>
        <select
          name="counsellor"
          defaultValue="all"
          className="h-[30px] w-[190px] rounded-md border border-line-2 bg-surface px-2 text-[12.5px] text-ink"
        >
          <option value={ALL_COUNSELLORS}>{ALL_COUNSELLORS_LABEL}</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name ?? "(no name)"}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink"
      >
        Show
      </button>
    </form>
  );
}
