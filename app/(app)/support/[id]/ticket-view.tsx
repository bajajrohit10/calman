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
 * §61.2. The outcome control, where the two escalations are separate choices.
 *
 * The dropdown value carries both the status and the kind, because to the person
 * working the ticket "escalated to the institute" is one decision, not a status
 * plus a follow-up question. The status underneath stays `escalated` for both so
 * the tabs, the queue and every existing query keep working.
 */
const OUTCOMES = [
  { id: "working", label: "Working on it", status: "working", kind: null },
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

/** Which dropdown entry a stored status + kind corresponds to. */
function outcomeIdFor(status: string, kind: string | null): OutcomeId {
  if (status === "escalated") {
    return kind === "institute" ? "escalated_institute" : "escalated_team";
  }
  const hit = OUTCOMES.find((o) => o.status === status && o.kind === null);
  return hit?.id ?? "working";
}

export function TicketView({
  ticket,
  events,
  duplicates,
  people,
  staff,
  masters,
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
        <ActionPanel ticket={ticket} staff={staff} masters={masters} />
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
}: {
  ticket: TicketDetail;
  staff: Master[];
  masters: { institutes: Master[]; teachers: Master[] };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [issues, setIssues] = useState<string[]>(ticket.issues_work ?? []);
  const [outcome, setOutcome] = useState<OutcomeId>(
    ticket.status === "new" ? "working" : outcomeIdFor(ticket.status, ticket.escalation_kind),
  );
  const lock = useRef(false);

  const chosen = OUTCOMES.find((o) => o.id === outcome)!;
  const needsDate = chosen.status !== "resolved";
  const needsPerson = chosen.kind === "team";
  // §61.2. An institute escalation is a claim about a specific institute, so the
  // ticket has to name one. Said here as well as refused by the server, because
  // an error arriving after the save is a worse way to learn it.
  const needsInstitute = chosen.kind === "institute";
  const [instituteId, setInstituteId] = useState<string>(ticket.institute_id ?? "");
  const instituteMissing = needsInstitute && !instituteId;

  function submit(form: HTMLFormElement) {
    if (lock.current) return;
    lock.current = true;
    const data = new FormData(form);
    setResult(null);
    start(async () => {
      const res = await saveTicketAction({
        ticketId: ticket.id,
        issues,
        issueOther: String(data.get("issueOther") ?? "").trim() || null,
        instituteId: String(data.get("instituteId") ?? "") || null,
        teacherId: String(data.get("teacherId") ?? "") || null,
        orderIdWork: String(data.get("orderIdWork") ?? "").trim() || null,
        details: String(data.get("details") ?? ""),
        outcome: chosen.status,
        escalationKind: chosen.kind,
        followUpDate: String(data.get("followUpDate") ?? "") || null,
        escalatedTo: String(data.get("escalatedTo") ?? "") || null,
        called: data.get("called") === "on",
        messaged: data.get("messaged") === "on",
      });
      setResult(res);
      lock.current = false;
      if (!res.error) {
        router.refresh();
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
            <Select name="teacherId" defaultValue={ticket.teacher_id ?? ""} aria-label="Teacher">
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
            Action details <span className="text-danger">*</span>
          </span>
          <textarea
            name="details"
            aria-label="Action details"
            required
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
              {OUTCOMES.map((o) => (
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

          {needsPerson ? (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Escalated to <span className="text-danger">*</span>
              </span>
              <Select
                name="escalatedTo"
                aria-label="Escalated to"
                defaultValue={ticket.escalated_to ?? ""}
                required
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
              defaultValue={ticket.follow_up_date ?? ""}
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

/** Newest first, with who did it and when. Children's events are folded in. */
function Timeline({
  events,
  people,
  ticketId,
}: {
  events: TicketEvent[];
  people: Record<string, string>;
  ticketId: number;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card">
      <div className="border-b border-line px-4 py-2 text-[13px] font-semibold text-ink">
        History
      </div>
      <ol data-testid="timeline" className="flex flex-col">
        {events.map((e) => (
          <li
            key={`${e.ticket_id}-${e.id}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line px-4 py-2 text-[12.5px] last:border-b-0"
          >
            <span className="text-[11px] tabular-nums text-ink-3">
              {formatDateTime(e.at)}
            </span>
            <Badge tone="neutral">{e.kind.replace(/_/g, " ")}</Badge>
            <span className="text-ink-2">{describe(e, people)}</span>
            <span className="ml-auto text-[11px] text-ink-3">
              {e.actor_id ? (people[e.actor_id] ?? "someone") : "system"}
              {e.ticket_id !== ticketId ? ` · from #${e.ticket_id}` : ""}
            </span>
          </li>
        ))}
        {events.length === 0 ? (
          <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">
            Nothing recorded yet.
          </li>
        ) : null}
      </ol>
    </section>
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
