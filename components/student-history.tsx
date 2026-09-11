import Link from "next/link";

import { EnquiryDetailsEditor, type DetailMasters } from "@/components/enquiry-details";
import { EnquiryInterests } from "@/components/enquiry-interests";
import { UnarchiveButton } from "@/components/unarchive-button";
import type { ItemMasters } from "@/components/interest-lines";
import { Badge, cx } from "@/components/ui";
import { WhatsAppButton } from "@/components/whatsapp/button";
import { stageOf } from "@/lib/whatsapp-text";
import {
  BUCKET_LABELS,
  CLOSE_REASON_LABELS,
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_TYPE_LABELS,
  IMPORTANCE_LABELS,
  ISSUE_CATEGORY_LABELS,
  LEAD_VERIFICATION_LABELS,
  LOST_REASON_LABELS,
  OUTCOME_SHORT,
  outcomeTone,
  statusTone,
} from "@/lib/enquiry-labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import type { HistoryEnquiry, StudentHistory } from "@/lib/students";

/**
 * §5.2, rendered once and used twice: the /students/[mobile] page and the
 * panel Quick Add shows for a number it already knows. No "use client" — it
 * holds no state, so it renders on the server for the page and folds into the
 * client bundle for Quick Add.
 */

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="text-ink-3">{label}</span>
      <span className="text-ink-2">{value}</span>
    </div>
  );
}

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

const STAGE_LABELS = ["Fresh", "1st follow-up", "2nd follow-up", "3rd follow-up"];

function stageLabel(type: HistoryEnquiry["type"], slot: number): string {
  if (type === "after_sale") return "After-sale";
  return STAGE_LABELS[Math.min(slot, STAGE_LABELS.length - 1)];
}

/** Everything that happened on one enquiry, in one ordered list. */
type Event =
  | { at: string; kind: "call"; call: HistoryEnquiry["calls"][number] }
  | { at: string; kind: "whatsapp"; send: HistoryEnquiry["whatsapp_sends"][number] }
  | { at: string; kind: "source"; entry: HistoryEnquiry["enquiry_sources"][number] };

