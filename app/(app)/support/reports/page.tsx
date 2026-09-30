import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Button, Input, PageHeader, Select, cx } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { loadMasters } from "@/lib/masters";
import { formatMobile } from "@/lib/mobile";
import { showsSupportReports } from "@/lib/roles";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import {
  AGE_BAND_LABELS,
  DUE_LABELS,
  ESCALATION_KIND_LABELS,
  OPEN_STATUSES,
  STATUS_LABELS,
} from "../filters";

export const metadata = { title: "Support reports · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

/**
 * §61.3. The Support reports.
 *
 * Its own route and its own SQL, sharing nothing with the counselling reports:
 * those read public.enquiries and carry the follow-up-slot rules, and importing
 * any of that would tie these numbers to a pipeline support has no part in.
 *
 * Every figure is clickable where a figure can be: a count that cannot be opened
 * is a number you have to trust, and the whole point of a report on a working
 * queue is to get from "thirty are overdue" to the thirty.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireUser();
  // §62.1. Narrower than the queue: the whole team works tickets, only
  // managers and super admins read the numbers about the team.
  if (!viewer.profile || !showsSupportReports(viewer.profile.role)) notFound();

  const sp = await searchParams;

  // Default: this month, in IST. A report that silently means "UTC month" would
  // be wrong for five and a half hours of every day.
  const todayIst = istToday();
  const monthStart = `${todayIst.slice(0, 7)}-01`;
  const from = one(sp.from) || monthStart;
  const to = one(sp.to) || todayIst;
  const instituteId = one(sp.institute);
  const teacherId = one(sp.teacher);
  const assignedTo = one(sp.assignedTo);

  const args = {
    p_from: from || null,
    p_to: to || null,
    p_institute_id: instituteId || null,
    p_teacher_id: teacherId || null,
    p_assigned_to: assignedTo ? [assignedTo] : null,
  };

  const supabase = await createClient();
  const db = supabase.schema("support");
  const masters = await loadMasters();

  const [staff, status, ageing, byInstitute, byIssue, perPerson, ttr, byDue, daily, instEsc] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.rpc("report_open_by_status", args as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.rpc("report_ageing", args as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.rpc("report_open_by_institute", args as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.rpc("report_open_by_issue", args as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.rpc("report_resolved_per_person", args as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.rpc("report_time_to_resolve", args as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.rpc("report_open_by_due", args as any),
      db.rpc("report_daily", {
        p_from: from || null,
        p_to: to || null,
        p_institute_id: args.p_institute_id,
        p_teacher_id: args.p_teacher_id,
        p_assigned_to: args.p_assigned_to,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      db.rpc("report_institute_escalations", {
        p_institute_id: args.p_institute_id,
        p_teacher_id: args.p_teacher_id,
        p_assigned_to: args.p_assigned_to,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ]);

  const statusRows = (status.data ?? []) as unknown as { bucket: string; n: number }[];
  const ageingRows = (ageing.data ?? []) as unknown as { bucket: string; n: number }[];
  const instituteRows = (byInstitute.data ?? []) as unknown as {
    institute_id: string | null;
    institute_name: string;
    n: number;
  }[];
  const issueRows = (byIssue.data ?? []) as unknown as { issue: string; n: number }[];
  const personRows = (perPerson.data ?? []) as unknown as {
    person_id: string | null;
    person_name: string;
    day: string;
    n: number;
  }[];
  const ttrRows = (ttr.data ?? []) as unknown as {
    scope: string;
    institute_id: string | null;
    institute_name: string | null;
    tickets: number;
    avg_days: number | null;
    median_days: number | null;
    min_days: number | null;
    max_days: number | null;
  }[];
  const dueRows = (byDue.data ?? []) as unknown as { bucket: string; n: number }[];
  const dailyRows = (daily.data ?? []) as unknown as {
    day: string;
    raised: number;
    resolved: number;
    escalated_team: number;
    escalated_institute: number;
    set_future: number;
    /** §77.2. Moved to our courier that day. Not an escalation. */
    to_courier: number;
    /** §65.3. A counsellor gave the ticket back to the team. Not an escalation. */
    handed_over: number;
    open_at_eod: number;
  }[];
  const escRows = (instEsc.data ?? []) as unknown as {
    id: number;
    institute_name: string | null;
    student_name: string | null;
    mobile: string | null;
    order_id: string | null;
    raised_at: string;
    age_days: number;
    follow_up_date: string | null;
    overdue: boolean;
    assigned_to_name: string | null;
  }[];

  /**
   * "All open tickets", as query params.
   *
   * tab=all plus an explicit status list, rather than tab=open: the six tabs are
   * a fixed set and an unrecognised value falls back to New, which made these
   * links quietly show fewer tickets than the card beside them claimed.
   */
  const OPEN_SCOPE = { tab: "all", status: [...OPEN_STATUSES].join(",") };

  /** A queue link carrying this report's own scope, so the two agree. */
  const queueLink = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (from) p.set("raisedFrom", from);
    if (to) p.set("raisedTo", to);
    if (instituteId) p.set("institute", instituteId);
    if (teacherId) p.set("teacher", teacherId);
    if (assignedTo) p.set("assignedTo", assignedTo);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return `/support?${p.toString()}`;
  };

  const days = [...new Set(personRows.map((r) => r.day))].sort();
  const people = [...new Map(personRows.map((r) => [r.person_name, r.person_id])).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]));
  const cell = (person: string, day: string) =>
    personRows.find((r) => r.person_name === person && r.day === day)?.n ?? 0;

  const overall = ttrRows.find((r) => r.scope === "overall");
  const perInstitute = ttrRows.filter((r) => r.scope === "institute");

  const errors = [status, ageing, byInstitute, byIssue, perPerson, ttr, byDue, daily, instEsc]
    .map((r) => r.error?.message)
    .filter(Boolean);

  logServerTiming("/support/reports");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Support reports"
        description="Open work, ageing, and what was resolved. Raised dates are the form's own, in IST calendar days."
      />

      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-end gap-2 p-2.5">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Raised between
            </span>
            <div className="flex items-center gap-1.5">
              <Input type="date" name="from" defaultValue={from} aria-label="From" />
              <span className="text-[12px] text-ink-3">→</span>
              <Input type="date" name="to" defaultValue={to} aria-label="To" />
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Institute
            </span>
            <Select name="institute" defaultValue={instituteId} aria-label="Institute filter">
              <option value="">All</option>
              {masters.institutes.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Teacher
            </span>
            <Select name="teacher" defaultValue={teacherId} aria-label="Teacher filter">
              <option value="">All</option>
              {masters.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Assigned to
            </span>
            <Select name="assignedTo" defaultValue={assignedTo} aria-label="Assigned filter">
              <option value="">Anyone</option>
              <option value="nobody">Nobody</option>
              {(staff.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ?? "(no name)"}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" size="sm" variant="primary">
            Apply
          </Button>
          <Link
            href="/support/reports"
            prefetch={false}
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            This month
          </Link>
        </div>
      </form>

      {errors.length ? (
        <p className="text-[12px] text-danger" role="status">
          {errors.join(" · ")}
        </p>
      ) : null}

      {/* 1. Open by status */}
      <Section title="Open tickets by status" hint="Everything not resolved, in scope.">
        <div className="flex flex-wrap gap-2" data-testid="by-status">
          {[
            "new",
            "working",
            "counsellor",
            "escalated_team",
            "escalated_institute",
            // §77.2. Its own card, between the handovers and the parked ones.
            "courier",
            "future",
          ].map((b) => {
            const n = statusRows.find((r) => r.bucket === b)?.n ?? 0;
            const href =
              b === "escalated_team"
                ? queueLink({ tab: "escalated", kind: "team" })
                : b === "escalated_institute"
                  ? queueLink({ tab: "escalated", kind: "institute" })
                  // §64.2. Its own tab, so the card opens exactly that list.
                  : queueLink({ tab: b });
            return (
              <Link
                key={b}
                href={href}
                prefetch={false}
                data-testid={`status-${b}`}
                className="flex min-w-[130px] flex-col rounded-md border border-line-2 bg-surface-2 px-3 py-2 hover:border-accent"
              >
                <span className="text-[11px] text-ink-3">{statusLabel(b)}</span>
                <span className="text-[18px] font-semibold tabular-nums text-ink">{n}</span>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* 2. Open by institute / by issue */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Section
          title="Open by institute"
          hint="Busiest first. Tickets with more than one institute are counted under each."
        >
          <Table
            head={["Institute", "Open"]}
            rows={instituteRows.map((r) => [
              r.institute_id ? (
                <Link
                  key="i"
                  href={queueLink({ ...OPEN_SCOPE, institute: r.institute_id })}
                  prefetch={false}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {r.institute_name}
                </Link>
              ) : (
                <span key="i" className="text-warn">
                  {r.institute_name}
                </span>
              ),
              <span key="n" className="tabular-nums">
                {r.n}
              </span>,
            ])}
            empty="Nothing open in scope."
          />
        </Section>

        <Section title="Open by issue" hint="A ticket with two issues counts in both.">
          <Table
            head={["Issue", "Open"]}
            rows={issueRows.map((r) => [
              r.issue === "Other (free text)" ? (
                <span key="i" className="text-ink-2">
                  {r.issue}
                </span>
              ) : (
                <Link
                  key="i"
                  href={queueLink({ ...OPEN_SCOPE, issue: r.issue })}
                  prefetch={false}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {r.issue}
                </Link>
              ),
              <span key="n" className="tabular-nums">
                {r.n}
              </span>,
            ])}
            empty="Nothing open in scope."
          />
        </Section>
      </div>

      {/* 3. Ageing */}
      <Section
        title="Ageing of open tickets"
        hint="Calendar days since the form was submitted. The four bands are exclusive and sum to the open total; “over 3 days” is the roll-up beside them, so it deliberately overlaps."
      >
        <div className="flex flex-wrap gap-2" data-testid="ageing">
          {[
            { id: "0-3", tone: "ok" as const },
            { id: "4-5", tone: "warn" as const },
            { id: "6-10", tone: "warn" as const },
            { id: "over-10", tone: "danger" as const },
            { id: "over-3", tone: "danger" as const, rollUp: true },
          ].map((b) => {
            const n = ageingRows.find((r) => r.bucket === b.id)?.n ?? 0;
            return (
              <Link
                key={b.id}
                href={queueLink({ ...OPEN_SCOPE, age: b.id })}
                prefetch={false}
                data-testid={`ageing-${b.id}`}
                className={cx(
                  "flex min-w-[118px] flex-col rounded-md border px-3 py-2 hover:border-accent",
                  b.rollUp
                    ? "border-dashed border-line-2 bg-surface"
                    : "border-line-2 bg-surface-2",
                )}
              >
                <span className="text-[11px] text-ink-3">{AGE_BAND_LABELS[b.id]}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[18px] font-semibold tabular-nums text-ink">{n}</span>
                  {n > 0 && b.tone !== "ok" ? <Badge tone={b.tone}>&nbsp;</Badge> : null}
                </span>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* §63.2. When the open work is next due. */}
      <Section title="Open by follow-up date" hint="As on today.">
        <div className="flex flex-wrap gap-2" data-testid="by-due">
          {["overdue", "today", "future", "none"].map((b) => {
            const n = dueRows.find((r) => r.bucket === b)?.n ?? 0;
            return (
              <Link
                key={b}
                href={queueLink({ ...OPEN_SCOPE, due: b })}
                prefetch={false}
                data-testid={`due-${b}`}
                className="flex min-w-[118px] flex-col rounded-md border border-line-2 bg-surface-2 px-3 py-2 hover:border-accent"
              >
                <span className="text-[11px] text-ink-3">{DUE_LABELS[b]}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[18px] font-semibold tabular-nums text-ink">{n}</span>
                  {n > 0 && b === "overdue" ? <Badge tone="danger">&nbsp;</Badge> : null}
                </span>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* §63.2. One row per day in the range. */}
      <Section
        title="Per day"
        hint="Counted from the ticket history by the day each thing happened, so a ticket escalated twice in a day counts once. “Open at end of day” is a position: raised on or before that day and neither resolved nor merged by the end of it."
      >
        <div className="overflow-x-auto">
          <table data-testid="per-day" className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                <th className="px-1.5 py-[7px]">Day</th>
                <th className="px-1.5 py-[7px] text-right">Raised</th>
                <th className="px-1.5 py-[7px] text-right">Resolved</th>
                <th className="px-1.5 py-[7px] text-right">Esc · team</th>
                <th className="px-1.5 py-[7px] text-right">Esc · institute</th>
                <th className="px-1.5 py-[7px] text-right">Future date</th>
                {/* §77.2. Beside the escalations, counted apart from them. */}
                <th className="px-1.5 py-[7px] text-right">To courier</th>
                {/* §65.3. Beside the escalations and counted apart from them. */}
                <th className="px-1.5 py-[7px] text-right">Handed over</th>
                <th className="px-1.5 py-[7px] text-right">Open at EOD</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.map((r) => (
                <tr key={r.day} className="border-b border-line last:border-b-0">
                  <td className="whitespace-nowrap px-1.5 py-[5px] text-ink-2">
                    {formatDate(r.day)}
                  </td>
                  {[
                    r.raised,
                    r.resolved,
                    r.escalated_team,
                    r.escalated_institute,
                    r.set_future,
                    r.to_courier,
                    r.handed_over,
                  ].map(
                    (n, i) => (
                      <td
                        key={i}
                        className={cx(
                          "px-1.5 py-[5px] text-right tabular-nums",
                          n ? "text-ink-2" : "text-ink-3",
                        )}
                      >
                        {n || "—"}
                      </td>
                    ),
                  )}
                  <td className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                    {r.open_at_eod}
                  </td>
                </tr>
              ))}
              {dailyRows.length ? (
                <tr className="bg-sunk">
                  <td className="px-1.5 py-[5px] text-[11px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                    Total
                  </td>
                  {([
                    "raised",
                    "resolved",
                    "escalated_team",
                    "escalated_institute",
                    "set_future",
                    "to_courier",
                    "handed_over",
                  ] as const).map(
                    (k) => (
                      <td key={k} className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                        {dailyRows.reduce((sum, r) => sum + r[k], 0)}
                      </td>
                    ),
                  )}
                  {/* No total: a running position does not add up across days. */}
                  <td className="px-1.5 py-[5px] text-right text-[11px] text-ink-3">—</td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={9} className="px-3 py-5 text-center text-ink-3">
                    Nothing in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 4. Resolved per person per day */}
      <Section
        title="Resolved per person per day"
        hint="Who saved the Resolved action, by the day they saved it."
      >
        {days.length ? (
          <div className="overflow-x-auto">
            <table
              data-testid="per-person"
              className="w-full border-collapse text-[12.5px]"
            >
              <thead>
                <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                  <th className="px-1.5 py-[7px]">Person</th>
                  {days.map((d) => (
                    <th key={d} className="px-1.5 py-[7px] text-right">
                      {formatDate(d)}
                    </th>
                  ))}
                  <th className="px-1.5 py-[7px] text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {people.map(([name]) => {
                  const total = days.reduce((sum, d) => sum + cell(name, d), 0);
                  return (
                    <tr key={name} className="border-b border-line last:border-b-0">
                      <td className="px-1.5 py-[5px] text-ink">{name}</td>
                      {days.map((d) => (
                        <td
                          key={d}
                          className={cx(
                            "px-1.5 py-[5px] text-right tabular-nums",
                            cell(name, d) ? "text-ink-2" : "text-ink-3",
                          )}
                        >
                          {cell(name, d) || "—"}
                        </td>
                      ))}
                      <td className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                        {total}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-sunk">
                  <td className="px-1.5 py-[5px] text-[11px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                    All
                  </td>
                  {days.map((d) => (
                    <td key={d} className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                      {personRows.filter((r) => r.day === d).reduce((s, r) => s + r.n, 0)}
                    </td>
                  ))}
                  <td className="px-1.5 py-[5px] text-right font-semibold tabular-nums text-ink">
                    {personRows.reduce((s, r) => s + r.n, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-3">Nothing resolved in this range.</p>
        )}
      </Section>

      {/* 5. Time to resolve */}
      <Section
        title="Average days to resolve"
        hint="Raised to resolved, for tickets resolved in this range. The count is beside every average because an average of one is not a measurement. Tickets with more than one institute are counted under each."
      >
        {overall ? (
          <>
            <div className="mb-2 flex flex-wrap gap-2" data-testid="ttr-overall">
              <Fact label="Tickets resolved" value={String(overall.tickets)} />
              <Fact label="Average days" value={fmt(overall.avg_days)} />
              <Fact label="Median days" value={fmt(overall.median_days)} />
              <Fact
                label="Fastest / slowest"
                value={`${overall.min_days ?? "—"} / ${overall.max_days ?? "—"}`}
              />
            </div>
            <Table
              head={["Institute", "Resolved", "Avg days", "Median", "Slowest"]}
              rows={perInstitute.map((r) => [
                <span key="i" className={r.institute_id ? "text-ink-2" : "text-warn"}>
                  {r.institute_name}
                </span>,
                <span key="n" className="tabular-nums">
                  {r.tickets}
                </span>,
                <span key="a" className="tabular-nums">
                  {fmt(r.avg_days)}
                </span>,
                <span key="m" className="tabular-nums">
                  {fmt(r.median_days)}
                </span>,
                <span key="x" className="tabular-nums">
                  {r.max_days ?? "—"}
                </span>,
              ])}
              empty="No resolved tickets in this range."
            />
          </>
        ) : (
          <p className="text-[12.5px] text-ink-3">No resolved tickets in this range.</p>
        )}
      </Section>

      {/* 6. Sitting with an institute */}
      <Section
        title="Escalated to Institute, still open"
        hint="Oldest first, and deliberately not limited to the date range — an escalation outstanding since before the window is the one worth chasing."
      >
        <Table
          testId="institute-escalations"
          head={["Ticket", "Institute", "Student", "Raised", "Age", "Follow-up", "Assigned"]}
          rows={escRows.map((r) => [
            <Link
              key="t"
              href={`/support/${r.id}`}
              prefetch={false}
              className="tabular-nums text-accent underline-offset-2 hover:underline"
            >
              #{r.id}
            </Link>,
            <span key="i" className="text-ink-2">
              {r.institute_name ?? "—"}
            </span>,
            <span key="s" className="text-ink-2">
              {r.student_name ?? "No name"}
              {r.mobile ? (
                <span className="ml-1.5 tabular-nums text-ink-3">{formatMobile(r.mobile)}</span>
              ) : null}
            </span>,
            <span key="r" className="whitespace-nowrap text-ink-3">
              {formatDate(r.raised_at)}
            </span>,
            <span key="a" className="tabular-nums">
              {r.age_days > 3 ? <Badge tone="danger">{r.age_days}d</Badge> : `${r.age_days}d`}
            </span>,
            <span key="f" className={cx("whitespace-nowrap tabular-nums", r.overdue && "text-danger")}>
              {r.follow_up_date ? formatDate(r.follow_up_date) : "—"}
            </span>,
            <span key="g" className="text-ink-2">
              {r.assigned_to_name ?? "nobody"}
            </span>,
          ])}
          empty="Nothing is sitting with an institute."
        />
      </Section>
    </div>
  );
}

function statusLabel(bucket: string): string {
  if (bucket === "escalated_team") return `Escalated · ${ESCALATION_KIND_LABELS.team}`;
  if (bucket === "escalated_institute") return `Escalated · ${ESCALATION_KIND_LABELS.institute}`;
  return STATUS_LABELS[bucket] ?? bucket;
}

const fmt = (v: number | null) => (v === null || v === undefined ? "—" : String(v));

/** Today, as an IST calendar date. */
function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-3 shadow-card">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {hint ? <p className="mb-2 text-[11.5px] text-ink-3">{hint}</p> : null}
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[120px] flex-col rounded-md border border-line-2 bg-surface-2 px-3 py-2">
      <span className="text-[11px] text-ink-3">{label}</span>
      <span className="text-[18px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
  testId,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
  testId?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table data-testid={testId} className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            {head.map((h, i) => (
              <th key={h} className={cx("px-1.5 py-[7px]", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-b border-line last:border-b-0">
              {cells.map((c, i) => (
                <td key={i} className={cx("px-1.5 py-[5px]", i > 0 && "text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-5 text-center text-ink-3">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
