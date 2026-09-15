"use client";

import { useRef, useState, useTransition } from "react";

import { Badge, Button, ErrorNote, Input, Select, Textarea, cx } from "@/components/ui";
import {
  InterestLineRows,
  LineFields,
  SavedLineRows,
  TeacherPicker,
  blankLine,
  hasDetail,
  type ItemMaster,
  type NewLine,
  type SubjectMaster,
} from "@/components/interest-lines";
import {
  ISSUE_CATEGORY_LABELS,
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
import {
  formatDate,
  formatDateTime,
  istDatePlus,
  istNextMonday,
  istToday,
} from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import { useUnsavedClaim } from "@/components/unsaved-guard";
import { WhatsAppButton } from "@/components/whatsapp/button";
import { stageOf } from "@/lib/whatsapp-text";

import {
  logCall,
  removeEnquiryItem,
  updateEnquiryItem,
  type LogCallResult,
  type PanelCall,
} from "./actions";
import { EditCallForm, canEditCall } from "./edit-call";

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
  /** §39.3: the drawer edits the line in place, so it needs the ids too. */
  teacherId: string | null;
  courseId: string | null;
  subjectId: string | null;
  contentId: string | null;
  teacher: string | null;
  course: string | null;
  subject: string | null;
  content: string | null;
};