function timelineOf(enquiry: HistoryEnquiry): Event[] {
  const events: Event[] = [
    ...enquiry.calls.map((call) => ({ at: call.called_at, kind: "call" as const, call })),
    ...enquiry.whatsapp_sends.map((send) => ({
      at: send.sent_at,
      kind: "whatsapp" as const,
      send,
    })),
    ...(enquiry.enquiry_sources ?? []).map((entry) => ({
      at: entry.occurred_at,
      kind: "source" as const,
      entry,
    })),
  ];
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The enquiry's timeline as a table (Brief 16).
 *
 * This replaced a stack of prose blocks per call. A counsellor opening a
 * history is answering "what has been said to this person and when", and that
 * is a question about columns: the same five facts in the same five places
 * down the page, with the remark given the room to be read.
 *
 * WhatsApp sends and source-log entries share the timeline because they
 * happened in it, but they are not calls and are not drawn like them — one
 * quiet full-width line each, so scanning the call rows is undisturbed.
 */
function Timeline({ enquiry }: { enquiry: HistoryEnquiry }) {
  const events = timelineOf(enquiry);
  const stages = stagesByCall(enquiry.calls);

  if (!events.length) {
    return (
      <p className="px-4 py-3 text-[12.5px] italic text-ink-3">
        Nothing recorded on this enquiry yet.
      </p>
    );
  }

  // Shading alternates over the calls, not over every event: the secondary
  // lines sit between them, and striping those too would make the pattern
  // meaningless. Precomputed rather than counted during render — calls are
  // already newest-first, so their position in the list is the stripe.
  const stripe = new Map(enquiry.calls.map((c, i) => [c.id, i % 2 === 1]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            <th className="whitespace-nowrap px-3 py-[7px]">Date / time</th>
            <th className="whitespace-nowrap px-2 py-[7px]">Counsellor</th>
            <th className="whitespace-nowrap px-2 py-[7px]">Stage</th>
            <th className="whitespace-nowrap px-2 py-[7px]">Outcome</th>
            <th className="whitespace-nowrap px-2 py-[7px]">Follow-up</th>
            <th className="w-full px-2 py-[7px]">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            if (event.kind === "call") {
              const call = event.call;
              return (
                <tr
                  key={`c${call.id}`}
                  className={cx(
                    "border-b border-line align-top last:border-b-0",
                    stripe.get(call.id) && "bg-row-alt",
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink">
                    {formatDateTime(call.called_at)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-semibold text-ink">
                    {call.caller?.full_name ?? "unknown"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-ink-2">
                    {stageLabel(enquiry.type, stages.get(call.id) ?? 0)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <Badge dot tone={outcomeTone(call.outcome)}>
                      {OUTCOME_SHORT[call.outcome]}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums text-ink-2">
                    {call.next_follow_up_date ? formatDate(call.next_follow_up_date) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    {call.discussion ? (
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                        {call.discussion}
                      </p>
                    ) : (
                      <p className="text-[12.5px] italic text-ink-3">No note</p>
                    )}
                    {call.issue_category || call.order_id ? (
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
                        {call.issue_category ? (
                          <Badge tone="neutral">
                            {ISSUE_CATEGORY_LABELS[call.issue_category]}
                          </Badge>
                        ) : null}
                        {call.order_id ? <span>order {call.order_id}</span> : null}
                      </p>
                    ) : null}
                  </td>
                </tr>
              );
            }

            if (event.kind === "whatsapp") {
              const w = event.send;
              return (
                <tr key={`w${w.id}`} className="border-b border-line last:border-b-0">
                  <td colSpan={6} className="px-3 py-1.5">
                    <div className="flex flex-wrap items-baseline gap-2 text-[11.5px] text-ink-3">
                      <span aria-hidden className="text-ok">
                        ✓
                      </span>
                      <span className="font-medium text-ink-2">WhatsApp sent</span>
                      <span>{formatDateTime(w.sent_at)}</span>
                      <span>by {w.sender?.full_name ?? "unknown"}</span>
                      {w.template?.name ? <span>· {w.template.name}</span> : null}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap pl-4 text-[12px] text-ink-3">
                      {w.message_text}
                    </p>
                  </td>
                </tr>
              );
            }

            const e = event.entry;
            return (
              <tr key={`s${e.id}`} className="border-b border-line last:border-b-0">
                <td colSpan={6} className="px-3 py-1.5">
                  <div className="flex flex-wrap items-baseline gap-2 text-[11.5px] text-ink-3">
                    <span aria-hidden>↳</span>
                    <span className="font-medium text-ink-2">
                      Source: {e.source?.name ?? "none recorded"}
                    </span>
                    <span>{formatDateTime(e.occurred_at)}</span>
                    {e.note ? <span className="italic">{e.note}</span> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EnquiryCard({
  enquiry,
  mobile,
  studentName,
  counsellorName,
  masters,
  canUnarchive,
  onEdited,
}: {
  enquiry: HistoryEnquiry;
  mobile?: string;
  studentName?: string | null;
  counsellorName?: string | null;
  /** Omit to render the card read-only. */
  masters?: DetailMasters & ItemMasters;
  /** §9: only an admin may put an archived enquiry back. */
  canUnarchive?: boolean;
  onEdited?: () => void;
}) {
  const resolution =
    enquiry.status === "lost" && enquiry.lost_reason
      ? LOST_REASON_LABELS[enquiry.lost_reason]
      : enquiry.status === "closed" && enquiry.close_reason
        ? CLOSE_REASON_LABELS[enquiry.close_reason]
        : null;

  const archived = Boolean(enquiry.archived_at);

  // Every source this number has arrived through, newest first, de-duplicated.
  // An import overrides the enquiry's current source, so the log is the only
  // place the earlier ones survive (§10.1).
  const sourceNames = [
    ...new Set(
      [...(enquiry.enquiry_sources ?? [])]
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .map((entry) => entry.source?.name)
        .filter((n): n is string => Boolean(n)),
    ),
  ];

  return (
    <article
      className={cx(
        "rounded-lg border bg-surface",
        // §9: archived enquiries stay on the history page — this is the one
        // screen that must still show them — but they are visibly out of play.
        archived ? "border-dashed border-line-2 opacity-70" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[13px] font-semibold text-ink">#{enquiry.id}</span>
        <Badge tone="neutral">{ENQUIRY_TYPE_LABELS[enquiry.type]}</Badge>
        <Badge dot tone={statusTone(enquiry.status)}>
          {ENQUIRY_STATUS_LABELS[enquiry.status]}
        </Badge>
        {resolution ? (
          <span className="text-[11.5px] text-ink-3">({resolution})</span>
        ) : null}
        {archived ? <Badge tone="neutral">Archived</Badge> : null}

        <span className="text-[12px] text-ink-2">
          <span className="text-ink-3">Term </span>
          {enquiry.term?.name ?? "—"}
        </span>
        <span className="text-[12px] text-ink-2">
          <span className="text-ink-3">Source </span>
          {sourceNames.length ? sourceNames.join(", ") : "—"}
        </span>

        {/* The teachers and courses behind the enquiry, as chips: the one
            thing somebody opening a history wants before reading a word of it.
            The editable list is still below — this is the glance. */}
        {enquiry.enquiry_items.length ? (
          <span className="flex flex-wrap items-center gap-1">
            {enquiry.enquiry_items.map((i) => (
              <span
                key={i.id}
                className={cx(
                  "inline-flex h-[19px] items-center rounded-full border px-2 text-[11px]",
                  i.status === "won"
                    ? "border-ok/40 bg-ok-soft text-ok"
                    : i.status === "open"
                      ? "border-line-2 bg-surface-2 text-ink-2"
                      : "border-line-2 bg-surface text-ink-3 line-through",
                )}
              >
                {toInterestItem(i).label}
              </span>
            ))}
          </span>
        ) : null}

        <span className="ml-auto whitespace-nowrap text-[11.5px] text-ink-3">
          opened {formatDateTime(enquiry.created_at)}
        </span>
      </header>

      {archived ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunk/40 px-4 py-2">
          <span className="text-[12px] text-ink-2">
            Archived {formatDateTime(enquiry.archived_at!)}. It is out of every list,
            count and report, and still counts as a duplicate on this number.
          </span>
          {canUnarchive ? (
            <span className="ml-auto">
              <UnarchiveButton enquiryId={enquiry.id} onDone={onEdited} />
            </span>
          ) : null}
        </div>
      ) : null}

      {masters ? (
        <div className="border-b border-line px-4 py-2">
          <EnquiryDetailsEditor
            enquiryId={enquiry.id}
            masters={masters}
            initial={{
              studentName: studentName ?? null,
              importance: enquiry.importance,
              termId: enquiry.term_id,
              sourceId: enquiry.source_id,
              leadVerification: enquiry.lead_verification,
            }}
            onSaved={onEdited}
          />
        </div>
      ) : null}

      {enquiry.status === "open" && mobile ? (
        <div className="border-b border-line px-4 py-2">
          <WhatsAppButton
            enquiryId={enquiry.id}
            mobile={mobile}
            studentName={studentName ?? null}
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
        </div>
      ) : null}

      <div className="grid gap-x-6 gap-y-1 px-4 py-2.5 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
        <Meta
          label="Importance"
          value={enquiry.importance ? IMPORTANCE_LABELS[enquiry.importance] : "—"}
        />
        <Meta
          label="Lead verification"
          value={
            enquiry.lead_verification
              ? LEAD_VERIFICATION_LABELS[enquiry.lead_verification]
              : "—"
          }
        />
        <Meta label="Next follow-up" value={formatDate(enquiry.next_follow_up_date)} />
        <Meta
          label="Slots used"
          value={`${enquiry.follow_up_slots_used} of 3`}
        />
        {enquiry.re_enquired_at ? (
          <Meta label="Re-enquired" value={formatDate(enquiry.re_enquired_at)} />
        ) : null}
        {enquiry.closed_at ? (
          <Meta label="Closed" value={formatDateTime(enquiry.closed_at)} />
        ) : null}
      </div>

      {enquiry.product_text ? (
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-2">
          <span className="text-ink-3">Product: </span>
          {enquiry.product_text}
        </p>
      ) : null}

      {/* Open by default, with a line ready to type into, whenever the card is
          editable — an enquiry with no teacher against it is invisible to §7,
          and the fix has to be one keystroke away. An after-sale enquiry is
          about an order that already exists, so it stays read-only. */}
      <EnquiryInterests
        enquiryId={enquiry.id}
        items={enquiry.enquiry_items.map(toInterestItem)}
        masters={masters && enquiry.type === "purchase" ? masters : undefined}
        onSaved={onEdited}
      />

      {enquiry.assignments.length ? (
        <section className="border-t border-line px-4 py-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Assignments
          </h4>
          <ul className="mt-1 text-[12.5px] text-ink-2">
            {enquiry.assignments.map((a) => (
              <li key={a.id} className="py-0.5">
                {formatDate(a.date)} · {BUCKET_LABELS[a.bucket]} ·{" "}
                {a.counsellor?.full_name ?? "unknown"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-t border-line">
        <h4 className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
          Timeline ({enquiry.calls.length} call{enquiry.calls.length === 1 ? "" : "s"})
        </h4>
        <Timeline enquiry={enquiry} />
      </section>

    </article>
  );
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
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      {showHeader ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold text-ink">
            {student.name || "No name recorded"}
          </h2>
          <Link
            href={`/students/${student.mobile}`}
            className="text-[13px] tabular-nums text-ink-2 underline-offset-2 hover:underline"
          >
            {formatMobile(student.mobile)}
          </Link>
          <span className="text-[11.5px] text-ink-3">
            {student.enquiries.length} enquir
            {student.enquiries.length === 1 ? "y" : "ies"}
          </span>
        </div>
      ) : null}

      {student.enquiries.length ? (
        student.enquiries.map((enquiry) => (
          <EnquiryCard
            key={enquiry.id}
            enquiry={enquiry}
            mobile={student.mobile}
            studentName={student.name}
            masters={masters}
            counsellorName={counsellorName}
            canUnarchive={canUnarchive}
            onEdited={onEdited}
          />
        ))
      ) : (
        <p className="text-[13px] text-ink-3">No enquiries yet.</p>
      )}
    </div>
  );
}
