import Link from "next/link";

import { EnquiryDetailsEditor, type DetailMasters } from "@/components/enquiry-details";
import { EnquiryInterests } from "@/components/enquiry-interests";
import { UnarchiveButton } from "@/components/unarchive-button";
import { CallEdits } from "@/components/call-edits";
import { EditCallRow } from "@/components/call-log/edit-call-row";
import type { ItemMasters } from "@/components/interest-lines";
import { Collapsed } from "@/components/enquiry-glance";
import { Badge, cx } from "@/components/ui";
import { WhatsAppButton } from "@/components/whatsapp/button";
import { stageOf } from "@/lib/whatsapp-text";
import {
  BUCKET_LABELS,
  CLOSE_REASON_LABELS,
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_TYPE_LABELS,
  IMPORTANCE_LABELS,
  LEAD_VERIFICATION_LABELS,
  LOST_REASON_LABELS,
  OUTCOME_LABELS,
  statusTone,
} from "@/lib/enquiry-labels";
import { formatDate, formatDateTime, istToday } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import type { HistoryEnquiry, StudentHistory } from "@/lib/students";

/**
 * §5.2, rendered once and used twice: the /students/[mobile] page and the
 * panel Quick Add shows for a number it already knows. No "use client" — it
 * holds no state, so it renders on the server for the page and folds into the
 * client bundle for Quick Add.
 */



/** The history row shape, flattened for the shared Interests block. */
function toInterestItem(item: HistoryEnquiry["enquiry_items"][number]) {
  return {
    id: item.id,
    status: item.status,
    // §39.3: the drawer edits the line in place, so it carries the ids as well
    // as the names it reads as.
    teacherId: item.teacher_id,
    courseId: item.course_id,
    subjectId: item.subject_id,
    contentId: item.content_id,
    teacher: item.teacher?.name ?? null,
    course: item.course?.name ?? null,
    subject: item.subject?.name ?? null,
    content: item.content?.name ?? null,
    orderId: item.order_id,
    amount: item.amount,
  };
}


/**
 * The stage a call was made at (§4.3).
 *
 * A slot is a distinct IST calendar day after the fresh-call day, so the stage
 * is the rank of this call's date among the enquiry's distinct call dates —
 * which makes two calls on one day the same stage, as the slot rule intends.
 * Computed here from the calls already loaded rather than asked of the
 * database: it is the same dense_rank the stage report uses, over a handful of
 * rows that are all in hand.
 */
function stagesByCall(calls: HistoryEnquiry["calls"]): Map<number, number> {
  const days = [...new Set(calls.map((c) => c.call_date))].sort();
  const rank = new Map(days.map((d, i) => [d, i]));
  return new Map(calls.map((c) => [c.id, rank.get(c.call_date) ?? 0]));
}


/** §4.3's ladder, named. Anything past the third rung reads as the third. */
const STAGE_LABELS = ["Fresh", "1st follow-up", "2nd follow-up", "3rd follow-up"];

function stageLabel(type: HistoryEnquiry["type"], slot: number): string {
  if (type === "after_sale") return "After-sale";
  return STAGE_LABELS[Math.min(slot, STAGE_LABELS.length - 1)];
}

