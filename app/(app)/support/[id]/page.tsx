import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { showsSupport } from "@/lib/roles";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import { TicketView, type TicketDetail, type TicketEvent } from "./ticket-view";

export const metadata = { title: "Ticket · Calman" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireUser();
  if (!viewer.profile || !showsSupport(viewer.profile.role)) notFound();

  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId < 1) notFound();

  const supabase = await createClient();
  const db = supabase.schema("support");

  const { data: ticket } = await db
    .from("tickets")
    .select(
      `id, created_at, source, raised_at, student_name, mobile_raw, mobile,
       order_id_raw, order_id, issues_raw, issues, issue_other, description,
       faculty_raw, attachment_urls, form_row_ref,
       order_id_work, institute_id, teacher_id, issues_work, issue_other_work,
       status, follow_up_date, escalated_to, escalation_kind, resolved_at, resolved_by,
       parent_ticket_id, merged_at, assigned_to, last_touched_at,
       counselling_enquiry_id`,
    )
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) notFound();

  const masters = await loadMasters();

  // §63.1. The live duplicate suggestion, in either direction. Loaded here so the
  // dialog can quote the other ticket's issues without a round trip on click.
  const { data: candidate } = await db
    .rpc("duplicate_candidate_of", {
      p_ticket_id: ticketId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .maybeSingle();

  // The timeline includes the children's events: a merged duplicate is the same
  // complaint, and its history belongs on the thread the team actually reads.
  const { data: children } = await db
    .from("tickets")
    .select("id, student_name, mobile, order_id_work, order_id, raised_at, source")
    .eq("parent_ticket_id", ticketId)
    .order("id");

  const timelineIds = [ticketId, ...(children ?? []).map((c) => c.id)];
  const [{ data: events }, { data: staff }] = await Promise.all([
    db
      .from("events")
      .select("id, ticket_id, at, actor_id, kind, detail")
      .in("ticket_id", timelineIds)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const people = new Map((staff ?? []).map((p) => [p.id, p.full_name ?? "(no name)"]));

  logServerTiming(`/support/${ticketId}`);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Ticket #${ticket.id}`}
        description="What the student submitted, what the team changed, and everything done since."
      />
      {/* §62.2. The counselling side raised this and sent the counsellor here;
          the message could not be shown from there because the navigation
          unmounts that panel. */}
      {one(sp.raised) === "1" ? (
        <p
          data-testid="raised-banner"
          role="status"
          className="rounded-md border border-ok/50 bg-ok-soft/40 px-3 py-2 text-[12.5px] text-ink"
        >
          Support ticket #{ticket.id} created.
          {one(sp.existing)
            ? ` This number already had open ticket #${one(sp.existing)} — they have not been merged.`
            : ""}
        </p>
      ) : null}

      <TicketView
        ticket={ticket as unknown as TicketDetail}
        events={(events ?? []) as unknown as TicketEvent[]}
        duplicates={(children ?? []).map((c) => ({
          id: c.id,
          studentName: c.student_name,
          mobile: c.mobile,
          orderId: c.order_id_work ?? c.order_id,
          raisedAt: c.raised_at,
          source: c.source,
        }))}
        people={Object.fromEntries(people)}
        staff={(staff ?? []).map((p) => ({ id: p.id, name: p.full_name ?? "(no name)" }))}
        masters={{ institutes: masters.institutes, teachers: masters.teachers }}
        duplicate={
          candidate
            ? (candidate as unknown as {
                other_ticket_id: number;
                other_issues: string[] | null;
                other_issue_other: string | null;
                child_id: number;
                parent_id: number;
                same_issue: boolean;
              })
            : null
        }
      />
    </div>
  );
}
