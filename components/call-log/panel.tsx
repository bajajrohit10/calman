"use client";

import { useRef, useState, useTransition } from "react";

import { Badge, Button, ErrorNote, Input, Select, Textarea, cx } from "@/components/ui";
import {
  InterestLineRows,
  blankLine,
  isComplete,
  type ItemMaster,
  type NewLine,
  type SubjectMaster,
} from "@/components/interest-lines";
import {
  ISSUE_CATEGORY_LABELS,
  ITEM_STATUS_LABELS,
  IMPORTANCE_LABELS,
  LEAD_VERIFICATION_LABELS,
  OUTCOME_LABELS,
  OUTCOME_SHORT,
  outcomeTone,
  outcomeTakesDate,
  outcomesFor,
  type CallOutcome,
  type EnquiryStatus,
  type EnquiryType,
  type Importance,
  type IssueCategory,
  type LeadVerification,
} from "@/lib/enquiry-labels";
import { EnquiryDetailsEditor } from "@/components/enquiry-details";
import { EnquiryGlanceLine, InterestChips } from "@/components/enquiry-glance";
import { formatDate, formatDateTime, istDatePlus, istNextMonday } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import { WhatsAppButton } from "@/components/whatsapp/button";
import { stageOf } from "@/lib/whatsapp-text";

import { logCall, type LogCallResult, type PanelCall } from "./actions";

export type Master = ItemMaster;
export type { SubjectMaster };

export type PanelMasters = {
  teachers: Master[];
  courses: Master[];
  subjects: SubjectMaster[];
  contents: Master[];
  terms: Master[];
  sources: Master[];
};

export type PanelItem = {
  id: string;
  status: string;
  teacher: string | null;
  course: string | null;
  subject: string | null;
  content: string | null;
};

export type PanelEnquiry = {
  id: number;
  type: EnquiryType;
  studentName: string | null;
  mobile: string;
  term: string | null;
  productText: string | null;
  slotsUsed: number;
  termId: string | null;
  sourceId: string | null;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  /** What the follow-up field opens on; decided by the database (§20.2). */
  defaultFollowUpDate: string | null;
  /** The at-a-glance block and the timeline (§21.2). */
  status: EnquiryStatus;
  sourceNames: string[];
  nextFollowUpDate: string | null;
  reEnquiredAt: string | null;
  createdAt: string;
  timeline: PanelCall[];
  items: PanelItem[];
};

type Decision = { won: boolean; amount: string; close: boolean };

/* -------------------------------------------------------------------------- */

