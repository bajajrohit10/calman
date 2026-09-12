"use client";

import { Badge, cx } from "@/components/ui";
import {
  ENQUIRY_STATUS_LABELS,
  IMPORTANCE_LABELS,
  LEAD_VERIFICATION_LABELS,
  OUTCOME_LABELS,
  statusTone,
} from "@/lib/enquiry-labels";
import { formatDate, formatDateTime, istToday } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import type { StudentHistory } from "@/lib/students";

/**
 * Proposed student history (§28.4).
 *
 * The page today repeats the same header for every enquiry, so a number with
 * four of them is four glance blocks, four timelines and four sets of drawers,
 * and the question anybody actually opened it with — what is happening with
 * this person — is answered nowhere in particular.
 *
 * So: one Now card that answers it, one call history across every enquiry, and
 * everything else folded away.
 */
export function HistoryPreview({ student }: { student: StudentHistory }) {
  const today = istToday();

  // Newest first; the one the product means by "this number" is the open one,
  // falling back to the most recent.
  const enquiries = [...student.enquiries].sort((a, b) => b.id - a.id);
  const current = enquiries.find((e) => e.status === "open") ?? enquiries[0];
  const previous = enquiries.filter((e) => e.id !== current?.id);

  type Row = {
    at: string;
    kind: "call" | "send" | "event";
    enquiryId: number;
    counsellor: string;
    stage: string;
    outcome: string;
    followUp: string;
    remarks: string;
  };

  // One stream across every enquiry (§28.4b). A re-enquired number carries its
  // story on the rows that came before, so splitting by enquiry is exactly
  // what hides it.
  const rows: Row[] = [];
  for (const e of enquiries) {
    const days = [...new Set(e.calls.map((c) => c.call_date))].sort();
    for (const c of e.calls) {
      const slot = days.indexOf(c.call_date);
      rows.push({
        at: c.called_at,
        kind: "call",
        enquiryId: e.id,
        counsellor: c.caller?.full_name ?? "—",
        stage: slot <= 0 ? "Fresh" : `${slot}${slot === 1 ? "st" : slot === 2 ? "nd" : "rd"} follow-up`,
        outcome: OUTCOME_LABELS[c.outcome],
        followUp: c.next_follow_up_date ? formatDate(c.next_follow_up_date) : "—",
        remarks: c.discussion ?? "",
      });
    }
    for (const w of e.whatsapp_sends) {
      rows.push({
        at: w.sent_at, kind: "send", enquiryId: e.id,
        counsellor: w.sender?.full_name ?? "—", stage: "", outcome: "WhatsApp",
        followUp: "—", remarks: w.template?.name ?? w.message_text.slice(0, 80),
      });
    }
    for (const s of e.enquiry_sources) {
      rows.push({
        at: s.occurred_at, kind: "event", enquiryId: e.id, counsellor: "—", stage: "",
        outcome: s.source?.name ? `Source: ${s.source.name}` : "Source",
        followUp: "—", remarks: s.note ?? "",
      });
    }
  }
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const lastCall = rows.find((r) => r.kind === "call");
  const openItems = current?.enquiry_items.filter((i) => i.status === "open") ?? [];
  const todaysAssignment = current?.assignments.find((a) => a.date === today);
  const slots = current?.follow_up_slots_used ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-2">
        Preview for Brief 28.4 — nothing here saves. One header, one call
        history, everything else folded away.
      </p>

      {/* ---- (a) Now ---- */}
      <section className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5">
          <span className="text-[15px] font-semibold text-ink">
            {student.name || "No name"}
          </span>
          <span className="text-[13px] tabular-nums text-ink-2">
            {formatMobile(student.mobile)}
          </span>
          {current ? (
            <>
              <Badge dot tone={statusTone(current.status)}>
                {ENQUIRY_STATUS_LABELS[current.status]}
              </Badge>
              <Badge tone="neutral">#{current.id}</Badge>
            </>
          ) : null}
          <span className="ml-auto text-[11.5px] text-ink-3">
            First seen {formatDate(student.created_at)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Stage">{slots} of 3 follow-ups</Fact>
          <Fact label="Importance">
            {current?.importance ? IMPORTANCE_LABELS[current.importance] : "—"}
          </Fact>
          <Fact label="Lead">
            {current?.lead_verification
              ? LEAD_VERIFICATION_LABELS[current.lead_verification]
              : "—"}
          </Fact>
          <Fact label="Next follow-up">
            {current?.next_follow_up_date ? formatDate(current.next_follow_up_date) : "—"}
          </Fact>
          <Fact label="Assigned today">
            {todaysAssignment?.counsellor?.full_name ?? "nobody"}
          </Fact>
          <Fact label="Term">{current?.term?.name ?? "—"}</Fact>
        </dl>

        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5">
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
        </div>

        {lastCall ? (
          <div className="border-t border-line bg-sunk/40 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Last note — {formatDateTime(lastCall.at)} · {lastCall.counsellor} ·{" "}
              {lastCall.outcome}
            </p>
            {/* In full, not truncated: it is the single most useful sentence on
                the page and the one thing a counsellor reads before dialling. */}
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink">
              {lastCall.remarks || <span className="italic text-ink-3">no note</span>}
            </p>
          </div>
        ) : null}
      </section>

      {/* ---- (b) one call history ---- */}
      <section>
        <h2 className="mb-1.5 text-[13px] font-semibold text-ink">
          Call history — every enquiry on this number ({rows.filter((r) => r.kind === "call").length} calls)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
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
              {rows.map((r, i) => (
                <tr
                  key={`${r.kind}-${r.at}-${i}`}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    // Sends and source events are context, not calls: muted, so
                    // the eye runs down the calls and picks these up in passing.
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
                  <td className="px-2 py-[5px] whitespace-nowrap text-ink-3">{r.followUp}</td>
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

      {/* ---- (c) previous enquiries, folded ---- */}
      {previous.length ? (
        <details className="rounded-lg border border-line bg-surface shadow-card">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[12.5px] text-ink-2 hover:text-ink">
            <span className="inline-block w-3 text-ink-3">›</span>
            Previous enquiries ({previous.length})
          </summary>
          <div className="flex flex-col gap-1.5 border-t border-line px-4 py-2.5">
            {previous.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <Badge tone="neutral">#{e.id}</Badge>
                <Badge dot tone={statusTone(e.status)}>
                  {ENQUIRY_STATUS_LABELS[e.status]}
                </Badge>
                <span className="text-ink-3">opened {formatDate(e.created_at)}</span>
                <span className="text-ink-3">{e.calls.length} calls</span>
                <span className="text-ink-2">
                  {e.enquiry_items.map((i) => i.teacher?.name).filter(Boolean).join(", ") || "no interests"}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* ---- (d) the editing drawers, at the bottom ---- */}
      <div className="flex flex-col gap-1.5">
        {["Edit interests", "Edit enquiry details", "Assignments"].map((label) => (
          <details key={label} className="rounded-lg border border-line bg-surface shadow-card">
            <summary className="cursor-pointer list-none px-4 py-2 text-[12px] text-ink-2 hover:text-ink">
              <span className="inline-block w-3 text-ink-3">›</span>
              {label}
            </summary>
            <p className="border-t border-line px-4 py-2.5 text-[12px] italic text-ink-3">
              The existing editor goes here, unchanged — it is only being moved.
            </p>
          </details>
        ))}
      </div>
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
