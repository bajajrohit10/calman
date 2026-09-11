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

function CallLine({ call }: { call: HistoryEnquiry["calls"][number] }) {
  return (
    <li className="border-l-2 border-line-2 py-1.5 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-ink">
          {OUTCOME_SHORT[call.outcome]}
        </span>
        <span className="text-[11.5px] text-ink-3">{formatDateTime(call.called_at)}</span>
        <span className="text-[11.5px] text-ink-3">
          by {call.caller?.full_name ?? "unknown"}
        </span>
        {call.whatsapp_sent ? <Badge tone="ok">WhatsApp sent</Badge> : null}
        {call.issue_category ? (
          <Badge tone="neutral">{ISSUE_CATEGORY_LABELS[call.issue_category]}</Badge>
        ) : null}
        {call.order_id ? (
          <span className="text-[11.5px] text-ink-3">order {call.order_id}</span>
        ) : null}
      </div>

      {call.discussion ? (
        <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">
          {call.discussion}
        </p>
      ) : (
        <p className="mt-0.5 text-[12.5px] italic text-ink-3">No note</p>
      )}

      {call.next_follow_up_date ? (
        <p className="mt-0.5 text-[11.5px] text-ink-3">
          Next: {formatDate(call.next_follow_up_date)}
        </p>
      ) : null}
    </li>
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
        <span className="ml-auto text-[11.5px] text-ink-3">
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
        <Meta label="Term" value={enquiry.term?.name ?? "—"} />
        <Meta label="Source" value={enquiry.source?.name ?? "—"} />
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

      {/* §10.1: every source this number arrived through. An import overrides
          the enquiry's current source, so without this the earlier ones would
          simply be gone. */}
      {enquiry.enquiry_sources?.length ? (
        <section className="border-t border-line px-4 py-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Sources ({enquiry.enquiry_sources.length})
          </h4>
          <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px]">
            {[...enquiry.enquiry_sources]
              .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
              .map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-0.5">
                  <span className="text-ink">{s.source?.name ?? "No source"}</span>
                  <span className="text-[11.5px] text-ink-3">
                    {formatDateTime(s.occurred_at)}
                  </span>
                  {s.note ? (
                    <span className="text-[11.5px] italic text-ink-3">{s.note}</span>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

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

      {enquiry.whatsapp_sends.length ? (
        <section className="border-t border-line px-4 py-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            WhatsApp ({enquiry.whatsapp_sends.length})
          </h4>
          <ul className="mt-1 flex flex-col gap-1 text-[12.5px]">
            {enquiry.whatsapp_sends.map((w) => (
              <li key={w.id} className="border-l-2 border-ok/50 py-1 pl-3">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
                  <span>{formatDateTime(w.sent_at)}</span>
                  <span>by {w.sender?.full_name ?? "unknown"}</span>
                  {w.template?.name ? <Badge tone="neutral">{w.template.name}</Badge> : null}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{w.message_text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-t border-line px-4 py-2.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
          Calls ({enquiry.calls.length})
        </h4>
        {enquiry.calls.length ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {enquiry.calls.map((call) => (
              <CallLine key={call.id} call={call} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12.5px] italic text-ink-3">Not called yet.</p>
        )}
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
