import Link from "next/link";

import { EnquiryDetailsEditor, type DetailMasters } from "@/components/enquiry-details";
import { EnquiryInterests } from "@/components/enquiry-interests";
import { UnarchiveButton } from "@/components/unarchive-button";
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
    label:
      [item.teacher?.name, item.course?.name, item.subject?.name, item.content?.name]
        .filter(Boolean)
        .join(" · ") || "—",
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
  onEdited,
}: {
  student: StudentHistory;
  className?: string;
  showHeader?: boolean;
  masters?: DetailMasters & ItemMasters;
  counsellorName?: string | null;
  canUnarchive?: boolean;
  onEdited?: () => void;
}) {
  const today = istToday();
  const enquiries = [...student.enquiries].sort((a, b) => b.id - a.id);
  // What "this number" means: the open enquiry, or the most recent when none
  // is open. Two open at once should not happen; the newer wins if it does.
  const current = enquiries.find((e) => e.status === "open") ?? enquiries[0] ?? null;
  const previous = enquiries.filter((e) => e.id !== current?.id);

  const rows = unifiedHistory(enquiries);
  const callCount = rows.filter((r) => r.kind === "call").length;
  const lastCall = rows.find((r) => r.kind === "call");
  const openItems = current?.enquiry_items.filter((i) => i.status === "open") ?? [];
  const todays = current?.assignments.find((a) => a.date === today);
  const resolution =
    current?.status === "lost" && current.lost_reason
      ? LOST_REASON_LABELS[current.lost_reason]
      : current?.status === "closed" && current.close_reason
        ? CLOSE_REASON_LABELS[current.close_reason]
        : null;

  if (!current) {
    return <p className={cx("text-[13px] text-ink-3", className)}>No enquiries yet.</p>;
  }

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      {/* ---- (a) Now ---- */}
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
          <Badge dot tone={statusTone(current.status)}>
            {ENQUIRY_STATUS_LABELS[current.status]}
          </Badge>
          {resolution ? (
            <span className="text-[11.5px] text-ink-3">({resolution})</span>
          ) : null}
          <Badge tone="neutral">#{current.id}</Badge>
          <Badge tone="neutral">{ENQUIRY_TYPE_LABELS[current.type]}</Badge>
          {current.archived_at ? <Badge tone="neutral">Archived</Badge> : null}
          {current.re_enquired_at ? (
            <Badge dot tone="warn">Re-enquired {formatDate(current.re_enquired_at)}</Badge>
          ) : null}
          <span className="ml-auto text-[11.5px] text-ink-3">
            First seen {formatDate(student.created_at)}
          </span>
          {canUnarchive && current.archived_at ? (
            <UnarchiveButton enquiryId={current.id} onDone={onEdited} />
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Stage">
            {/* stageOf() returns the machine key the WhatsApp templates key
                off; this is the human sentence. */}
            {current.type === "after_sale"
              ? "After-sale"
              : `${current.follow_up_slots_used} of 3 follow-ups`}
          </Fact>
          <Fact label="Importance">
            {current.importance ? IMPORTANCE_LABELS[current.importance] : "—"}
          </Fact>
          <Fact label="Lead">
            {current.lead_verification
              ? LEAD_VERIFICATION_LABELS[current.lead_verification]
              : "—"}
          </Fact>
          <Fact label="Next follow-up">
            {current.next_follow_up_date ? formatDate(current.next_follow_up_date) : "—"}
          </Fact>
          <Fact label="Assigned today">{todays?.counsellor?.full_name ?? "nobody"}</Fact>
          <Fact label="Term">{current.term?.name ?? "—"}</Fact>
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
            <span className="text-[12px] italic text-ink-3">No open interests.</span>
          )}
          {/* Messaging somebody is a thing you do during the glance, not after
              reading the history. */}
          {current.status === "open" ? (
            <span className="ml-auto">
              <WhatsAppButton
                enquiryId={current.id}
                mobile={student.mobile}
                studentName={student.name}
                items={current.enquiry_items.map((i) => ({
                  teacher: i.teacher?.name ?? null,
                  course: i.course?.name ?? null,
                  subject: i.subject?.name ?? null,
                  content: i.content?.name ?? null,
                }))}
                term={current.term?.name ?? null}
                productText={current.product_text}
                counsellorName={counsellorName ?? null}
                stage={stageOf(current.type, current.follow_up_slots_used)}
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

      {/* ---- (b) one call history, across every enquiry ---- */}
      <section>
        <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">
          Call history — every enquiry on this number ({callCount} call
          {callCount === 1 ? "" : "s"})
        </h3>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                <th className="px-2 py-[7px]">Date</th>
                <th className="px-2 py-[7px]">Counsellor</th>
                <th className="px-2 py-[7px]">Enquiry</th>
                <th className="px-2 py-[7px]">Stage</th>
                <th className="px-2 py-[7px]">Outcome</th>
                <th className="px-2 py-[7px]">Follow-up</th>
                <th className="px-2 py-[7px]">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    // Sends and source events are context, not calls: muted, so
                    // the eye runs down the calls and takes these in passing.
                    r.kind !== "call" && "bg-sunk/30 text-ink-3",
                  )}
                >
                  <td className="px-2 py-[5px] whitespace-nowrap text-ink-2">
                    {formatDateTime(r.at)}
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">{r.counsellor}</td>
                  <td className="px-2 py-[5px] tabular-nums text-ink-3">#{r.enquiryId}</td>
                  <td className="px-2 py-[5px] text-ink-3">{r.stage || "—"}</td>
                  <td className={cx("px-2 py-[5px]", r.kind === "call" && "text-ink")}>
                    {r.outcome}
                  </td>
                  <td className="px-2 py-[5px] whitespace-nowrap text-ink-3">
                    {r.followUp}
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">{r.remarks || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-ink-3">
                    Nothing has happened on this number yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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
  kind: "call" | "send" | "event";
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
function unifiedHistory(enquiries: HistoryEnquiry[]): UnifiedRow[] {
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
      });
    }
    for (const w of e.whatsapp_sends) {
      rows.push({
        key: `w${w.id}`,
        at: w.sent_at,
        kind: "send",
        enquiryId: e.id,
        counsellor: w.sender?.full_name ?? "—",
        stage: "",
        outcome: "WhatsApp",
        followUp: "—",
        remarks: w.template?.name ?? w.message_text.slice(0, 90),
      });
    }
    for (const src of e.enquiry_sources) {
      rows.push({
        key: `s${src.id}`,
        at: src.occurred_at,
        kind: "event",
        enquiryId: e.id,
        counsellor: "—",
        stage: "",
        outcome: src.source?.name ? `Source: ${src.source.name}` : "Source",
        followUp: "—",
        remarks: src.note ?? "",
      });
    }
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