export type PanelEnquiry = {
  id: number;
  type: EnquiryType;
  /** What this ticket is already about (§26.1); null on a purchase enquiry. */
  issueCategory?: IssueCategory | null;
  /** §44.1: what the ticket itself carries, not what a call once mentioned. */
  orderId?: string | null;
  teacherId?: string | null;
  escalatedTo?: string | null;
  /** §29.4: who is looking, and whether they may correct anybody's call. */
  viewerId?: string | null;
  viewerIsAdmin?: boolean;
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

/** The chip that is the Course/Subject/Content boxes rather than a saved row. */
const DEFAULTS_KEY = "__defaults__";

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
  open,
  warn,
  children,
}: {
  summary: string;
  /** §29.2: open on arrival, for the one case that cannot wait. */
  open?: boolean;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      className={cx(
        "group border-t",
        warn ? "border-warn/50 bg-warn-soft/30" : "border-line",
      )}
    >
      <summary
        className={cx(
          "cursor-pointer list-none px-3 py-1.5 text-[12px]",
          warn ? "font-medium text-warn" : "text-ink-2 hover:text-ink",
        )}
      >
        <span className="inline-block w-3 text-ink-3 group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="px-3 pb-2.5">{children}</div>
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
function PanelTimeline({
  calls,
  type,
  importance,
  leadVerification,
  viewerId,
  viewerIsAdmin,
  onEdited,
}: {
  calls: PanelCall[];
  type: EnquiryType;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  viewerId?: string | null;
  viewerIsAdmin?: boolean;
  onEdited?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  if (!calls.length) {
    return (
      <div className="border-t border-line px-3 py-2 text-[12px] italic text-ink-3">
        No calls on this number yet.
      </div>
    );
  }

  const shown = showAll ? calls : calls.slice(0, TIMELINE_PREVIEW);

  return (
    <section className="border-t border-line px-3 py-2">
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
            {/* §29.4. Offered only where the database would allow it, so the
                button is not a promise the write has to break. */}
            {canEditCall(c, viewerId, viewerIsAdmin) && editing !== c.id ? (
              <button
                type="button"
                onClick={() => setEditing(c.id)}
                className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
              >
                Edit
              </button>
            ) : null}
            <span className="w-full whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">
              {c.discussion || <span className="italic text-ink-3">No note</span>}
            </span>
            {editing === c.id ? (
              <div className="w-full pt-1">
                <EditCallForm
                  call={{
                    id: c.id,
                    outcome: c.outcome,
                    discussion: c.discussion,
                    nextFollowUpDate: c.nextFollowUpDate,
                  }}
                  type={type}
                  importance={importance}
                  leadVerification={leadVerification}
                  onDone={(changed: boolean) => {
                    setEditing(null);
                    if (changed) onEdited?.();
                  }}
                />
              </div>
            ) : null}
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
  roster,
  onSaved,
  onCancel,
}: {
  enquiry: PanelEnquiry;
  masters: PanelMasters;
  /** Fills {counsellor} in a WhatsApp template. */
  counsellorName?: string | null;
  /** §44.2: who a ticket can be escalated to. */
  roster?: { id: string; name: string }[];
  /**
   * The note carries the one thing the counsellor has to be told after the
   * panel closes: §23.5 can move a call onto a new enquiry, and a row
   * silently becoming a different row is worse than no message at all.
   */
  onSaved?: (note?: string) => void;
  onCancel?: () => void;
}) {
  const isPurchase = enquiry.type === "purchase";
  /**
   * §39.3 edits a saved line from inside the panel, and the write lands the
   * moment Save is pressed rather than waiting for the call. The panel is
   * handed its enquiry by whichever screen opened it, so the corrected line is
   * kept here as well — the chip has to change under the counsellor's hand,
   * and re-fetching the whole enquiry to move one word would blank the form
   * they are still typing into.
   */
  const [items, setItems] = useState<PanelItem[]>(enquiry.items);
  const [itemBusy, setItemBusy] = useState<string | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const openItems = items.filter((i) => i.status === "open");

  const [discussion, setDiscussion] = useState("");
  // Graded on the call, not remembered and edited later (Brief 16). Seeded
  // from the enquiry so an unchanged call re-saves what was already there.
  const [importance, setImportance] = useState<Importance | "">(
    enquiry.importance ?? "",
  );
  const [leadVerification, setLeadVerification] = useState<LeadVerification | "">(
    enquiry.leadVerification ?? "",
  );
  const [outcomeState, setOutcome] = useState<CallOutcome | "">("");
  const outcome = outcomeState;
  const [followUpDate, setFollowUpDate] = useState("");
  // Pre-chosen from the ticket (§26.1): the category is a property of the
  // problem, not of each call about it, and asking again every time was what
  // stopped tickets being closed.
  const [issueCategory, setIssueCategory] = useState<IssueCategory | "">(
    enquiry.issueCategory ?? "",
  );
  /**
   * §25. The counsellor rang expecting a sales call and found somebody whose
   * videos will not play. Flipping this makes the rest of the panel behave as
   * though the enquiry were after-sale — it is about to become one — so the
   * outcome list, the issue category and the purchase-only gradings all follow
   * one switch rather than each being remembered separately.
   */
  const [toAfterSale, setToAfterSale] = useState(false);
  /** §38.2: the same switch from the after-sale side. */
  const [toPurchase, setToPurchase] = useState(false);
  const asAfterSale =
    (enquiry.type === "after_sale" || toAfterSale) && !toPurchase;
  const [orderId, setOrderId] = useState(enquiry.orderId ?? "");
  /** §44.1. The ticket's own product and teacher; the institute follows. */
  const [ticketProduct, setTicketProduct] = useState(enquiry.productText ?? "");
  const [ticketTeacher, setTicketTeacher] = useState(enquiry.teacherId ?? "");
  /** §44.2. Escalated is the one state that needs a name attached. */
  const [escalatedTo, setEscalatedTo] = useState(enquiry.escalatedTo ?? "");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // Seeded with one blank row so the table always has something to type into.
  const [newLines, setNewLines] = useState<NewLine[]>(() => [blankLine()]);

  /**
   * §26.2. A first call is one where *this enquiry* has never been called. A
   * re-enquired number with history keeps the compact panel, because there is
   * history worth reading; this lead has none, so there is nothing to glance
   * at and everything to fill in.
   */
  const isFirstCall = !enquiry.timeline.some((c) => c.sameEnquiry);
  /** A follow-up on a purchase lead that still has nothing recorded (§29.2). */
  const needsInterests =
    !isFirstCall && enquiry.type === "purchase" && items.length === 0;
  const [studentName, setStudentName] = useState(enquiry.studentName ?? "");
  const [termId, setTermId] = useState(enquiry.termId ?? "");
  const [sourceId, setSourceId] = useState(enquiry.sourceId ?? "");
  const [teacherQuery, setTeacherQuery] = useState("");
  // The defaults every teacher picked after them inherits. Changing one does
  // not rewrite lines already added — a counsellor who adjusted a line meant
  // it — so each chip can still be edited on its own below.
  const [defCourse, setDefCourse] = useState("");
  const [defSubject, setDefSubject] = useState("");
  const [defContent, setDefContent] = useState("");

  const teacherMatches = (() => {
    const q = teacherQuery.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(newLines.map((l) => l.teacherId));
    return masters.teachers
      .filter((t) => t.name.toLowerCase().includes(q) && !taken.has(t.id))
      .slice(0, 6);
  })();

  /**
   * The course, subject and content the counsellor chose, when they named no
   * teacher at all.
   *
   * These three boxes are defaults for each teacher line, and a line was only
   * ever born from picking a teacher — so "CA Final · FR" and nothing else
   * produced no line, no chip, and a call that saved with the two facts the
   * counsellor had learned thrown away. §39.2 made a teacher-less line legal
   * everywhere else; this is what makes it reachable here. With a teacher
   * line on screen the three boxes are baked into it and this is nothing.
   */
  const defaultsLine: NewLine | null =
    !newLines.some(hasDetail) && (defCourse || defSubject || defContent)
      ? {
          key: DEFAULTS_KEY,
          teacherId: "",
          courseId: defCourse,
          subjectId: defSubject,
          contentId: defContent,
          won: false,
          amount: "",
        }
      : null;

  /** Editing that chip is editing the three boxes it is made of. */
  function editDefaults(patch: Partial<NewLine>) {
    // A teacher named on it is not an edit: it turns the defaults into a real
    // line, which is what addTeacher already builds out of them.
    if (patch.teacherId) {
      addTeacher(patch.teacherId);
      return;
    }
    if ("courseId" in patch) {
      setDefCourse(patch.courseId ?? "");
      setDefSubject("");
    }
    if ("subjectId" in patch) setDefSubject(patch.subjectId ?? "");
    if ("contentId" in patch) setDefContent(patch.contentId ?? "");
  }

  function addTeacher(id: string) {
    setNewLines((lines) => [
      ...lines.filter((l) => hasDetail(l)),
      {
        ...blankLine(),
        teacherId: id,
        courseId: defCourse,
        subjectId: defSubject,
        contentId: defContent,
      },
    ]);
    setTeacherQuery("");
  }
  /**
   * §39.3. A saved line corrected in place, written straight away.
   *
   * Not folded into the call save: the line belongs to the lead, not to this
   * call, and a counsellor who spots that the content is wrong should not have
   * to finish and save a call to fix it. The local copy is patched from the
   * masters rather than re-fetched, so the chip changes as they watch.
   */
  function saveItem(id: string, line: NewLine) {
    setItemError(null);
    setItemBusy(id);
    startTransition(async () => {
      const res = await updateEnquiryItem({
        itemId: id,
        teacherId: line.teacherId || null,
        courseId: line.courseId || null,
        subjectId: line.subjectId || null,
        contentId: line.contentId || null,
      });
      setItemBusy(null);
      if (res.error) {
        setItemError(res.error);
        return;
      }
      const nameIn = (list: { id: string; name: string }[], id: string) =>
        list.find((x) => x.id === id)?.name ?? null;
      setItems((all) =>
        all.map((i) =>
          i.id === id
            ? {
                ...i,
                teacherId: line.teacherId || null,
                courseId: line.courseId || null,
                subjectId: line.subjectId || null,
                contentId: line.contentId || null,
                teacher: nameIn(masters.teachers, line.teacherId),
                course: nameIn(masters.courses, line.courseId),
                subject: nameIn(masters.subjects, line.subjectId),
                content: nameIn(masters.contents, line.contentId),
              }
            : i,
        ),
      );
    });
  }

  /** Closed, never deleted (§39.3) — the reasoning is in the server action. */
  function dropItem(id: string) {
    setItemError(null);
    setItemBusy(id);
    startTransition(async () => {
      const res = await removeEnquiryItem({ itemId: id });
      setItemBusy(null);
      if (res.error) {
        setItemError(res.error);
        return;
      }
      setItems((all) => all.map((i) => (i.id === id ? { ...i, status: "closed" } : i)));
      // A line that is no longer open cannot carry a decision from this call.
      setDecisions((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
    });
  }

  const [askedAboutItems, setAskedAboutItems] = useState(false);
  const [result, setResult] = useState<LogCallResult | null>(null);
  const [pending, startTransition] = useTransition();

  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const firstTeacherRef = useRef<HTMLInputElement | null>(null);
  const issueRef = useRef<HTMLSelectElement | null>(null);

  const purchased = outcome === "purchased";
  /**
   * What the call will write. The defaults line stands in when nobody named a
   * teacher, so it counts everywhere a line counts: what gets saved, whether
   * this enquiry will still have no interest against it, and the prompts that
   * turn on that question.
   */
  const filledLines = defaultsLine
    ? [...newLines.filter(hasDetail), defaultsLine]
    : newLines.filter(hasDetail);
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
  const willHaveNoItems = items.length === 0 && filledLines.length === 0;
  // Purchased is stricter still: there must be something *open* to tick, or a
  // new line to tick, not merely an item somewhere in the history.
  const needsAnItem = purchased && openItems.length === 0 && filledLines.length === 0;
  const blocksSave = needsAnItem || (outcome === "competitor" && willHaveNoItems);
  const softPrompt = outcome === "follow_up" && willHaveNoItems && askedAboutItems;
  /**
   * §33.2. A ticket without an issue type cannot be saved, and the server has
   * always refused it — but it refused into an error line below the fold,
   * which is how "tickets cannot be closed" became a bug report in Brief 26.
   * The refusal happens here now, on the field itself, so the thing that is
   * wrong is the thing you are looking at.
   */
  const needsIssue = asAfterSale && !issueCategory;
  const [issueAsked, setIssueAsked] = useState(false);
  /**
   * §44.1. The order id is the first thing an institute asks for, and a ticket
   * without one is a ticket nobody can chase. Refused on the field, in the
   * same amber as the issue category, for the same reason: the thing that is
   * wrong should be the thing you are looking at.
   */
  const needsOrderId = asAfterSale && !orderId.trim();
  const [orderAsked, setOrderAsked] = useState(false);
  const orderRef = useRef<HTMLInputElement | null>(null);
  /** §44.2. Escalating without saying to whom is not escalating. */
  const needsEscalatee = asAfterSale && outcome === "escalated" && !escalatedTo;
  const [escalateeAsked, setEscalateeAsked] = useState(false);
  const escalateeRef = useRef<HTMLSelectElement | null>(null);

  function focusOrder() {
    setOrderAsked(true);
    orderRef.current?.focus();
    orderRef.current?.scrollIntoView({ block: "center" });
  }

  /** One bundle, so both layouts are handed exactly the same fields. */
  const ticketFields: TicketFieldsProps = {
    asAfterSale,
    outcome,
    orderId,
    setOrderId,
    needsOrderId,
    orderAsked,
    orderRef,
    ticketProduct,
    setTicketProduct,
    ticketTeacher,
    setTicketTeacher,
    escalatedTo,
    setEscalatedTo,
    needsEscalatee,
    escalateeAsked,
    escalateeRef,
    masters,
    roster,
  };

  function focusEscalatee() {
    setEscalateeAsked(true);
    escalateeRef.current?.focus();
    escalateeRef.current?.scrollIntoView({ block: "center" });
  }

  function focusIssue() {
    setIssueAsked(true);
    issueRef.current?.focus();
    issueRef.current?.scrollIntoView({ block: "center" });
  }

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
    } else if (next === "noted") {
      // §33.4. A ticket's reminder is today, not the next working day. A
      // purchase lead is a thing to do next; an unresolved complaint is a
      // thing to do now, and dating it tomorrow was how a ticket raised this
      // morning disappeared from this morning's queue. It carries itself
      // forward from here — nothing is date-bound until it is resolved — and
      // the chips are still there to say "not until Friday".
      setFollowUpDate(istToday());
    } else {
      setFollowUpDate("");
    }
    if (next === "purchased" && openItems.length === 0) {
      // Nothing to tick, so whatever gets typed below is what was bought —
      // pre-ticked so the common case is one click, not two.
      setNewLines((lines) => lines.map((l) => ({ ...l, won: true })));
      focusInterests();
    }
    if (next === "competitor" && items.length === 0) {
      focusInterests();
    }
  }

  /**
   * §27.4. What "unsaved" means here: anything typed that a save would keep.
   * The note is the expensive part, but a chosen outcome, a picked teacher or
   * an edited name are all work somebody did and would have to do again.
   */
  useUnsavedClaim({
    isDirty: () =>
      discussion.trim().length > 0 ||
      outcomeState !== "" ||
      newLines.some(hasDetail) ||
      (isFirstCall &&
        (studentName !== (enquiry.studentName ?? "") ||
          termId !== (enquiry.termId ?? "") ||
          sourceId !== (enquiry.sourceId ?? "") ||
          importance !== (enquiry.importance ?? "") ||
          leadVerification !== (enquiry.leadVerification ?? ""))),
    save: async () => {
      const res = await saveNow();
      return !res?.error;
    },
    discard: () => {
      setDiscussion("");
      setOutcome("");
      setNewLines([blankLine()]);
    },
  });

  function save(forced?: CallOutcome) {
    const outcome = forced ?? outcomeState;
    if (pending) return;
    // Before anything else: Close ticket is a save too, and closing a ticket
    // nobody ever categorised is exactly how a queue loses its shape.
    if (needsIssue) {
      focusIssue();
      return;
    }
    if (needsOrderId) {
      focusOrder();
      return;
    }
    if (asAfterSale && outcome === "escalated" && !escalatedTo) {
      focusEscalatee();
      return;
    }
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
      await saveNow(forced);
    });
  }

  /** The save itself, awaitable — the guard needs to know whether it worked. */
  async function saveNow(forced?: CallOutcome) {
    const outcome = forced ?? outcomeState;
    {
      const res = await logCall({
        enquiryId: enquiry.id,
        outcome,
        discussion,
        nextFollowUpDate: outcomeTakesDate(outcome) ? followUpDate || null : null,
        issueCategory: asAfterSale ? issueCategory : null,
        ...(asAfterSale
          ? {
              ticketOrderId: orderId.trim() || null,
              ticketProduct: ticketProduct.trim() || null,
              ticketTeacherId: ticketTeacher || null,
              escalatedTo: outcome === "escalated" ? escalatedTo || null : undefined,
            }
          : {}),
        convertToAfterSale: toAfterSale,
        convertToPurchase: toPurchase,
        ...(isFirstCall
          ? { studentName, termId: termId || null, sourceId: sourceId || null }
          : {}),
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
      if (!res.error) onSaved?.(res.reopenedAs ? (res.ok ?? undefined) : undefined);
      return res;
    }
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
    // A ticket can want to be looked at again today; a lead never does.
    ...(asAfterSale ? [{ label: "Today", value: istToday() }] : []),
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
          take in who this is; the form below is for afterwards. Skipped on a
          first call, where every one of those facts is blank and the form
          below is where they get filled in (§26.2). */}
      <div className={cx("flex-col gap-1.5 border-b border-line px-3 py-2", isFirstCall ? "hidden" : "flex")}>
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
        <InterestChips items={items} />
      </div>

      {/* §44 fix. This used to live inside the compact branch, so a first
          call whose save the server refused showed nothing at all — the panel
          simply sat there. The refusal is the most important thing on the
          screen at that moment, and it belongs to both layouts. */}
      {result?.error || result?.ok ? (
        <div className="px-3 pt-2">
          {result.error ? (
            <ErrorNote>{result.error}</ErrorNote>
          ) : (
            <p className="text-[12.5px] text-ok" role="status">
              {result.ok}
            </p>
          )}
        </div>
      ) : null}

      {isFirstCall ? (
        <FirstCallFields
          masters={masters}
          studentName={studentName}
          setStudentName={setStudentName}
          isPurchase={isPurchase}
          onType={(next) => {
            setToAfterSale(next);
            setOutcome("");
          }}
          defCourse={defCourse}
          setDefCourse={setDefCourse}
          defSubject={defSubject}
          setDefSubject={setDefSubject}
          defContent={defContent}
          setDefContent={setDefContent}
          teacherQuery={teacherQuery}
          setTeacherQuery={setTeacherQuery}
          teacherMatches={teacherMatches}
          addTeacher={addTeacher}
          lines={defaultsLine ? [...newLines, defaultsLine] : newLines}
          removeLine={(key) => {
            if (key === DEFAULTS_KEY) {
              setDefCourse("");
              setDefSubject("");
              setDefContent("");
              return;
            }
            setNewLines((l) => l.filter((x) => x.key !== key));
          }}
          editLine={(key, patch) => {
            if (key === DEFAULTS_KEY) {
              editDefaults(patch);
              return;
            }
            setNewLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));
          }}
          savedLines={items}
          onSaveSaved={saveItem}
          onRemoveSaved={dropItem}
          savedBusy={itemBusy}
          savedError={itemError}
          termId={termId}
          setTermId={setTermId}
          sourceId={sourceId}
          setSourceId={setSourceId}
          dateChips={chips}
          importance={importance}
          setImportance={setImportance}
          leadVerification={leadVerification}
          setLeadVerification={setLeadVerification}
          discussion={discussion}
          setDiscussion={setDiscussion}
          noteRef={noteRef}
          outcome={outcome}
          chooseOutcome={chooseOutcome}
          asAfterSale={asAfterSale}
          issueCategory={issueCategory}
          setIssueCategory={setIssueCategory}
          issueRef={issueRef}
          issueAsked={issueAsked}
          needsIssue={needsIssue}
          ticketFields={ticketFields}
          followUpDate={followUpDate}
          setFollowUpDate={setFollowUpDate}
          pending={pending}
          onCancel={onCancel}
        />
      ) : null}

      {isFirstCall ? null : (
      <div className="flex flex-col gap-2.5 px-3 py-2.5">
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
          {/* §25, rewritten by §38. Above the outcome because it changes what
              the outcomes are: a counsellor who rang about a sale and found a
              problem flips this first and the rest of the form follows. It no
              longer converts anything — the two conversations coexist — so the
              sentence is now the same whatever state this enquiry is in. */}
          {isPurchase ? (
            <label className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-line-2 bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink-2">
              <input
                type="checkbox"
                checked={toAfterSale}
                onChange={(e) => {
                  setToAfterSale(e.target.checked);
                  // The outcome sets do not overlap, so a half-chosen sales
                  // outcome would sit there invalid and be submitted by Enter.
                  setOutcome("");
                }}
              />
              <span>
                This is an <strong className="text-ink">after-sale</strong> call
              </span>
              {toAfterSale ? (
                <span className="text-[11.5px] text-ink-3">
                  Saving opens a separate ticket; the purchase enquiry stays as
                  it is.
                </span>
              ) : null}
            </label>
          ) : null}

          {/* §38.2. The mirror, which never existed: somebody rings about a
              delivery and asks what is coming for the next paper. The ticket
              is not finished and must not be touched. */}
          {enquiry.type === "after_sale" ? (
            <label className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-line-2 bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink-2">
              <input
                type="checkbox"
                checked={toPurchase}
                onChange={(e) => {
                  setToPurchase(e.target.checked);
                  setOutcome("");
                }}
              />
              <span>
                This is a <strong className="text-ink">purchase</strong> enquiry
              </span>
              {toPurchase ? (
                <span className="text-[11.5px] text-ink-3">
                  Saving logs this on the student&apos;s purchase enquiry — the
                  open one if they have it, a new one if not. The ticket stays
                  as it is.
                </span>
              ) : null}
            </label>
          ) : null}

          <label className="flex min-w-[230px] flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Outcome
            </span>
            <Select
              value={outcome}
              onChange={(e) => chooseOutcome(e.target.value as CallOutcome | "")}
            >
              <option value="">Choose…</option>
              {outcomesFor(asAfterSale ? "after_sale" : "purchase").map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </Select>
          </label>

          {asAfterSale ? (
            <label className="flex min-w-[180px] flex-col gap-1">
              <span
                className={cx(
                  "text-[10px] font-semibold uppercase tracking-[0.045em]",
                  issueAsked && needsIssue ? "text-warn" : "text-ink-3",
                )}
              >
                Issue category
              </span>
              <Select
                ref={issueRef}
                aria-label="Issue category"
                aria-invalid={issueAsked && needsIssue ? true : undefined}
                className={
                  issueAsked && needsIssue ? "border-warn bg-warn-soft/40" : undefined
                }
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
              {issueAsked && needsIssue ? (
                <span role="alert" className="text-[11.5px] font-medium text-warn">
                  Choose an issue type to save this ticket
                </span>
              ) : null}
            </label>
          ) : null}

          <TicketFields {...ticketFields} />

          <label className={cx("min-w-[210px] flex-col gap-1", asAfterSale ? "hidden" : "flex")}>
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

          <label className={cx("min-w-[190px] flex-col gap-1", asAfterSale ? "hidden" : "flex")}>
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
              items={items}
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


        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save call"}
          </Button>
          {/* §26.1. A ticket's status is derived from its last outcome, so
              these are ordinary calls with the outcome chosen for you — not a
              second way of setting status that could disagree with the first.
              The note still goes with them. */}
          {asAfterSale && enquiry.status !== "closed" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => save("resolved")}
            >
              Close ticket
            </Button>
          ) : null}
          {asAfterSale && enquiry.status === "closed" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => save("noted")}
            >
              Reopen ticket
            </Button>
          ) : null}
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
      )}

      {/* What was said to this person before — on this enquiry and on any
          other they have had. A re-enquired number carries its history on the
          rows that came before it, so keying this to the enquiry would show an
          empty list on exactly the leads with the most to read. */}
      {isFirstCall ? null : (
        <PanelTimeline
          calls={enquiry.timeline}
          type={enquiry.type}
          importance={enquiry.importance}
          leadVerification={enquiry.leadVerification}
          viewerId={enquiry.viewerId}
          viewerIsAdmin={enquiry.viewerIsAdmin}
          onEdited={onSaved}
        />
      )}

      {/* Below the fold: correcting the record is a different job from making
          the call, and it was taking up the middle of the panel. */}
      {/* §29.2. A purchase lead with no teacher on it is the one thing that
          cannot be corrected later from the reports — teacher-wise analytics
          simply never see it. So the drawer is open on arrival and says why,
          rather than sitting closed behind a count of zero. Focus stays in the
          note: the counsellor is listening to somebody, and the interests are
          filled in from what they say. */}
      {isFirstCall ? null : (
      <PanelDrawer
        summary={
          needsInterests
            ? "No teacher/course recorded — add before saving"
            : `Edit interests (${items.length})`
        }
        open={needsInterests}
        warn={needsInterests}
      >
        <div className="pt-1">
        {/* Interests are a purchase concept: an after-sale enquiry is about an
            order that already exists, so there is nothing to record here.

            Open by default (Brief 8): the teacher on a lead is the one field
            §7 cannot be rebuilt without, and a link nobody clicks records
            nothing. */}
        {isPurchase ? (
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              Interests ({items.length})
            </h4>

            <div className="mt-1.5 rounded-md border border-line bg-sunk/30 px-3 py-2.5">
              {items.length ? (
                <div className="mb-2">
                  <SavedLineRows
                    lines={items}
                    masters={masters}
                    onSave={saveItem}
                    onRemove={dropItem}
                    busy={itemBusy}
                  />
                  {itemError ? (
                    <p className="mt-1 text-[12px] text-danger">{itemError}</p>
                  ) : null}
                </div>
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
                  onClick={() => save()}
                >
                  Save anyway
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        </div>
      </PanelDrawer>
      )}

      {isFirstCall ? null : (
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
      )}
    </form>
  );
}

/**
 * The first-call layout (§26.2).
 *
 * Everything on one screen, in the order the conversation goes: who they are,
 * what they want, how good the lead is, what was said, what happens next. No
 * drawers — a lead nobody has spoken to has nothing to hide behind one, and
 * "Edit interests" being a click away is why leads used to reach the second
 * call with no teacher on them.
 *
 * Three columns at ≥1280 and two at ≥768, which puts the whole form inside a
 * 1440×900 window without scrolling; one column below that.
 */
function FirstCallFields({
  masters,
  studentName,
  setStudentName,
  isPurchase,
  onType,
  defCourse,
  setDefCourse,
  defSubject,
  setDefSubject,
  defContent,
  setDefContent,
  teacherQuery,
  setTeacherQuery,
  teacherMatches,
  addTeacher,
  lines,
  removeLine,
  editLine,
  savedLines,
  onSaveSaved,
  onRemoveSaved,
  savedBusy,
  savedError,
  termId,
  setTermId,
  sourceId,
  setSourceId,
  dateChips,
  importance,
  setImportance,
  leadVerification,
  setLeadVerification,
  discussion,
  setDiscussion,
  noteRef,
  outcome,
  chooseOutcome,
  asAfterSale,
  ticketFields,
  issueCategory,
  setIssueCategory,
  issueRef,
  issueAsked,
  needsIssue,
  followUpDate,
  setFollowUpDate,
  pending,
  onCancel,
}: {
  masters: PanelMasters;
  studentName: string;
  setStudentName: (v: string) => void;
  isPurchase: boolean;
  onType: (afterSale: boolean) => void;
  defCourse: string;
  setDefCourse: (v: string) => void;
  defSubject: string;
  setDefSubject: (v: string) => void;
  defContent: string;
  setDefContent: (v: string) => void;
  teacherQuery: string;
  setTeacherQuery: (v: string) => void;
  teacherMatches: { id: string; name: string }[];
  addTeacher: (id: string) => void;
  lines: NewLine[];
  removeLine: (key: string) => void;
  /** §39.3: a chip is a line, and a line is correctable where it sits. */
  editLine: (key: string, patch: Partial<NewLine>) => void;
  /** Lines already in the database — an imported lead can arrive with some. */
  savedLines: PanelItem[];
  onSaveSaved: (id: string, line: NewLine) => void;
  onRemoveSaved: (id: string) => void;
  savedBusy: string | null;
  savedError: string | null;
  termId: string;
  setTermId: (v: string) => void;
  sourceId: string;
  setSourceId: (v: string) => void;
  dateChips: { label: string; value: string }[];
  importance: Importance | "";
  setImportance: (v: Importance | "") => void;
  leadVerification: LeadVerification | "";
  setLeadVerification: (v: LeadVerification | "") => void;
  discussion: string;
  setDiscussion: (v: string) => void;
  noteRef: React.RefObject<HTMLTextAreaElement | null>;
  outcome: CallOutcome | "";
  chooseOutcome: (v: CallOutcome | "") => void;
  asAfterSale: boolean;
  ticketFields: TicketFieldsProps;
  issueCategory: IssueCategory | "";
  setIssueCategory: (v: IssueCategory | "") => void;
  issueRef: React.RefObject<HTMLSelectElement | null>;
  issueAsked: boolean;
  needsIssue: boolean;
  followUpDate: string;
  setFollowUpDate: (v: string) => void;
  pending: boolean;
  onCancel?: () => void;
}) {
  const subjectsForCourse = defCourse
    ? masters.subjects.filter((s) => s.course_id === defCourse)
    : masters.subjects;
  const nameOf = (list: { id: string; name: string }[], id: string) =>
    list.find((x) => x.id === id)?.name;
  /** Which chip is open as a row of fields (§39.3). */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // A chip is a line that says something; the seeded blank is not a chip. The
  // one being edited stays on screen even if every field is momentarily
  // cleared, or the editor would unmount under the counsellor's cursor.
  const shown = lines.filter((l) => hasDetail(l) || l.key === editingKey);
  // These three are defaults for each teacher line — until they are the only
  // thing named, at which point they are the line, and saying otherwise would
  // be telling the counsellor their course and subject are going nowhere.
  const defaultsHint = shown.some((l) => l.key === DEFAULTS_KEY)
    ? "saved as a line of its own"
    : "applies to every line";

  return (
    // §40.2. Four across from 1280 rather than three. A Select of course names
    // is perfectly legible at 260px, and the fourth column takes a whole row
    // off the form — which is the difference between the Save button being on
    // a 768px screen and being under it.
    <div className="grid gap-x-2.5 gap-y-2 px-3 py-2.5 md:grid-cols-2 xl:grid-cols-4">
      <FirstCallField label="Name">
        <Input
          autoFocus
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
          placeholder="Optional"
        />
      </FirstCallField>

      <FirstCallField label="Type">
        {/* §30.2. What this enquiry *is*, not what the after-sale switch has
            been flipped to. An enquiry created as after-sale opened this form
            with Purchase lit and greyed out — the switch starts false and the
            control was reading it — so the first thing a ticket call showed
            was the wrong word for what it was. asAfterSale is the enquiry's
            own type or the switch, which is the question being asked. */}
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { on: !asAfterSale, label: "Purchase", next: false },
            { on: asAfterSale, label: "After Sale", next: true },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={o.on}
              disabled={!isPurchase}
              onClick={() => onType(o.next)}
              className={cx(
                "rounded-md border px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                o.on
                  ? "border-accent bg-accent-soft font-medium text-accent"
                  : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
                !isPurchase && "opacity-60",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </FirstCallField>

      <FirstCallField label="Source">
        <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">Choose…</option>
          {masters.sources.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </Select>
      </FirstCallField>

      <FirstCallField label="Course" hint={defaultsHint}>
        <Select
          value={defCourse}
          onChange={(e) => {
            setDefCourse(e.target.value);
            setDefSubject("");
          }}
        >
          <option value="">Choose…</option>
          {masters.courses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </FirstCallField>

      <FirstCallField label="Subject" hint={defaultsHint}>
        <Select value={defSubject} onChange={(e) => setDefSubject(e.target.value)}>
          <option value="">Choose…</option>
          {subjectsForCourse.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </FirstCallField>

      <FirstCallField label="Content" hint={defaultsHint}>
        <Select value={defContent} onChange={(e) => setDefContent(e.target.value)}>
          <option value="">Choose…</option>
          {masters.contents.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </FirstCallField>

      {/* The one control that is not a plain field: each teacher picked
          becomes an interest line, and the chips below are those lines. */}
      <FirstCallField
        label="Teachers"
        hint="type to search, Enter adds"
        className="xl:col-span-2"
      >
        <div className="relative">
          <Input
            value={teacherQuery}
            placeholder="Start typing a teacher's name…"
            onChange={(e) => setTeacherQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && teacherMatches[0]) {
                // Consumed here, or it would reach the form's save handler
                // while the counsellor is still choosing.
                e.preventDefault();
                e.stopPropagation();
                addTeacher(teacherMatches[0].id);
              }
            }}
          />
          {teacherMatches.length ? (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-line-2 bg-surface p-1 shadow-lg">
              {teacherMatches.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => addTeacher(t.id)}
                  className={cx(
                    "block w-full rounded px-2 py-1 text-left text-[12.5px]",
                    i === 0
                      ? "bg-accent-soft text-accent"
                      : "text-ink-2 hover:bg-surface-2",
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {savedLines.length ? (
          <div className="mt-1.5 rounded-md border border-line bg-sunk/30 px-2 py-1.5">
            <SavedLineRows
              lines={savedLines}
              masters={masters}
              onSave={onSaveSaved}
              onRemove={onRemoveSaved}
              busy={savedBusy}
            />
            {savedError ? (
              <p className="mt-1 text-[12px] text-danger">{savedError}</p>
            ) : null}
          </div>
        ) : null}

        {shown.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {shown.map((l) =>
              // §39.3. The chips are lines, and a line picked up the course,
              // subject and content that happened to be set when the teacher
              // was chosen. Opening one in place is how a counsellor says "not
              // that one" without deleting the chip and starting again.
              editingKey === l.key ? (
                <div
                  key={l.key}
                  className="flex w-full flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-surface px-2 py-1.5"
                >
                  <LineFields
                    line={l}
                    masters={masters}
                    onChange={(patch) => editLine(l.key, patch)}
                  />
                  <button
                    type="button"
                    className="text-[11.5px] text-ink-3 hover:text-ink"
                    onClick={() => setEditingKey(null)}
                  >
                    done
                  </button>
                  <button
                    type="button"
                    className="text-[11.5px] text-ink-3 hover:text-danger"
                    onClick={() => {
                      setEditingKey(null);
                      removeLine(l.key);
                    }}
                  >
                    remove
                  </button>
                </div>
              ) : (
                <span
                  key={l.key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2"
                >
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    aria-label={`Edit ${nameOf(masters.teachers, l.teacherId) ?? "line"}`}
                    onClick={() => setEditingKey(l.key)}
                  >
                    {[
                      nameOf(masters.teachers, l.teacherId),
                      nameOf(masters.courses, l.courseId),
                      nameOf(masters.subjects, l.subjectId),
                      nameOf(masters.contents, l.contentId),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${nameOf(masters.teachers, l.teacherId) ?? "line"}`}
                    className="text-ink-3 hover:text-danger"
                    onClick={() => removeLine(l.key)}
                  >
                    ×
                  </button>
                </span>
              ),
            )}
          </div>
        ) : savedLines.length ? null : (
          <p className="mt-1.5 text-[11.5px] italic text-ink-3">
            No interest lines yet — each teacher you pick becomes one, and a course
            on its own becomes one too.
          </p>
        )}
      </FirstCallField>

      <FirstCallField label="Term">
        <Select value={termId} onChange={(e) => setTermId(e.target.value)}>
          <option value="">Choose…</option>
          {masters.terms.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </FirstCallField>

      <FirstCallField label="Importance" className={asAfterSale ? "hidden" : undefined}>
        <Select
          aria-label="Importance"
          value={importance}
          onChange={(e) => setImportance(e.target.value as Importance | "")}
        >
          <option value="">Not graded</option>
          {Object.entries(IMPORTANCE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </FirstCallField>

      <FirstCallField
        label="Lead verification"
        className={asAfterSale ? "hidden" : undefined}
      >
        <Select
          aria-label="Lead verification"
          value={leadVerification}
          onChange={(e) => setLeadVerification(e.target.value as LeadVerification | "")}
        >
          <option value="">Not checked</option>
          {Object.entries(LEAD_VERIFICATION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </FirstCallField>

      {asAfterSale ? (
        <FirstCallField label="Issue category">
          <Select
            ref={issueRef}
            aria-label="Issue category"
            aria-invalid={issueAsked && needsIssue ? true : undefined}
            className={
              issueAsked && needsIssue ? "border-warn bg-warn-soft/40" : undefined
            }
            value={issueCategory}
            onChange={(e) => setIssueCategory(e.target.value as IssueCategory | "")}
          >
            <option value="">Choose…</option>
            {Object.entries(ISSUE_CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
          {issueAsked && needsIssue ? (
            <span role="alert" className="text-[11.5px] font-medium text-warn">
              Choose an issue type to save this ticket
            </span>
          ) : null}
        </FirstCallField>
      ) : null}

      {/* §44.1. The same four fields the compact window shows, because a
          ticket raised from the first-call form is the same ticket. They lay
          themselves out as plain labels, so they sit in this grid like any
          other field. */}
      <TicketFields {...ticketFields} />

      <FirstCallField label="Note" className="md:col-span-2 xl:col-span-3">
        <Textarea
          ref={noteRef}
          rows={2}
          value={discussion}
          onChange={(e) => setDiscussion(e.target.value)}
          placeholder="What was said. Enter saves, Shift+Enter for a new line."
        />
      </FirstCallField>

      <FirstCallField label="Outcome">
        <Select
          value={outcome}
          onChange={(e) => chooseOutcome(e.target.value as CallOutcome | "")}
        >
          <option value="">Choose…</option>
          {outcomesFor(asAfterSale ? "after_sale" : "purchase").map((o) => (
            <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
          ))}
        </Select>
      </FirstCallField>

      <FirstCallField label="Follow-up date">
        <Input
          type="date"
          value={followUpDate}
          disabled={!outcomeTakesDate(outcome)}
          onChange={(e) => setFollowUpDate(e.target.value)}
        />
        {/* The same four the compact panel offers. Typing a date into a date
            input costs four interactions; "+3 days" costs one, and three of
            every four follow-ups are one of these. */}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {dateChips.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={!outcomeTakesDate(outcome)}
              onClick={() => setFollowUpDate(c.value)}
              className={cx(
                "rounded-full border px-2 py-[2px] text-[11.5px]",
                followUpDate === c.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-2 bg-surface text-ink-2 hover:border-ink-3 disabled:opacity-50",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </FirstCallField>

      <div className="flex items-end gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save call"}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FirstCallField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
        {label}
        {hint ? (
          <span className="ml-1.5 font-normal normal-case text-ink-3/80">{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

/**
 * §44.1/§44.2. What a ticket carries, drawn once.
 *
 * The compact window and the first-call form are two different layouts of the
 * same call, and a ticket raised through one has to be the same ticket as one
 * raised through the other — same required order id, same optional product and
 * teacher, same escalatee. Two copies of these four fields is two places for
 * "required" to stop being true.
 */
export type TicketFieldsProps = {
  asAfterSale: boolean;
  outcome: CallOutcome | "";
  orderId: string;
  setOrderId: (v: string) => void;
  needsOrderId: boolean;
  orderAsked: boolean;
  orderRef: React.Ref<HTMLInputElement>;
  ticketProduct: string;
  setTicketProduct: (v: string) => void;
  ticketTeacher: string;
  setTicketTeacher: (v: string) => void;
  escalatedTo: string;
  setEscalatedTo: (v: string) => void;
  needsEscalatee: boolean;
  escalateeAsked: boolean;
  escalateeRef: React.Ref<HTMLSelectElement>;
  masters: PanelMasters;
  roster?: { id: string; name: string }[];
};

function TicketFields({
  asAfterSale,
  outcome,
  orderId,
  setOrderId,
  needsOrderId,
  orderAsked,
  orderRef,
  ticketProduct,
  setTicketProduct,
  ticketTeacher,
  setTicketTeacher,
  escalatedTo,
  setEscalatedTo,
  needsEscalatee,
  escalateeAsked,
  escalateeRef,
  masters,
  roster,
}: TicketFieldsProps) {
  if (!asAfterSale) return null;
  return (
    <>
          {/* §44.1. The three things a ticket is chased with. Order ID is
          required for the same reason the category is — an institute
          cannot look anything up without it — and refused the same way.
          Product and teacher are optional: often the student says "the FR
          videos" and nothing more, and half a description beats none. */}
      {asAfterSale ? (
        <label className="flex min-w-[150px] flex-col gap-1">
          <span
            className={cx(
              "text-[10px] font-semibold uppercase tracking-[0.045em]",
              orderAsked && needsOrderId ? "text-warn" : "text-ink-3",
            )}
          >
            Order ID
          </span>
          <Input
            ref={orderRef}
            aria-label="Order ID"
            placeholder="ZI-00000"
            aria-invalid={orderAsked && needsOrderId ? true : undefined}
            className={
              orderAsked && needsOrderId ? "border-warn bg-warn-soft/40" : undefined
            }
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
          {orderAsked && needsOrderId ? (
            <span role="alert" className="text-[11.5px] font-medium text-warn">
              An order ID is needed to save this ticket
            </span>
          ) : null}
        </label>
      ) : null}

      {asAfterSale ? (
        <label className="flex min-w-[160px] flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Product
          </span>
          <Input
            aria-label="Product"
            placeholder="What they bought"
            value={ticketProduct}
            onChange={(e) => setTicketProduct(e.target.value)}
          />
        </label>
      ) : null}

      {asAfterSale ? (
        <div className="flex min-w-[190px] flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Teacher
            <span className="ml-1 font-normal normal-case text-ink-3">
              institute follows
            </span>
          </span>
          <TeacherPicker
            teachers={masters.teachers}
            value={ticketTeacher}
            onChange={setTicketTeacher}
          />
        </div>
      ) : null}

      {/* §44.2. Escalated is the one state that names somebody: the ticket
          is now on their desk, and it appears in their My Day until it
          moves on. */}
      {asAfterSale && outcome === "escalated" ? (
        <label className="flex min-w-[180px] flex-col gap-1">
          <span
            className={cx(
              "text-[10px] font-semibold uppercase tracking-[0.045em]",
              escalateeAsked && needsEscalatee ? "text-warn" : "text-ink-3",
            )}
          >
            Escalate to
          </span>
          <Select
            ref={escalateeRef}
            aria-label="Escalate to"
            aria-invalid={escalateeAsked && needsEscalatee ? true : undefined}
            className={
              escalateeAsked && needsEscalatee
                ? "border-warn bg-warn-soft/40"
                : undefined
            }
            value={escalatedTo}
            onChange={(e) => setEscalatedTo(e.target.value)}
          >
            <option value="">Choose…</option>
            {(roster ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          {escalateeAsked && needsEscalatee ? (
            <span role="alert" className="text-[11.5px] font-medium text-warn">
              Say who this is escalated to
            </span>
          ) : null}
        </label>
      ) : null}
    </>
  );
}
