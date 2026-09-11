import { Badge, cx } from "@/components/ui";
import {
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_TYPE_LABELS,
  IMPORTANCE_LABELS,
  ITEM_STATUS_LABELS,
  LEAD_VERIFICATION_LABELS,
  statusTone,
  type EnquiryStatus,
  type EnquiryType,
  type Importance,
  type LeadVerification,
} from "@/lib/enquiry-labels";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * The at-a-glance block (§21): everything true about an enquiry right now, in
 * two lines above whatever the screen is actually for.
 *
 * It replaced a three-column grid of label/value pairs that took a third of
 * the card to say eight short things. A counsellor opening a history or a call
 * panel is orienting, not reading: they want the eight facts in one sweep and
 * then the thing they came for. So the facts are one dense wrapping line, the
 * interests are chips under it, and everything editable moved below the fold.
 *
 * Shared by the student history card and the call panel so the two cannot
 * drift into describing the same enquiry differently.
 */
export type EnquiryGlanceFields = {
  id: number;
  type: EnquiryType;
  status: EnquiryStatus;
  termName: string | null;
  /** Every source the number has arrived through, newest first (§10.1). */
  sourceNames: string[];
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  slotsUsed: number;
  nextFollowUpDate: string | null;
  reEnquiredAt: string | null;
  createdAt: string;
  archived?: boolean;
  /** Why it ended, when it has ended. */
  resolution?: string | null;
};

export type GlanceItem = {
  id: string;
  status: string;
  teacher: string | null;
  course: string | null;
  subject: string | null;
  content: string | null;
};

/** One fact. Label in grey, value in ink, no wrapping between them. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-ink-3">{label} </span>
      <span className="text-ink-2">{value}</span>
    </span>
  );
}

export function EnquiryGlanceLine({ glance }: { glance: EnquiryGlanceFields }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
      <span className="text-[13px] font-semibold text-ink">#{glance.id}</span>
      <Badge tone="neutral">{ENQUIRY_TYPE_LABELS[glance.type]}</Badge>
      <Badge dot tone={statusTone(glance.status)}>
        {ENQUIRY_STATUS_LABELS[glance.status]}
      </Badge>
      {glance.resolution ? (
        <span className="text-[11.5px] text-ink-3">({glance.resolution})</span>
      ) : null}
      {glance.archived ? <Badge tone="neutral">Archived</Badge> : null}

      <Fact label="Term" value={glance.termName ?? "—"} />
      <Fact
        label={glance.sourceNames.length > 1 ? "Sources" : "Source"}
        value={glance.sourceNames.length ? glance.sourceNames.join(", ") : "—"}
      />
      {/* Spelled out rather than shown as the bare letter: "A" means nothing
          to somebody three weeks in, and the meaning is the whole point of the
          grade. */}
      <Fact
        label="Importance"
        value={glance.importance ? IMPORTANCE_LABELS[glance.importance] : "—"}
      />
      <Fact
        label="Lead"
        value={
          glance.leadVerification
            ? LEAD_VERIFICATION_LABELS[glance.leadVerification]
            : "—"
        }
      />
      <Fact label="Slots" value={`${glance.slotsUsed} of 3`} />
      <Fact
        label="Next follow-up"
        value={glance.nextFollowUpDate ? formatDate(glance.nextFollowUpDate) : "—"}
      />
      {glance.reEnquiredAt ? (
        <span className="whitespace-nowrap">
          <Badge dot tone="warn">
            Re-enquired {formatDate(glance.reEnquiredAt)}
          </Badge>
        </span>
      ) : null}
      <span className="ml-auto whitespace-nowrap text-[11.5px] text-ink-3">
        opened {formatDateTime(glance.createdAt)}
      </span>
    </div>
  );
}

/** One chip per interest line: teacher, course, subject, content, status. */
export function InterestChips({
  items,
  className,
}: {
  items: GlanceItem[];
  className?: string;
}) {
  if (!items.length) {
    return (
      <p className={cx("text-[12px] italic text-ink-3", className)}>
        No teacher or subject recorded yet.
      </p>
    );
  }

  return (
    <div className={cx("flex flex-wrap gap-1.5", className)}>
      {items.map((item) => {
        const parts = [item.teacher, item.course, item.subject, item.content].filter(
          Boolean,
        );
        return (
          <span
            key={item.id}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px]",
              item.status === "won"
                ? "border-ok/40 bg-ok-soft text-ok"
                : item.status === "open"
                  ? "border-line-2 bg-surface-2 text-ink-2"
                  : "border-line-2 bg-surface text-ink-3",
            )}
          >
            <span className={item.status === "open" || item.status === "won" ? "" : "line-through"}>
              {parts.length ? parts.join(" · ") : "Untitled interest"}
            </span>
            <span className="text-[10px] uppercase tracking-[0.045em] opacity-70">
              {ITEM_STATUS_LABELS[item.status as keyof typeof ITEM_STATUS_LABELS] ??
                item.status}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * A collapsed section. `details` rather than state: this component renders on
 * the server for /students and inside the client bundle for Quick Add, and the
 * browser can already open and close a disclosure without either.
 */
export function Collapsed({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-t border-line">
      <summary className="cursor-pointer list-none px-4 py-2 text-[12px] text-ink-2 hover:text-ink">
        <span className="inline-block w-3 text-ink-3 group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="px-4 pb-3">{children}</div>
    </details>
  );
}