export function StudentHistoryView({
  student,
  className,
  showHeader = true,
  masters,
  counsellorName,
  canUnarchive,
  viewerId,
  viewerIsAdmin,
  onEdited,
}: {
  student: StudentHistory;
  className?: string;
  showHeader?: boolean;
  masters?: DetailMasters & ItemMasters;
  counsellorName?: string | null;
  canUnarchive?: boolean;
  /** §29.4: who is looking, so a call row knows whether it is theirs. */
  viewerId?: string | null;
  viewerIsAdmin?: boolean;
  onEdited?: () => void;
}) {
  const today = istToday();
  const enquiries = [...student.enquiries].sort((a, b) => b.id - a.id);
  // What "this number" means: the open enquiry, or the most recent when none
  // is open. Two open at once should not happen; the newer wins if it does.
  /**
   * §33.8. Every enquiry that is live right now, not one of them.
   *
   * A student can be a purchase lead and an after-sale ticket at the same
   * time, and they are worked by different people on different screens.
   * Picking "the open one" meant the other was folded away under Previous,
   * where somebody about to dial would never see it. Escalated counts as live:
   * it is a ticket somebody else is waiting on.
   */
  const nowCards = enquiries.filter(
    (e) => e.status === "open" || e.status === "escalated",
  );
  const current = nowCards[0] ?? enquiries[0] ?? null;
  const shown = nowCards.length ? nowCards : current ? [current] : [];
  const previous = enquiries.filter((e) => !shown.some((x) => x.id === e.id));

  // §37. Two tables: the conversations, and everything else that happened.
  const rows = callHistory(enquiries);
  const events = eventHistory(enquiries);
  const callCount = rows.length;
  /** The most recent call on one enquiry — each card shows its own. */
  const lastCallFor = (enquiryId: number) =>
    rows.find((r) => r.enquiryId === enquiryId) ?? null;

  if (!current) {
    return <p className={cx("text-[13px] text-ink-3", className)}>No enquiries yet.</p>;
  }

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      {/* ---- (a) Now: one card per open enquiry (§33.8) ---- */}
      {showHeader ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[15px] font-semibold text-ink">
            {student.name || "No name recorded"}
          </span>
          <Link
            href={`/students/${student.mobile}`}
            className="text-[13px] tabular-nums text-ink-2 underline-offset-2 hover:underline"
          >
            {formatMobile(student.mobile)}
          </Link>
          <span className="text-[11.5px] text-ink-3">
            First seen {formatDate(student.created_at)}
          </span>
        </div>
      ) : null}

      {/* Side by side, because they are genuinely separate things: a lead and
          a complaint on the same number have their own status, their own
          stage or reminder and their own last note, and stacking one on top of
          the other reads as history rather than as two live conversations. */}
      <div
        className={cx(
          "grid gap-3",
          shown.length > 1 ? "lg:grid-cols-2" : "grid-cols-1",
        )}
      >
        {shown.map((e) => (
          <NowCard
            key={e.id}
            enquiry={e}
            student={student}
            counsellorName={counsellorName}
            canUnarchive={canUnarchive}
            today={today}
            lastCall={lastCallFor(e.id)}
            onEdited={onEdited}
          />
        ))}
      </div>

      {/* ---- (b) one call history, across every enquiry ---- */}
      <section>
        <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">
          Calls — every enquiry on this number ({callCount} call
          {callCount === 1 ? "" : "s"})
        </h3>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
            <thead>
              {/* §35.3. Remarks moved up beside the counsellor and takes the
                  width, because it is the column anybody actually reads; the
                  enquiry number and the stage are reference, so they sit at
                  the end where reference belongs. */}
              <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                <th className="w-[130px] px-1.5 py-[7px]">Date/time</th>
                <th className="w-[110px] px-1.5 py-[7px]">Counsellor</th>
                <th className="px-1.5 py-[7px]">Remarks</th>
                <th className="w-[110px] px-1.5 py-[7px]">Outcome</th>
                <th className="w-[95px] px-1.5 py-[7px]">Follow-up</th>
                <th className="w-[70px] px-1.5 py-[7px]">Enquiry #</th>
                <th className="w-[110px] px-1.5 py-[7px]">Stage</th>
                <th className="w-[90px] px-1.5 py-[7px]">Edits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line last:border-b-0">
                  <td className="px-1.5 py-[5px] whitespace-nowrap text-ink-2">
                    {formatDateTime(r.at)}
                  </td>
                  <td className="px-1.5 py-[5px] text-ink-2">{r.counsellor}</td>
                  <td className="px-1.5 py-[5px] text-ink-2">
                    {r.remarks || "—"}
                    {r.call ? (
                      <EditCallRow
                        call={r.call}
                        type={r.type}
                        importance={r.importance}
                        leadVerification={r.leadVerification}
                        viewerId={viewerId}
                        viewerIsAdmin={viewerIsAdmin}
                      />
                    ) : null}
                  </td>
                  <td className="px-1.5 py-[5px] text-ink">{r.outcome}</td>
                  <td className="px-1.5 py-[5px] whitespace-nowrap text-ink-3">
                    {r.followUp}
                  </td>
                  <td className="px-1.5 py-[5px] tabular-nums text-ink-3">#{r.enquiryId}</td>
                  <td className="px-1.5 py-[5px] text-ink-3">{r.stage || "—"}</td>
                  <td className="px-1.5 py-[5px]">
                    {r.call ? (
                      <CallEdits
                        callId={r.call.id}
                        edits={student.editedCalls?.[r.call.id] ?? 0}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink-3">
                    Nobody has called this number yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- (c) everything else that happened (§37) ---- */}
      {events.length ? (
        <details className="rounded-lg border border-line bg-surface shadow-card">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[12.5px] text-ink-2 hover:text-ink">
            <span className="inline-block w-3 text-ink-3">›</span>
            Events ({events.length})
            <span className="ml-1.5 text-[11.5px] text-ink-3">
              messages, arrivals, assignments and the rest
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                  <th className="w-[130px] px-1.5 py-[7px]">Date/time</th>
                  <th className="w-[110px] px-1.5 py-[7px]">Event</th>
                  <th className="px-1.5 py-[7px]">Details</th>
                  <th className="w-[120px] px-1.5 py-[7px]">By</th>
                  <th className="w-[70px] px-1.5 py-[7px]">Enquiry #</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.key} className="border-b border-line last:border-b-0">
                    <td className="px-1.5 py-[5px] whitespace-nowrap text-ink-2">
                      {formatDateTime(e.at)}
                    </td>
                    <td className="px-1.5 py-[5px] whitespace-nowrap text-ink">
                      {e.event}
                    </td>
                    <td className="px-1.5 py-[5px] text-ink-2">{e.details}</td>
                    <td className="px-1.5 py-[5px] text-ink-3">{e.by}</td>
                    <td className="px-1.5 py-[5px] tabular-nums text-ink-3">
                      #{e.enquiryId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {/* ---- (c) the ones that are over ---- */}
      {previous.length ? (
        <details className="rounded-lg border border-line bg-surface shadow-card">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[12.5px] text-ink-2 hover:text-ink">
            <span className="inline-block w-3 text-ink-3">›</span>
            Previous enquiries ({previous.length})
          </summary>
          <div className="flex flex-col gap-1.5 border-t border-line px-4 py-2.5">
            {previous.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
              >
                <Badge tone="neutral">#{e.id}</Badge>
                <Badge dot tone={statusTone(e.status)}>
                  {ENQUIRY_STATUS_LABELS[e.status]}
                </Badge>
                <span className="text-ink-3">opened {formatDate(e.created_at)}</span>
                <span className="text-ink-3">
                  {e.calls.length} call{e.calls.length === 1 ? "" : "s"}
                </span>
                <span className="text-ink-2">
                  {e.enquiry_items.map((i) => i.teacher?.name).filter(Boolean).join(", ") ||
                    "no interests"}
                </span>
                {canUnarchive && e.archived_at ? (
                  <UnarchiveButton enquiryId={e.id} onDone={onEdited} />
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* ---- (d) the things somebody opens a history to change ---- */}
      {masters ? (
        <div className="flex flex-col gap-1.5">
          {current.type === "purchase" ? (
            <Collapsed summary="Edit interests">
              <EnquiryInterests
                enquiryId={current.id}
                items={current.enquiry_items.map(toInterestItem)}
                masters={masters}
                onSaved={onEdited}
                bare
              />
            </Collapsed>
          ) : null}
          <Collapsed summary="Edit enquiry details">
            <EnquiryDetailsEditor
              enquiryId={current.id}
              masters={masters}
              initial={{
                studentName: student.name,
                importance: current.importance,
                termId: current.term_id,
                sourceId: current.source_id,
                leadVerification: current.lead_verification,
              }}
              onSaved={onEdited}
            />
          </Collapsed>
          {current.assignments.length ? (
            <Collapsed summary={`Assignments (${current.assignments.length})`}>
              <ul className="text-[12.5px] text-ink-2">
                {current.assignments.map((a) => (
                  <li key={a.id} className="py-0.5">
                    {formatDate(a.date)} · {BUCKET_LABELS[a.bucket]} ·{" "}
                    {a.counsellor?.full_name ?? "unknown"}
                  </li>
                ))}
              </ul>
            </Collapsed>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
        {label}
      </dt>
      <dd className="mt-0.5 text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

type UnifiedRow = {
  key: string;
  at: string;
  kind: "call";
  /** Present on call rows only: what §29.4's editor needs to correct it. */
  call?: {
    id: number;
    calledBy: string;
    callDate: string;
    outcome: HistoryEnquiry["calls"][number]["outcome"];
    discussion: string | null;
    nextFollowUpDate: string | null;
  };
  type: HistoryEnquiry["type"];
  importance: HistoryEnquiry["importance"];
  leadVerification: HistoryEnquiry["lead_verification"];
  enquiryId: number;
  counsellor: string;
  stage: string;
  outcome: string;
  followUp: string;
  remarks: string;
};

/**
 * Every call, send and source event on the number, newest first (§28.4b).
 *
 * One stream rather than one per enquiry, because a re-enquired number carries
 * its story on the rows that came before — splitting by enquiry is precisely
 * what hides it. The stage is the one the call was at when it happened, not
 * the enquiry's slot count now.
 */
/**
 * The calls, newest first (§37).
 *
 * Only rows with a counsellor on them, because that is what a call is: a
 * person rang somebody. Everything else that happened to this number — a
 * template sent, a number arriving again, a lead handed out — is a fact about
 * the record rather than a conversation, and it was drowning the conversations
 * it sat between.
 */
function callHistory(enquiries: HistoryEnquiry[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  for (const e of enquiries) {
    const stages = stagesByCall(e.calls);
    for (const c of e.calls) {
      rows.push({
        key: `c${c.id}`,
        at: c.called_at,
        kind: "call",
        enquiryId: e.id,
        counsellor: c.caller?.full_name ?? "—",
        stage: stageLabel(e.type, stages.get(c.id) ?? 0),
        outcome: OUTCOME_LABELS[c.outcome],
        followUp: c.next_follow_up_date ? formatDate(c.next_follow_up_date) : "—",
        remarks: c.discussion ?? "",
        call: {
          id: c.id,
          calledBy: c.called_by,
          callDate: c.call_date,
          outcome: c.outcome,
          discussion: c.discussion,
          nextFollowUpDate: c.next_follow_up_date,
        },
        type: e.type,
        importance: e.importance,
        leadVerification: e.lead_verification,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export type EventRow = {
  key: string;
  at: string;
  event: string;
  details: string;
  by: string;
  enquiryId: number;
};

/**
 * Everything else that happened, newest first (§37).
 *
 * Folded away by default behind a count, because it is looked at when
 * something is being reconstructed rather than before a call. Nothing is
 * dropped: every row that used to be in the single timeline is in exactly one
 * of the two tables now, and the events that were never shown at all —
 * assignments, re-enquiries, conversions, archiving — are here too.
 *
 * A date-only event (a re-enquiry, an assignment) is given midday so it sorts
 * sensibly against the timestamps around it rather than jumping to the top of
 * its day.
 */
function eventHistory(enquiries: HistoryEnquiry[]): EventRow[] {
  const rows: EventRow[] = [];
  const atNoon = (date: string) => `${date}T12:00:00+05:30`;

  for (const e of enquiries) {
    for (const w of e.whatsapp_sends) {
      rows.push({
        key: `w${w.id}`,
        at: w.sent_at,
        event: "WhatsApp",
        details: w.template?.name ?? w.message_text.slice(0, 120),
        by: w.sender?.full_name ?? "—",
        enquiryId: e.id,
      });
    }

    for (const src of e.enquiry_sources) {
      rows.push({
        key: `s${src.id}`,
        at: src.occurred_at,
        // An import and a number typed in by hand are both arrivals, and which
        // it was is the first thing anybody asks about an unexpected lead.
        event: src.import_batch_id ? "Import" : "Source",
        details: [src.source?.name, src.note].filter(Boolean).join(" · ") || "—",
        by: "—",
        enquiryId: e.id,
      });
    }

    for (const a of e.assignments) {
      rows.push({
        key: `a${a.id}`,
        at: atNoon(a.date),
        event: "Assigned",
        details: [BUCKET_LABELS[a.bucket], a.label].filter(Boolean).join(" · "),
        by: a.counsellor?.full_name ?? "—",
        enquiryId: e.id,
      });
    }

    if (e.re_enquired_at) {
      rows.push({
        key: `r${e.id}`,
        at: atNoon(e.re_enquired_at),
        event: "Re-enquired",
        details: "The number arrived again while this was open",
        by: "—",
        enquiryId: e.id,
      });
    }

    if (e.close_reason === "converted" && e.closed_at) {
      rows.push({
        key: `v${e.id}`,
        at: e.closed_at,
        event: "Converted",
        details: "Closed and continued as an after-sale enquiry",
        by: "—",
        enquiryId: e.id,
      });
    }

    if (e.archived_at) {
      rows.push({
        key: `x${e.id}`,
        at: e.archived_at,
        event: "Archived",
        details: "Exported and taken off the working lists",
        by: e.archiver?.full_name ?? "—",
        enquiryId: e.id,
      });
    }
  }

  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * One live enquiry, at a glance (§33.8).
 *
 * Everything the card used to say about "the" enquiry, said about this one —
 * its status, its stage or reminder, its chips and its own last note. The
 * student's name sits above the row of cards rather than inside each, because
 * it is a fact about the number, not about either conversation.
 */
function NowCard({
  enquiry,
  student,
  counsellorName,
  canUnarchive,
  today,
  lastCall,
  onEdited,
}: {
  enquiry: StudentHistory["enquiries"][number];
  student: StudentHistory;
  counsellorName: string | null | undefined;
  canUnarchive: boolean | undefined;
  today: string;
  lastCall: UnifiedRow | null;
  onEdited?: () => void;
}) {
  const showHeader = false;
  const openItems = enquiry.enquiry_items.filter((i) => i.status === "open");
  const todays = enquiry.assignments.find((a) => a.date === today);
  const resolution =
    enquiry.status === "lost" && enquiry.lost_reason
      ? LOST_REASON_LABELS[enquiry.lost_reason]
      : enquiry.status === "closed" && enquiry.close_reason
        ? CLOSE_REASON_LABELS[enquiry.close_reason]
        : null;

  return (
      <section className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5">
          {showHeader ? (
            <>
              <span className="text-[15px] font-semibold text-ink">
                {student.name || "No name recorded"}
              </span>
              <Link
                href={`/students/${student.mobile}`}
                className="text-[13px] tabular-nums text-ink-2 underline-offset-2 hover:underline"
              >
                {formatMobile(student.mobile)}
              </Link>
            </>
          ) : null}
          <Badge dot tone={statusTone(enquiry.status)}>
            {ENQUIRY_STATUS_LABELS[enquiry.status]}
          </Badge>
          {resolution ? (
            <span className="text-[11.5px] text-ink-3">({resolution})</span>
          ) : null}
          <Badge tone="neutral">#{enquiry.id}</Badge>
          <Badge tone="neutral">{ENQUIRY_TYPE_LABELS[enquiry.type]}</Badge>
          {enquiry.archived_at ? <Badge tone="neutral">Archived</Badge> : null}
          {enquiry.re_enquired_at ? (
            <Badge dot tone="warn">Re-enquired {formatDate(enquiry.re_enquired_at)}</Badge>
          ) : null}
          <span className="ml-auto text-[11.5px] text-ink-3">
            First seen {formatDate(student.created_at)}
          </span>
          {canUnarchive && enquiry.archived_at ? (
            <UnarchiveButton enquiryId={enquiry.id} onDone={onEdited} />
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Stage">
            {/* stageOf() returns the machine key the WhatsApp templates key
                off; this is the human sentence. */}
            {enquiry.type === "after_sale"
              ? "After-sale"
              : `${enquiry.follow_up_slots_used} of 3 follow-ups`}
          </Fact>
          <Fact label="Importance">
            {enquiry.importance ? IMPORTANCE_LABELS[enquiry.importance] : "—"}
          </Fact>
          <Fact label="Lead">
            {enquiry.lead_verification
              ? LEAD_VERIFICATION_LABELS[enquiry.lead_verification]
              : "—"}
          </Fact>
          <Fact label="Next follow-up">
            {enquiry.next_follow_up_date ? formatDate(enquiry.next_follow_up_date) : "—"}
          </Fact>
          <Fact label="Assigned today">{todays?.counsellor?.full_name ?? "nobody"}</Fact>
          <Fact label="Term">{enquiry.term?.name ?? "—"}</Fact>
        </dl>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5">
          {openItems.length ? (
            openItems.map((i) => (
              <span
                key={i.id}
                className="rounded-full border border-line-2 bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2"
              >
                {[i.teacher?.name, i.course?.name, i.subject?.name, i.content?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ))
          ) : (
            /* §29.2: amber, not grey. A purchase lead with nothing recorded is
               invisible to the teacher-wise reports, which is a fact about the
               record rather than an absence of decoration. */
            <span
              className={cx(
                "rounded-full border px-2 py-0.5 text-[11.5px]",
                enquiry.type === "purchase"
                  ? "border-warn/50 bg-warn-soft/40 font-medium text-warn"
                  : "border-line-2 bg-surface-2 italic text-ink-3",
              )}
            >
              {enquiry.type === "purchase"
                ? "No interests recorded"
                : "No interests — after-sale"}
            </span>
          )}
          {/* Messaging somebody is a thing you do during the glance, not after
              reading the history. */}
          {enquiry.status === "open" ? (
            <span className="ml-auto">
              <WhatsAppButton
                enquiryId={enquiry.id}
                mobile={student.mobile}
                studentName={student.name}
                items={enquiry.enquiry_items.map((i) => ({
                  teacher: i.teacher?.name ?? null,
                  course: i.course?.name ?? null,
                  subject: i.subject?.name ?? null,
                  content: i.content?.name ?? null,
                }))}
                term={enquiry.term?.name ?? null}
                productText={enquiry.product_text}
                counsellorName={counsellorName ?? null}
                stage={stageOf(enquiry.type, enquiry.follow_up_slots_used)}
              />
            </span>
          ) : null}
        </div>

        {lastCall ? (
          <div className="border-t border-line bg-sunk/40 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Last note — {formatDateTime(lastCall.at)} · {lastCall.counsellor} ·{" "}
              {lastCall.outcome}
            </p>
            {/* In full, never truncated: it is the one sentence somebody reads
                before dialling. */}
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink">
              {lastCall.remarks || <span className="italic text-ink-3">no note</span>}
            </p>
          </div>
        ) : null}
      </section>
  );
}
