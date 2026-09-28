"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import { ISSUE_OPTIONS } from "@/lib/support/normalise";

import {
  findMergeTargets,
  logTicketTouch,
  mergeTicket,
  resolveDuplicateThenSave,
  saveTicketAction,
} from "../actions";
import { SOURCE_LABELS, STATUS_LABELS } from "../filters";
import { statusTone } from "../support-board";

export type TicketDetail = {
  id: number;
  created_at: string;
  source: string;
  raised_at: string;
  student_name: string | null;
  mobile_raw: string | null;
  mobile: string | null;
  order_id_raw: string | null;
  order_id: string | null;
  issues_raw: string | null;
  issues: string[];
  issue_other: string | null;
  description: string | null;
  faculty_raw: string | null;
  attachment_urls: string[];
  form_row_ref: string | null;
  order_id_work: string | null;
  institute_id: string | null;
  teacher_id: string | null;
  issues_work: string[];
  issue_other_work: string | null;
  status: string;
  follow_up_date: string | null;
  escalated_to: string | null;
  /** §61.2: 'team' | 'institute', null unless escalated. */
  escalation_kind: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  parent_ticket_id: number | null;
  merged_at: string | null;
  assigned_to: string | null;
  last_touched_at: string;
  counselling_enquiry_id: number | null;
};

export type TicketEvent = {
  id: number;
  ticket_id: number;
  at: string;
  actor_id: string | null;
  kind: string;
  detail: Record<string, unknown>;
};

type Master = { id: string; name: string };

/**
 * The issues on a ticket, as one readable phrase.
 *
 * "none recorded" rather than an empty string: the prompt compares two tickets
 * and a blank on one side would read as a rendering fault rather than as a fact
 * about the ticket.
 */
function issueSummary(issues: string[] | null, other: string | null): string {
  const parts = [...(issues ?? []), ...(other ? [other] : [])];
  return parts.length ? parts.join(", ") : "none recorded";
}

/** The action-panel save, as the server action takes it. */
type SavePayload = Parameters<typeof saveTicketAction>[0];

/** §63.1. The other half of a live duplicate suggestion. */
export type DuplicateCandidate = {
  other_ticket_id: number;
  other_issues: string[] | null;
  other_issue_other: string | null;
  child_id: number;
  parent_id: number;
  same_issue: boolean;
};

/**
 * §61.2. The outcome control, where the two escalations are separate choices.
 *
 * The dropdown value carries both the status and the kind, because to the person
 * working the ticket "escalated to the institute" is one decision, not a status
 * plus a follow-up question. The status underneath stays `escalated` for both so
 * the tabs, the queue and every existing query keep working.
 */
const OUTCOMES = [
  { id: "working", label: "Working on it", status: "working", kind: null },
  /**
   * §65.3. The counsellor's way of giving the ticket back.
   *
   * Its status underneath is `new` — the team's queue — but it is not "set the
   * status to new": it also unassigns, clears the date and writes its own event
   * kind, so the reports can tell a hand-over from an escalation. The status
   * here is what the row ends up as; `handover` is what the save is told.
   */
  { id: "handover", label: "Hand over to support team", status: "new", kind: null },
  {
    id: "escalated_team",
    label: "Escalated to team member",
    status: "escalated",
    kind: "team",
  },
  {
    id: "escalated_institute",
    label: "Escalated to Institute",
    status: "escalated",
    kind: "institute",
  },
  { id: "future", label: "Future date", status: "future", kind: null },
  { id: "resolved", label: "Resolved", status: "resolved", kind: null },
] as const;

type OutcomeId = (typeof OUTCOMES)[number]["id"];

/**
 * §65.3. Which outcomes this ticket may take.
 *
 * On a counsellor's own working ticket — the Counsellor tab — escalating is not
 * theirs to do: they hand it to the team, and the team escalates. Offering both
 * would put a counselling ticket on the Escalated tab without the team ever
 * having seen it. Everywhere else the full list returns, hand-over included only
 * where it means something.
 */
function outcomesFor(source: string, status: string): readonly (typeof OUTCOMES)[number][] {
  const inCounsellorTab = source === "counselling" && status === "working";
  return OUTCOMES.filter((o) =>
    inCounsellorTab ? o.id !== "escalated_team" && o.id !== "escalated_institute" : o.id !== "handover",
  );
}

/** Which dropdown entry a stored status + kind corresponds to. */
function outcomeIdFor(status: string, kind: string | null): OutcomeId {
  if (status === "escalated") {
    return kind === "institute" ? "escalated_institute" : "escalated_team";
  }
  // `handover` shares its status with New, so it is never the *current* reading
  // of a row — only ever a choice being made now.
  const hit = OUTCOMES.find((o) => o.status === status && o.kind === null && o.id !== "handover");
  return hit?.id ?? "working";
}