function itemLabel(item: PanelItem) {
  return (
    [item.teacher, item.course, item.subject, item.content].filter(Boolean).join(" · ") ||
    "Untitled interest"
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A drawer inside the panel. `details` rather than state: it holds nothing the
 * form cares about, and a native disclosure survives re-renders that a piece
 * of component state would not.
 */
function PanelDrawer({
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

const TIMELINE_PREVIEW = 10;

/**
 * What has already been said to this student, newest first.
 *
 * Ten is about what fits without pushing the save button off the screen, and
 * is more than anybody reads before dialling; the rest is one click away for
 * the cases where somebody is genuinely reconstructing a story.
 */
function PanelTimeline({ calls }: { calls: PanelCall[] }) {
  const [showAll, setShowAll] = useState(false);

  if (!calls.length) {
    return (
      <div className="border-t border-line px-4 py-2.5 text-[12px] italic text-ink-3">
        No calls on this number yet.
      </div>
    );
  }

  const shown = showAll ? calls : calls.slice(0, TIMELINE_PREVIEW);

  return (
    <section className="border-t border-line px-4 py-2.5">
      <h4 className="mb-1 flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
        Previous calls
        <span className="tabular-nums text-ink-2">{calls.length}</span>
      </h4>
      <ul className="flex flex-col">
        {shown.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line py-1 last:border-b-0"
          >
            <span className="whitespace-nowrap text-[11.5px] font-semibold tabular-nums text-ink">
              {formatDateTime(c.calledAt)}
            </span>
            <Badge dot tone={outcomeTone(c.outcome)}>
              {OUTCOME_SHORT[c.outcome]}
            </Badge>
            <span className="text-[11.5px] text-ink-3">
              {c.callerName ?? "unknown"}
            </span>
            {/* Which enquiry a call belongs to only matters when it is not
                this one — on a re-enquired number that is most of them. */}
            {c.sameEnquiry ? null : (
              <Badge tone="neutral">#{c.enquiryId}</Badge>
            )}
            {c.nextFollowUpDate ? (
              <span className="text-[11.5px] tabular-nums text-ink-3">
                next {formatDate(c.nextFollowUpDate)}
              </span>
            ) : null}
            <span className="w-full whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">
              {c.discussion || <span className="italic text-ink-3">No note</span>}
            </span>
          </li>
        ))}
      </ul>
      {calls.length > TIMELINE_PREVIEW ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 text-[11.5px] text-accent underline-offset-2 hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${calls.length}`}
        </button>
      ) : null}
    </section>
  );
}

export function CallLogPanel({
  enquiry,
  masters,
  counsellorName,
  onSaved,
  onCancel,
}: {
  enquiry: PanelEnquiry;
  masters: PanelMasters;
  /** Fills {counsellor} in a WhatsApp template. */
  counsellorName?: string | null;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isPurchase = enquiry.type === "purchase";
  const openItems = enquiry.items.filter((i) => i.status === "open");

  const [discussion, setDiscussion] = useState("");
  // Graded on the call, not remembered and edited later (Brief 16). Seeded
  // from the enquiry so an unchanged call re-saves what was already there.
  const [importance, setImportance] = useState<Importance | "">(
    enquiry.importance ?? "",
  );
  const [leadVerification, setLeadVerification] = useState<LeadVerification | "">(
    enquiry.leadVerification ?? "",
  );
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [issueCategory, setIssueCategory] = useState<IssueCategory | "">("");
  const [orderId, setOrderId] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // Seeded with one blank row so the table always has something to type into.
  const [newLines, setNewLines] = useState<NewLine[]>(() => [blankLine()]);
  const [askedAboutItems, setAskedAboutItems] = useState(false);
  const [result, setResult] = useState<LogCallResult | null>(null);
  const [pending, startTransition] = useTransition();

  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const firstTeacherRef = useRef<HTMLInputElement | null>(null);

  const purchased = outcome === "purchased";
  const filledLines = newLines.filter(isComplete);
  const tickedCount =
    Object.values(decisions).filter((d) => d.won).length +
    filledLines.filter((l) => l.won).length;

  /**
   * §5.3 save-time prompts. All three rules turn on the same question — will
   * this enquiry still have no interest against it once the call is saved? —
   * but they differ in how hard they push:
   *
   *   purchased  hard block: a sale with no teacher cannot be attributed.
   *   competitor hard block: the whole point of recording a loss is knowing
   *              which teacher lost it.
   *   follow_up  soft prompt: a first conversation that got nowhere is a real
   *              outcome, so it may be saved anyway once asked.
   *   call_back / closed  nothing. Neither says anything about a teacher.
   */
  const willHaveNoItems = enquiry.items.length === 0 && filledLines.length === 0;
  // Purchased is stricter still: there must be something *open* to tick, or a
  // new line to tick, not merely an item somewhere in the history.
  const needsAnItem = purchased && openItems.length === 0 && filledLines.length === 0;
  const blocksSave = needsAnItem || (outcome === "competitor" && willHaveNoItems);
  const softPrompt = outcome === "follow_up" && willHaveNoItems && askedAboutItems;

  function focusInterests() {
    firstTeacherRef.current?.focus();
    firstTeacherRef.current?.scrollIntoView({ block: "center" });
  }

  function decision(id: string): Decision {
    return decisions[id] ?? { won: false, amount: "", close: false };
  }

  function setDecision(id: string, patch: Partial<Decision>) {
    setDecisions((d) => ({ ...d, [id]: { ...decision(id), ...patch } }));
  }

  /** Outcome drives what the rest of the form is asking for. */
  function chooseOutcome(next: CallOutcome | "") {
    setOutcome(next);
    setResult(null);
    // A fresh outcome is a fresh decision: re-ask if the new one wants items.
    setAskedAboutItems(false);
    // Both outcomes that carry a lead forward open on the next working day
    // (§20.2). Call backs used to default to today — "re-tried the same
    // evening" — which was right when the evening was the plan and wrong every
    // time the call came late in the day, because the trigger then pushed the
    // saved date to a working day anyway and the counsellor never saw where it
    // landed. The chips are still there to say otherwise.
    if (next === "call_back" || next === "follow_up") {
      setFollowUpDate(enquiry.defaultFollowUpDate ?? "");
    } else {
      setFollowUpDate("");
    }
    if (next === "purchased" && openItems.length === 0) {
      // Nothing to tick, so whatever gets typed below is what was bought —
      // pre-ticked so the common case is one click, not two.
      setNewLines((lines) => lines.map((l) => ({ ...l, won: true })));
      focusInterests();
    }
    if (next === "competitor" && enquiry.items.length === 0) {
      focusInterests();
    }
  }

  function save() {
    if (pending) return;
    if (blocksSave) {
      focusInterests();
      return;
    }
    // The soft prompt. A second Enter, or the "Save anyway" button, gets past
    // it — one deliberate confirmation, not a dialog to dismiss every time.
    if (outcome === "follow_up" && willHaveNoItems && !askedAboutItems) {
      setAskedAboutItems(true);
      focusInterests();
      return;
    }
    setResult(null);
    startTransition(async () => {
      const res = await logCall({
        enquiryId: enquiry.id,
        outcome,
        discussion,
        nextFollowUpDate: outcomeTakesDate(outcome) ? followUpDate || null : null,
        issueCategory: enquiry.type === "after_sale" ? issueCategory : null,
        importance,
        leadVerification,
        orderId: purchased ? orderId : enquiry.type === "after_sale" ? orderId : null,
        existingItems: openItems.map((i) => ({
          id: i.id,
          won: decision(i.id).won,
          amount: decision(i.id).amount || null,
          close: decision(i.id).close,
        })),
        newItems: filledLines
          .map((l) => ({
            teacherId: l.teacherId,
            courseId: l.courseId,
            subjectId: l.subjectId || null,
            contentId: l.contentId || null,
            won: purchased && l.won,
            amount: l.amount || null,
          })),
      });
      setResult(res);
      if (!res.error) onSaved?.();
    });
  }

  /**
   * §5.3 keyboard flow. Enter saves from anywhere in the panel; Shift+Enter is
   * a newline in the note. A plain textarea cannot honour "Enter to save", and
   * making the note single-line would cost more than it saves.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    const el = e.target as HTMLElement;
    if (el.tagName === "BUTTON") return; // let the button do its own thing
    e.preventDefault();
    save();
  }

  const chips: { label: string; value: string }[] = [
    { label: "Tomorrow", value: istDatePlus(1) },
    { label: "+3 days", value: istDatePlus(3) },
    { label: "+7 days", value: istDatePlus(7) },
    { label: "Next Monday", value: istNextMonday() },
  ];

  return (
    <form
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      // The one panel that is never chrome: a full accent edge and a tinted
      // header lift it off the ground so a counsellor mid-call always knows
      // which box the keystrokes are going into.
      className="rounded-lg border border-accent bg-surface shadow-panel"
    >
      <header className="flex flex-wrap items-center gap-[7px] border-b border-line bg-linear-to-b from-accent-soft to-accent-soft/45 px-3 py-2">
        <span className="text-[13px] font-semibold text-ink">
          {enquiry.studentName || "New student"}
        </span>
        <span className="text-[12.5px] tabular-nums text-ink-2">
          {formatMobile(enquiry.mobile)}
        </span>
        <Badge tone="neutral">#{enquiry.id}</Badge>
        {enquiry.term ? <Badge tone="neutral">{enquiry.term}</Badge> : null}
        <Badge tone={isPurchase ? "info" : "accent"}>
          {isPurchase ? "Purchase" : "After Sale"}
        </Badge>
      </header>

      {/* The at-a-glance block (§21.2), read-only and identical to the one on
          the history card. A counsellor about to speak has three seconds to
          take in who this is; the form below is for afterwards. */}
      <div className="flex flex-col gap-2 border-b border-line px-4 py-2.5">
        <EnquiryGlanceLine
          glance={{
            id: enquiry.id,
            type: enquiry.type,
            status: enquiry.status,
            termName: enquiry.term,
            sourceNames: enquiry.sourceNames,
            importance: enquiry.importance,
            leadVerification: enquiry.leadVerification,
            slotsUsed: enquiry.slotsUsed,
            nextFollowUpDate: enquiry.nextFollowUpDate,
            reEnquiredAt: enquiry.reEnquiredAt,
            createdAt: enquiry.createdAt,
          }}
        />
        <InterestChips items={enquiry.items} />
      </div>

      <div className="flex flex-col gap-3 px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Discussion note
          </span>
          <Textarea
            ref={noteRef}
            autoFocus
            rows={3}
            value={discussion}
            onChange={(e) => setDiscussion(e.target.value)}
            placeholder="What was said. Enter saves, Shift+Enter for a new line."
          />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[230px] flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Outcome
            </span>
            <Select
              value={outcome}
              onChange={(e) => chooseOutcome(e.target.value as CallOutcome | "")}
            >
              <option value="">Choose…</option>
              {outcomesFor(enquiry.type).map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </Select>
          </label>

          {enquiry.type === "after_sale" ? (
            <label className="flex min-w-[180px] flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Issue category
              </span>
              <Select
                value={issueCategory}
                onChange={(e) => setIssueCategory(e.target.value as IssueCategory | "")}
              >
                <option value="">Choose…</option>
                {Object.entries(ISSUE_CATEGORY_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}

          <label className="flex min-w-[210px] flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Importance
            </span>
            <Select
              aria-label="Importance"
              value={importance}
              onChange={(e) => setImportance(e.target.value as Importance | "")}
            >
              <option value="">Not graded</option>
              {Object.entries(IMPORTANCE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex min-w-[190px] flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Lead verification
            </span>
            <Select
              aria-label="Lead verification"
              value={leadVerification}
              onChange={(e) =>
                setLeadVerification(e.target.value as LeadVerification | "")
              }
            >
              <option value="">Not checked</option>
              {Object.entries(LEAD_VERIFICATION_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </label>

          {outcomeTakesDate(outcome) ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                {enquiry.type === "after_sale" ? "Reminder" : "Next follow-up"}
                {outcome === "follow_up" ? " *" : ""}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  type="date"
                  className="w-[150px]"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  aria-label="Next follow-up date"
                />
                {chips.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setFollowUpDate(chip.value)}
                    className={cx(
                      "inline-flex h-[22px] items-center rounded-full border px-2 text-[11.5px]",
                      followUpDate === chip.value
                        ? "border-accent bg-accent font-medium text-accent-ink"
                        : "border-line-2 bg-surface text-ink-2 hover:text-ink",
                    )}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="pb-0.5">
            <WhatsAppButton
              enquiryId={enquiry.id}
              mobile={enquiry.mobile}
              studentName={enquiry.studentName}
              items={enquiry.items}
              term={enquiry.term}
              productText={enquiry.productText}
              counsellorName={counsellorName ?? null}
              stage={stageOf(enquiry.type, enquiry.slotsUsed)}
            />
          </div>
        </div>

        {purchased ? (
          <section className="rounded-md border border-ok/40 bg-ok-soft/40 px-3 py-2.5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                  Order ID *
                </span>
                <Input
                  className="w-[190px]"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  placeholder="ZI-00000"
                  aria-label="Order ID"
                />
              </label>
              <p className="pb-1.5 text-[11.5px] text-ink-3">
                Tick what was bought. Anything left unticked keeps being followed up
                unless you close it.
              </p>
            </div>

            <ul className="mt-2 flex flex-col gap-1.5">
              {openItems.map((item) => {
                const d = decision(item.id);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface px-2 py-1.5"
                  >
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink">
                      <input
                        type="checkbox"
                        checked={d.won}
                        onChange={(e) =>
                          setDecision(item.id, { won: e.target.checked, close: false })
                        }
                      />
                      {itemLabel(item)}
                    </label>

                    {d.won ? (
                      <Input
                        className="ml-auto w-[110px]"
                        inputMode="decimal"
                        placeholder="Amount"
                        aria-label={`Amount for ${itemLabel(item)}`}
                        value={d.amount}
                        onChange={(e) => setDecision(item.id, { amount: e.target.value })}
                      />
                    ) : (
                      <span className="ml-auto flex items-center gap-3 text-[11.5px] text-ink-2">
                        <label className="flex cursor-pointer items-center gap-1">
                          <input
                            type="radio"
                            name={`keep-${item.id}`}
                            checked={!d.close}
                            onChange={() => setDecision(item.id, { close: false })}
                          />
                          keep following
                        </label>
                        <label className="flex cursor-pointer items-center gap-1">
                          <input
                            type="radio"
                            name={`keep-${item.id}`}
                            checked={d.close}
                            onChange={() => setDecision(item.id, { close: true })}
                          />
                          close
                        </label>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {needsAnItem ? (
              <p className="mt-2 text-[12px] text-danger">
                This enquiry has no interests recorded. Add the teacher that was
                bought below — a won enquiry with no teacher against it is invisible
                to the teacher-wise reports.
              </p>
            ) : null}
          </section>
        ) : null}

        {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
        {result && !result.error ? (
          <p className="text-[12.5px] text-ok" role="status">
            {result.ok}
          </p>
        ) : null}

        <div className="flex items-center gap-2 border-t border-line pt-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save call"}
          </Button>
          <span className="text-[11.5px] text-ink-3">
            Enter saves · Shift+Enter for a new line
          </span>
          {purchased ? (
            <span className="ml-auto text-[11.5px] text-ink-3">
              {tickedCount} item{tickedCount === 1 ? "" : "s"} ticked
            </span>
          ) : null}
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {/* What was said to this person before — on this enquiry and on any
          other they have had. A re-enquired number carries its history on the
          rows that came before it, so keying this to the enquiry would show an
          empty list on exactly the leads with the most to read. */}
      <PanelTimeline calls={enquiry.timeline} />

      {/* Below the fold: correcting the record is a different job from making
          the call, and it was taking up the middle of the panel. */}
      <PanelDrawer summary={`Edit interests (${enquiry.items.length})`}>
        <div className="pt-1">
        {/* Interests are a purchase concept: an after-sale enquiry is about an
            order that already exists, so there is nothing to record here.

            Open by default (Brief 8): the teacher on a lead is the one field
            §7 cannot be rebuilt without, and a link nobody clicks records
            nothing. */}
        {isPurchase ? (
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Interests ({enquiry.items.length})
            </h4>

            <div className="mt-1.5 rounded-md border border-line bg-sunk/30 px-3 py-2.5">
              {enquiry.items.length ? (
                <ul className="mb-2 flex flex-col gap-0.5 text-[12px] text-ink-2">
                  {enquiry.items.map((i) => (
                    <li key={i.id} className="flex items-center gap-2">
                      <span>{itemLabel(i)}</span>
                      <Badge tone={i.status === "open" ? "info" : "neutral"}>
                        {ITEM_STATUS_LABELS[i.status as keyof typeof ITEM_STATUS_LABELS] ??
                          i.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}

              <InterestLineRows
                lines={newLines}
                masters={masters}
                showWon={purchased}
                onChange={setNewLines}
                firstFieldRef={firstTeacherRef}
              />
            </div>

            {outcome === "competitor" && willHaveNoItems ? (
              <p className="mt-1.5 text-[12px] text-danger">
                Add the teacher that lost this student before saving — a competitor
                loss with no teacher against it tells the teacher-wise report nothing.
              </p>
            ) : null}

            {softPrompt ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn-soft/40 px-3 py-2">
                <span className="text-[12px] text-ink-2">
                  No interests recorded — add now or save anyway?
                </span>
                <Button type="button" size="sm" variant="secondary" onClick={focusInterests}>
                  Add now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={save}
                >
                  Save anyway
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        </div>
      </PanelDrawer>

      <PanelDrawer summary="Edit enquiry details">
        <EnquiryDetailsEditor
          enquiryId={enquiry.id}
          masters={{ terms: masters.terms, sources: masters.sources }}
          initial={{
            studentName: enquiry.studentName,
            importance: enquiry.importance,
            termId: enquiry.termId,
            sourceId: enquiry.sourceId,
            leadVerification: enquiry.leadVerification,
          }}
        />
      </PanelDrawer>
    </form>
  );
}