export function TicketView({
  ticket,
  events,
  duplicates,
  people,
  staff,
  masters,
  duplicate,
  backTo,
  nextWorkingDay,
  teacherInstitutes,
}: {
  ticket: TicketDetail;
  events: TicketEvent[];
  /** Merged duplicates. Not named `children` — that prop means something else. */
  duplicates: {
    id: number;
    studentName: string | null;
    mobile: string | null;
    orderId: string | null;
    raisedAt: string;
    source: string;
  }[];
  people: Record<string, string>;
  staff: Master[];
  masters: { institutes: Master[]; teachers: Master[] };
  /** §63.1: a live duplicate suggestion, in either direction. */
  duplicate: DuplicateCandidate | null;
  /** §64.1: the queue's query string, so Save returns to where it was opened. */
  backTo: string | null;
  /** §64.1: Mon–Sat, holidays and overrides applied by the database. */
  nextWorkingDay: string | null;
  /** §64.1: teacher id → institute id, from the masters. */
  teacherInstitutes: Record<string, string>;
}) {
  // §62.3. The same label the queue column prints, from the same table.
  const sourceLabel = SOURCE_LABELS[ticket.source] ?? ticket.source;
  const instituteName =
    masters.institutes.find((i) => i.id === ticket.institute_id)?.name ?? null;

  return (
    <div className="flex flex-col gap-3">
      {ticket.parent_ticket_id ? (
        <div className="rounded-md border border-warn/50 bg-warn-soft/40 px-3 py-2 text-[12.5px] text-ink">
          This ticket is a duplicate, merged into{" "}
          <Link
            href={`/support/${ticket.parent_ticket_id}`}
            prefetch={false}
            className="text-accent underline underline-offset-2"
          >
            #{ticket.parent_ticket_id}
          </Link>
          {ticket.merged_at ? ` on ${formatDate(ticket.merged_at)}` : ""}. Work it there —
          its timeline carries this one&apos;s events.
        </div>
      ) : null}

      <section className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5">
          <Badge dot tone={statusTone(ticket.status)}>
            {STATUS_LABELS[ticket.status] ?? ticket.status}
          </Badge>
          <Badge tone="neutral">#{ticket.id}</Badge>
          <Badge tone="neutral">{sourceLabel}</Badge>
          {ticket.status === "escalated" ? (
            <span className="text-[11.5px] text-ink-3">
              {ticket.escalation_kind === "institute"
                ? `escalated to the institute${
                    instituteName ? ` — ${instituteName}` : ""
                  }`
                : `escalated to ${
                    ticket.escalated_to ? (people[ticket.escalated_to] ?? "someone") : "someone"
                  }`}
            </span>
          ) : null}
          {ticket.counselling_enquiry_id ? (
            <span className="text-[11.5px] text-ink-3">
              from counselling enquiry #{ticket.counselling_enquiry_id}
            </span>
          ) : null}
          <span className="ml-auto text-[11.5px] text-ink-3">
            Raised {formatDateTime(ticket.raised_at)} · touched{" "}
            {formatDateTime(ticket.last_touched_at)}
          </span>
        </div>

        {/* §58.4. As submitted, read-only and never overwritten: the student's
            own words stay next to whatever the team made of them. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-3 xl:grid-cols-4">
          <Fact label="Student">{ticket.student_name || "—"}</Fact>
          <Fact label="Mobile">
            {ticket.mobile ? (
              <span className="tabular-nums">{formatMobile(ticket.mobile)}</span>
            ) : (
              <span className="text-warn">
                {ticket.mobile_raw ? `${ticket.mobile_raw} — unusable` : "—"}
              </span>
            )}
          </Fact>
          <Fact label="Order id as submitted">{ticket.order_id_raw || "—"}</Fact>
          <Fact label="Order id normalised">{ticket.order_id || "—"}</Fact>
          <Fact label="Faculty / institute as submitted" wide>
            {ticket.faculty_raw || "—"}
          </Fact>
          <Fact label="Issues as submitted" wide>
            {ticket.issues_raw || "—"}
          </Fact>
          <Fact label="Description" wide>
            <span className="whitespace-pre-wrap">{ticket.description || "—"}</span>
          </Fact>
          <Fact label="Attachments">
            {ticket.attachment_urls.length ? (
              <span className="flex flex-col gap-0.5">
                {ticket.attachment_urls.map((u, i) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent underline underline-offset-2"
                  >
                    File {i + 1}
                  </a>
                ))}
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Form row">{ticket.form_row_ref || "—"}</Fact>
        </dl>
      </section>

      {ticket.parent_ticket_id ? null : (
        <ActionPanel
          ticket={ticket}
          staff={staff}
          masters={masters}
          duplicate={duplicate}
          backTo={backTo}
          nextWorkingDay={nextWorkingDay}
          teacherInstitutes={teacherInstitutes}
        />
      )}

      {ticket.parent_ticket_id ? null : (
        <TouchButtons ticketId={ticket.id} />
      )}

      {ticket.parent_ticket_id ? null : (
        <MergePanel ticketId={ticket.id} />
      )}

      {duplicates.length ? (
        <section className="rounded-lg border border-line bg-surface p-3 shadow-card">
          <h2 className="mb-1.5 text-[13px] font-semibold text-ink">
            Merged duplicates ({duplicates.length})
          </h2>
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {duplicates.map((c) => (
              /* §61.1. Same treatment as the queue: one stretched anchor so the
                 whole line is the link and ⌘-click still opens a tab. */
              <li
                key={c.id}
                className="group relative rounded-sm px-1 py-0.5 hover:bg-surface-2"
              >
                <Link
                  href={`/support/${c.id}`}
                  prefetch={false}
                  aria-label={`Open ticket ${c.id}`}
                  className="absolute inset-0 z-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                />
                <span className="text-accent group-hover:underline">#{c.id}</span>{" "}
                <span className="text-ink-2">
                  {c.studentName || "No name"}
                  {c.mobile ? ` · ${formatMobile(c.mobile)}` : ""}
                  {c.orderId ? ` · ${c.orderId}` : ""}
                </span>
                <span className="ml-1.5 text-[11px] text-ink-3">
                  raised {formatDate(c.raisedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Timeline events={events} people={people} ticketId={ticket.id} />
    </div>
  );
}

function Fact({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
        {label}
      </dt>
      <dd className="text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * §58.4. One form, one save.
 *
 * The fields, the outcome, the action note and the two touch boxes go together
 * because they are one decision: a ticket does not move status for no reason,
 * and a reason recorded in a second step is a reason that sometimes never gets
 * recorded. The server does the whole thing in one transaction.
 */
function ActionPanel({
  ticket,
  staff,
  masters,
  duplicate,
  backTo,
  nextWorkingDay,
  teacherInstitutes,
}: {
  ticket: TicketDetail;
  staff: Master[];
  masters: { institutes: Master[]; teachers: Master[] };
  duplicate: DuplicateCandidate | null;
  backTo: string | null;
  nextWorkingDay: string | null;
  teacherInstitutes: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [issues, setIssues] = useState<string[]>(ticket.issues_work ?? []);
  const [outcome, setOutcome] = useState<OutcomeId>(
    ticket.status === "new" ? "working" : outcomeIdFor(ticket.status, ticket.escalation_kind),
  );
  const lock = useRef(false);

  // §65.3. What this ticket may become, decided once from where it stands.
  const allowedOutcomes = outcomesFor(ticket.source, ticket.status);
  const chosen = allowedOutcomes.find((o) => o.id === outcome) ?? allowedOutcomes[0];
  const isHandover = chosen.id === "handover";
  // A hand-over clears the date, so asking for one would be asking for something
  // that is about to be thrown away.
  const needsDate = chosen.status !== "resolved" && !isHandover;
  const needsPerson = chosen.kind === "team";
  // §65.3. The picker stays on a hand-over — a counsellor often knows who should
  // look at it — but it is a suggestion recorded in the note, never a required
  // field and never written to escalated_to.
  const showsPerson = needsPerson || isHandover;
  // §61.2. An institute escalation is a claim about a specific institute, so the
  // ticket has to name one. Said here as well as refused by the server, because
  // an error arriving after the save is a worse way to learn it.
  const needsInstitute = chosen.kind === "institute";
  const [instituteId, setInstituteId] = useState<string>(ticket.institute_id ?? "");
  const [teacherId, setTeacherId] = useState<string>(ticket.teacher_id ?? "");
  /**
   * §64.1. Picking a teacher fills the institute from the masters.
   *
   * The grouping is already recorded there — a teacher belongs to the house that
   * sells them — so a ticket naming a teacher and no institute was carrying an
   * answer it could have worked out. Institute stays editable, and changing the
   * teacher again re-fills it: the teacher is the more specific statement, so it
   * wins when it moves.
   */
  function pickTeacher(next: string) {
    setTeacherId(next);
    const derived = next ? teacherInstitutes[next] : null;
    if (derived) setInstituteId(derived);
  }
  /** §64.1. Ticked neither Called nor WhatsApp — asked once, never blocked. */
  const [confirmNoTouch, setConfirmNoTouch] = useState<SavePayload | null>(null);
  /**
   * §64.1. Opens on the next working day rather than blank.
   *
   * A date the team has to type every time is a date that gets skipped, and the
   * answer is nearly always "tomorrow, unless tomorrow is a Sunday or a
   * holiday" — which the database already knows. A date already on the ticket
   * wins: that was somebody's decision.
   */
  const [followUpDate, setFollowUpDate] = useState<string>(
    ticket.follow_up_date ?? nextWorkingDay ?? "",
  );
  const instituteMissing = needsInstitute && !instituteId;
  /**
   * §63.1. The save the user asked for, held while the duplicate question is
   * answered. Held rather than abandoned: whichever way they answer, the outcome
   * they picked is what gets applied — to the parent after a merge, to this
   * ticket after keeping them separate.
   */
  const [askingAbout, setAskingAbout] = useState<SavePayload | null>(null);

  /** The payload both paths share, built once from the form. */
  function payloadFrom(data: FormData): SavePayload {
    return {
        ticketId: ticket.id,
        issues,
        issueOther: String(data.get("issueOther") ?? "").trim() || null,
        instituteId: String(data.get("instituteId") ?? "") || null,
        teacherId: String(data.get("teacherId") ?? "") || null,
        orderIdWork: String(data.get("orderIdWork") ?? "").trim() || null,
        details: String(data.get("details") ?? ""),
        outcome: chosen.status,
        escalationKind: chosen.kind,
        // §65.3. The hand-over is a flag, not a status: the status it lands on is
        // `new`, but unassigning and the event kind are what make it a hand-over.
        handover: chosen.id === "handover",
        followUpDate: String(data.get("followUpDate") ?? "") || null,
        // §65.3. Still sent when handing over: the save records a named person in
        // the note, and nowhere else.
        escalatedTo: String(data.get("escalatedTo") ?? "") || null,
      called: data.get("called") === "on",
      messaged: data.get("messaged") === "on",
    };
  }

  /**
   * §64.1. Where a finished save goes.
   *
   * Back to the queue as it was opened — same tab, filters and page — because a
   * ticket is worked from a list and being dropped on a refreshed New tab means
   * finding your place again every time. The query string was carried in on the
   * link; with none (someone opened the ticket directly) the plain queue is the
   * honest fallback.
   */
  function leave() {
    router.push(backTo ? `/support?${backTo}` : "/support");
  }

  function doSave(payload: SavePayload) {
    lock.current = true;
    setResult(null);
    start(async () => {
      const res = await saveTicketAction(payload);
      setResult(res);
      lock.current = false;
      setConfirmNoTouch(null);
      if (!res.error) leave();
    });
  }

  function submit(form: HTMLFormElement) {
    if (lock.current) return;
    const data = new FormData(form);
    const payload = payloadFrom(data);

    // §63.1. The question comes before the write, so nothing is saved twice and
    // nothing is merged without an answer.
    if (duplicate) {
      setResult(null);
      setAskingAbout(payload);
      return;
    }

    // §64.1. Neither box ticked is usually a slip — the work almost always
    // involved ringing or messaging somebody — so it is worth one question. A
    // nudge, not a rule: plenty of saves are genuinely neither.
    if (!payload.called && !payload.messaged) {
      setResult(null);
      setConfirmNoTouch(payload);
      return;
    }

    doSave(payload);
  }

  /** Merge into #N, or keep separate — then the save either way. */
  function answer(choice: "merge" | "separate") {
    if (!duplicate || !askingAbout || lock.current) return;
    lock.current = true;
    start(async () => {
      const res = await resolveDuplicateThenSave({
        ticketId: ticket.id,
        otherId: duplicate.other_ticket_id,
        choice,
        childId: duplicate.child_id,
        parentId: duplicate.parent_id,
        save: askingAbout,
      });
      setResult(res);
      lock.current = false;
      if (!res.error) {
        setAskingAbout(null);
        // §64.1. Back to the queue either way; the merge is recorded and the
        // parent is where the work now lives, which the queue will show.
        leave();
      }
    });
  }

  return (
    <form
      data-testid="action-panel"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="rounded-lg border border-line bg-surface shadow-card"
    >
      <div className="border-b border-line px-4 py-2 text-[13px] font-semibold text-ink">
        Work this ticket
      </div>

      <div className="grid gap-3 px-4 py-3 md:grid-cols-2">
        <fieldset>
          <legend className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Issue
          </legend>
          <div className="flex flex-col gap-1">
            {ISSUE_OPTIONS.map((o) => (
              <label key={o} className="flex items-center gap-1.5 text-[12px] text-ink-2">
                <input
                  type="checkbox"
                  name="issue"
                  value={o}
                  checked={issues.includes(o)}
                  onChange={() =>
                    setIssues((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))
                  }
                />
                {o}
              </label>
            ))}
          </div>
          <label className="mt-1.5 block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Other
            </span>
            <Input
              name="issueOther"
              aria-label="Other issue text"
              defaultValue={ticket.issue_other_work ?? ""}
              placeholder="Anything not in the five"
            />
          </label>
        </fieldset>

        <div className="flex flex-col gap-2">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Order id
            </span>
            <Input
              name="orderIdWork"
              aria-label="Working order id"
              defaultValue={ticket.order_id_work ?? ticket.order_id ?? ""}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Institute
            </span>
            <Select
              name="instituteId"
              value={instituteId}
              onChange={(e) => setInstituteId(e.target.value)}
              aria-label="Institute"
            >
              <option value="">—</option>
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
            <Select
              name="teacherId"
              value={teacherId}
              onChange={(e) => pickTeacher(e.target.value)}
              aria-label="Teacher"
            >
              <option value="">—</option>
              {masters.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      <div className="grid gap-3 border-t border-line px-4 py-3 md:grid-cols-2">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
Action details <span className="font-normal normal-case tracking-normal text-ink-3">(optional)</span>
          </span>
          <textarea
            name="details"
            aria-label="Action details"
            rows={4}
            placeholder="What was done, and what happens next."
            className="w-full rounded-md border border-line-2 bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Outcome
            </span>
            <Select
              name="outcome"
              aria-label="Outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as OutcomeId)}
            >
              {allowedOutcomes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>

          {instituteMissing ? (
            <p
              data-testid="institute-required"
              className="rounded-md border border-warn/50 bg-warn-soft/40 px-2 py-1 text-[12px] text-ink"
              role="status"
            >
              Set Institute first — an institute escalation has to name one.
            </p>
          ) : null}

          {showsPerson ? (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Escalated to{" "}
                {needsPerson ? (
                  <span className="text-danger">*</span>
                ) : (
                  <span className="font-normal normal-case tracking-normal text-ink-3">
                    — optional, noted only
                  </span>
                )}
              </span>
              <Select
                name="escalatedTo"
                aria-label="Escalated to"
                defaultValue={ticket.escalated_to ?? ""}
                required={needsPerson}
              >
                <option value="">Choose a person</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Follow-up date{" "}
              {needsDate ? (
                <span className="text-danger">*</span>
              ) : (
                <span className="font-normal normal-case tracking-normal text-ink-3">
                  (not needed once resolved)
                </span>
              )}
            </span>
            <Input
              type="date"
              name="followUpDate"
              aria-label="Follow-up date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              required={needsDate}
              disabled={!needsDate}
            />
          </label>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" name="called" aria-label="Called" />
              Called
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" name="messaged" aria-label="WhatsApp sent" />
              WhatsApp sent
            </label>
          </div>
        </div>
      </div>

      {/* §63.1. Asked once per pair, before anything is written. The wording
          turns on whether the two tickets are about the same thing, because
          "same order, same issue" and "same order, different issue" are
          different decisions and a single sentence for both would hide the one
          that needs thought. */}
      {askingAbout && duplicate ? (
        <div
          data-testid="duplicate-dialog"
          role="alertdialog"
          aria-label="Possible duplicate"
          className="mx-4 mb-2 rounded-md border border-warn/60 bg-warn-soft/40 px-3 py-2.5"
        >
          <p className="text-[12.5px] text-ink">
            {duplicate.same_issue ? (
              <>
                Ticket #{duplicate.other_ticket_id} has the same order ID and the
                same issue. Merge this into #{duplicate.parent_id}?
              </>
            ) : (
              <>
                Ticket #{duplicate.other_ticket_id} has the same order ID but a
                different issue (#{duplicate.other_ticket_id}:{" "}
                {issueSummary(duplicate.other_issues, duplicate.other_issue_other)}; this:{" "}
                {issueSummary(issues, null)}). Merge, or keep separate?
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() => answer("merge")}
            >
              {/* The direction is in the label: newer into older, always. */}
              Merge #{duplicate.child_id} into #{duplicate.parent_id}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => answer("separate")}
            >
              Keep separate
            </Button>
            <button
              type="button"
              onClick={() => setAskingAbout(null)}
              className="text-[12px] text-ink-3 underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* §64.1. The nudge. Save anyway is the primary button, because the
          answer is usually yes — this exists to catch the slip, not to argue. */}
      {confirmNoTouch ? (
        <div
          data-testid="no-touch-confirm"
          role="alertdialog"
          aria-label="Nothing ticked"
          className="mx-4 mb-2 rounded-md border border-warn/60 bg-warn-soft/40 px-3 py-2.5"
        >
          <p className="text-[12.5px] text-ink">
            You haven&apos;t marked Called or WhatsApp — save anyway?
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() => doSave(confirmNoTouch)}
            >
              Save anyway
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirmNoTouch(null)}
            >
              Go back
            </Button>
          </div>
        </div>
      ) : null}

      {result?.error ? (
        <div className="px-4 pb-2">
          <ErrorNote>{result.error}</ErrorNote>
        </div>
      ) : null}
      {result?.ok ? (
        <p className="px-4 pb-2 text-[12.5px] text-ok" role="status">
          {result.ok}
        </p>
      ) : null}

      <div className="flex items-center gap-2 border-t border-line bg-sunk px-4 py-2.5">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending || instituteMissing}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <span className="text-[11.5px] text-ink-3">
          One save records the field changes, the outcome, the note and each box
          you ticked.
        </span>
      </div>
    </form>
  );
}

/**
 * §58.4. A touch with no outcome change.
 *
 * Kept as separate buttons because ringing somebody who did not pick up is real
 * work that changes nothing about where the ticket stands — forcing an outcome
 * and a follow-up date for it would make the team either lie or not log it.
 */
function TouchButtons({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<"called" | "messaged" | "note" | null>(null);
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const lock = useRef(false);

  function send(form: HTMLFormElement, kind: "called" | "messaged" | "note") {
    if (lock.current) return;
    lock.current = true;
    const data = new FormData(form);
    setResult(null);
    start(async () => {
      const res = await logTicketTouch({
        ticketId,
        kind,
        note: String(data.get("note") ?? "").trim() || null,
        picked: kind === "called" ? data.get("picked") === "yes" : null,
        channel: kind === "messaged" ? String(data.get("channel") ?? "whatsapp") : null,
      });
      setResult(res);
      lock.current = false;
      if (!res.error) {
        setOpen(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-ink-2">Log a touch without changing the outcome:</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen("called")}>
          Log call
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen("messaged")}>
          Log message
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen("note")}>
          Add note
        </Button>
      </div>

      {open ? (
        <form
          data-testid={`touch-${open}`}
          onSubmit={(e) => {
            e.preventDefault();
            send(e.currentTarget, open);
          }}
          className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-line pt-2.5"
        >
          {open === "called" ? (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Picked up?
              </span>
              <Select name="picked" aria-label="Picked up" defaultValue="yes">
                <option value="yes">Picked</option>
                <option value="no">Not picked</option>
              </Select>
            </label>
          ) : null}
          {open === "messaged" ? (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Channel
              </span>
              <Select name="channel" aria-label="Channel" defaultValue="whatsapp">
                <option value="whatsapp">WhatsApp</option>
                <option value="mail">Mail</option>
                <option value="other">Other</option>
              </Select>
            </label>
          ) : null}
          <label className="block min-w-[260px] flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Note {open === "note" ? <span className="text-danger">*</span> : null}
            </span>
            <Input name="note" aria-label="Touch note" required={open === "note"} />
          </label>
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Log it"}
          </Button>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="text-[12px] text-ink-3 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </form>
      ) : null}

      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result?.ok ? (
        <p className="mt-2 text-[12.5px] text-ok" role="status">
          {result.ok}
        </p>
      ) : null}
    </section>
  );
}

/** §58.4. Merge into… — search open tickets by mobile or order id, then confirm. */
function MergePanel({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<{ id: number; label: string }[] | null>(null);
  const [chosen, setChosen] = useState<{ id: number; label: string } | null>(null);
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const lock = useRef(false);

  function search(form: HTMLFormElement) {
    const q = String(new FormData(form).get("mergeQuery") ?? "");
    setResult(null);
    setChosen(null);
    start(async () => {
      const res = await findMergeTargets({ ticketId, query: q });
      if (res.error) setResult({ error: res.error });
      else setRows(res.rows ?? []);
    });
  }

  function confirm() {
    if (!chosen || lock.current) return;
    lock.current = true;
    start(async () => {
      const res = await mergeTicket({ childId: ticketId, parentId: chosen.id });
      setResult(res);
      lock.current = false;
      if (!res.error) {
        setChosen(null);
        setRows(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-3 shadow-card">
      <form
        data-testid="merge-search"
        onSubmit={(e) => {
          e.preventDefault();
          search(e.currentTarget);
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="block min-w-[240px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Merge into…
          </span>
          <Input name="mergeQuery" aria-label="Merge search" placeholder="Mobile or order id" />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Find open tickets
        </Button>
        <span className="text-[11.5px] text-ink-3">
          This ticket becomes a duplicate of the one you pick.
        </span>
      </form>

      {rows ? (
        rows.length ? (
          <ul className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-[12.5px]">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChosen(r)}
                  className={cx(
                    "text-left underline-offset-2 hover:underline",
                    chosen?.id === r.id ? "font-semibold text-accent" : "text-ink-2",
                  )}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12px] text-ink-3">No open tickets match that.</p>
        )
      ) : null}

      {chosen ? (
        <div
          data-testid="merge-confirm"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn-soft/40 px-3 py-2 text-[12.5px]"
        >
          <span className="text-ink">
            Merge #{ticketId} into {chosen.label}? #{ticketId} leaves the queue and its
            events move to that thread.
          </span>
          <Button type="button" size="sm" variant="primary" disabled={pending} onClick={confirm}>
            {pending ? "Merging…" : "Merge"}
          </Button>
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="text-[12px] text-ink-3 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result?.ok ? (
        <p className="mt-2 text-[12.5px] text-ok" role="status">
          {result.ok}
        </p>
      ) : null}
    </section>
  );
}

/**
 * §64.4. The history, in two blocks.
 *
 * One flat list of every event was unreadable the moment a ticket had a few
 * saves on it: one save writes up to six rows — a field change per field, the
 * status move, the note, a called and a messaged tick — so five saves produced
 * thirty lines and the reader had to reassemble each save in their head.
 *
 * So the writes from one save are grouped into one entry. The grouping key is
 * the actor and the instant: every event in a save is inserted in one
 * transaction, and now() is the transaction time, so they share `at` exactly.
 *
 * Discussion carries what somebody said or decided. Other activity carries the
 * rest — a tick with no note, an assignment, the intake row — collapsed, because
 * it is the record you check rather than the record you read.
 */
type Grouped = {
  key: string;
  at: string;
  actorId: string | null;
  fromTicket: number | null;
  events: TicketEvent[];
};

/** The message channels, as a person reads them. */
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  mail: "Mail",
  other: "Message",
};

const DISCUSSION_KINDS = new Set([
  "note",
  "status_change",
  "resolved",
  "reopened",
  "merged_into",
  "child_merged",
  "counselling_link",
]);

/** A group belongs in Discussion if anything in it was said or decided. */
function isDiscussion(g: Grouped): boolean {
  return g.events.some(
    (e) =>
      DISCUSSION_KINDS.has(e.kind) ||
      // A field change with text in it — a description or an issue — is a
      // decision; one that only moved an id is bookkeeping.
      (e.kind === "field_change" &&
        ["issues_work", "issue_other_work", "description"].includes(
          String(e.detail?.field ?? ""),
        )) ||
      // A tick that carried a note is somebody telling you what was said.
      (["called", "messaged"].includes(e.kind) && Boolean(e.detail?.note)),
  );
}

function groupEvents(events: TicketEvent[], ticketId: number): Grouped[] {
  const out = new Map<string, Grouped>();
  for (const e of events) {
    // A merge writes the same fact twice — `child_merged` on the parent and
    // `merged_into` on the child — and the parent's page reads both, so the
    // merge appeared as two entries saying the same thing. On the parent, keep
    // its own; the child's page still shows the child's, which is all it has.
    if (e.kind === "merged_into" && e.ticket_id !== ticketId) continue;
    const key = `${e.ticket_id}|${e.actor_id ?? "system"}|${e.at}`;
    const g = out.get(key);
    if (g) g.events.push(e);
    else
      out.set(key, {
        key,
        at: e.at,
        actorId: e.actor_id,
        fromTicket: e.ticket_id === ticketId ? null : e.ticket_id,
        events: [e],
      });
  }
  // The query already ordered newest first; Map preserves insertion order.
  return [...out.values()];
}

/** One save, as a sentence: what moved, what was ticked, and what was said. */
function summarise(g: Grouped, people: Record<string, string>): {
  headline: string | null;
  note: string | null;
  ticks: string | null;
  rest: string[];
} {
  const status = g.events.find((e) =>
    ["status_change", "resolved", "reopened"].includes(e.kind),
  );
  const note = g.events.find((e) => e.kind === "note");
  const called = g.events.find((e) => e.kind === "called");
  const messaged = g.events.find((e) => e.kind === "messaged");

  const headline = status
    ? status.kind === "resolved"
      ? "Resolved"
      : status.kind === "reopened"
        ? `Reopened as ${String(status.detail?.new ?? "")}`
        : (() => {
            const d = status.detail ?? {};
            const to =
              d.escalation_kind === "institute"
                ? " → the institute"
                : d.escalated_to
                  ? ` → ${people[String(d.escalated_to)] ?? "someone"}`
                  : "";
            const on = d.follow_up_date ? `, follow up ${String(d.follow_up_date)}` : "";
            return `${String(d.old ?? "")} → ${String(d.new ?? "")}${to}${on}`;
          })()
    : null;

  const ticks = [
    called ? (called.detail?.picked ? "Called" : "Not picked") : null,
    // The stored channel is a lowercase key; this is the line a person reads.
    messaged ? (CHANNEL_LABELS[String(messaged.detail?.channel ?? "")] ?? "Messaged") : null,
  ]
    .filter(Boolean)
    .join(", ") || null;

  // Only the changes a reader would call a decision. A teacher or institute
  // moving is real but it is bookkeeping, and printing it here meant printing
  // raw uuids into the middle of a conversation — those belong to Other activity.
  const rest = g.events
    .filter((e) => e !== status && e !== note && e !== called && e !== messaged)
    .filter(
      (e) =>
        e.kind !== "field_change" ||
        ["issues_work", "issue_other_work", "description"].includes(
          String(e.detail?.field ?? ""),
        ),
    )
    .map((e) => describe(e, people))
    .filter(Boolean);

  return {
    headline,
    note: note ? String(note.detail?.text ?? "") : null,
    ticks,
    rest,
  };
}

function Timeline({
  events,
  people,
  ticketId,
}: {
  events: TicketEvent[];
  people: Record<string, string>;
  ticketId: number;
}) {
  const groups = groupEvents(events, ticketId);
  const discussion = groups.filter(isDiscussion);
  const other = groups.filter((g) => !isDiscussion(g));

  return (
    <>
      <section className="rounded-lg border border-line bg-surface shadow-card">
        <div className="border-b border-line px-4 py-2 text-[13px] font-semibold text-ink">
          Discussion
        </div>
        <ol data-testid="discussion" className="flex flex-col">
          {discussion.map((g) => {
            const s = summarise(g, people);
            return (
              <li
                key={g.key}
                className="border-b border-line px-4 py-2 text-[12.5px] last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[11px] tabular-nums text-ink-3">
                    {formatDateTime(g.at)}
                  </span>
                  <span className="text-[11.5px] font-medium text-ink-2">
                    {g.actorId ? (people[g.actorId] ?? "someone") : "system"}
                  </span>
                  {s.headline ? <Badge tone="neutral">{s.headline}</Badge> : null}
                  {s.ticks ? (
                    <span className="text-[11.5px] text-ink-3">{s.ticks}</span>
                  ) : null}
                  {g.fromTicket ? (
                    <span className="ml-auto text-[11px] text-ink-3">
                      from #{g.fromTicket}
                    </span>
                  ) : null}
                </div>
                {s.note ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-ink">{s.note}</p>
                ) : null}
                {s.rest.map((line, i) => (
                  <p key={i} className="mt-0.5 text-[11.5px] text-ink-2">
                    {line}
                  </p>
                ))}
              </li>
            );
          })}
          {discussion.length === 0 ? (
            <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">
              Nothing said yet.
            </li>
          ) : null}
        </ol>
      </section>

      {other.length ? (
        <details className="rounded-lg border border-line bg-surface shadow-card">
          <summary className="cursor-pointer px-4 py-2 text-[13px] font-semibold text-ink">
            Other activity{" "}
            <span className="font-normal text-ink-3">({other.length})</span>
          </summary>
          <ol data-testid="other-activity" className="flex flex-col border-t border-line">
            {other.map((g) => (
              <li
                key={g.key}
                className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-1.5 text-[12px] last:border-b-0"
              >
                <span className="text-[11px] tabular-nums text-ink-3">
                  {formatDateTime(g.at)}
                </span>
                <span className="text-ink-2">
                  {g.events.map((e) => describe(e, people)).filter(Boolean).join(" · ")}
                </span>
                <span className="ml-auto text-[11px] text-ink-3">
                  {g.actorId ? (people[g.actorId] ?? "someone") : "system"}
                  {g.fromTicket ? ` · from #${g.fromTicket}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}

/** One line of English per event, from its detail. */
function describe(e: TicketEvent, people: Record<string, string>): string {
  const d = e.detail ?? {};
  const s = (k: string) => (d[k] == null ? "" : String(d[k]));
  const who = (k: string) => (d[k] ? (people[String(d[k])] ?? "someone") : "nobody");

  switch (e.kind) {
    case "created":
      return `Raised from ${s("source")}${s("order_id") ? ` for ${s("order_id")}` : ""}.`;
    case "field_change": {
      const field = s("field").replace(/_/g, " ").replace(/ id$/, "");
      const from = d.old == null || d.old === "" ? "nothing" : JSON.stringify(d.old);
      const to = d.new == null || d.new === "" ? "nothing" : JSON.stringify(d.new);
      return `${field}: ${from} → ${to}`;
    }
    case "status_change": {
      // §61.2. "escalated" on its own no longer says enough: the team needs to
      // read which wait this is without opening the ticket.
      const to =
        d.escalation_kind === "institute"
          ? ", to the institute"
          : d.escalated_to
            ? `, to ${who("escalated_to")}`
            : "";
      return `${s("old")} → ${s("new")}${
        s("follow_up_date") ? `, follow up ${s("follow_up_date")}` : ""
      }${to}`;
    }
    case "resolved":
      return "Resolved.";
    case "reopened":
      return `Reopened as ${s("new")}.`;
    case "note":
      return s("text");
    case "called":
      return `${d.picked ? "Picked up" : "Not picked"}${s("note") ? ` — ${s("note")}` : ""}`;
    case "messaged":
      return `${s("channel")}${s("note") ? ` — ${s("note")}` : ""}`;
    case "merged_into":
      return `Merged into #${s("ticket_id")}${d.automatic ? " automatically (same number and order id)" : ""}.`;
    case "child_merged":
      return `#${s("ticket_id")} merged in${d.automatic ? " automatically (same number and order id)" : ""}.`;
    case "counselling_link":
      return `Linked to counselling enquiry #${s("enquiry_id")}.`;
    default:
      return JSON.stringify(d);
  }
}
