"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";

import { Badge, Button, ErrorNote, Input, Select, Textarea, cx } from "@/components/ui";
import {
  IMPORTANCE_LABELS,
  ISSUE_CATEGORY_LABELS,
  LEAD_VERIFICATION_LABELS,
  ITEM_STATUS_LABELS,
  OUTCOME_LABELS,
  outcomeTakesDate,
  outcomesFor,
  type CallOutcome,
  type EnquiryType,
  type Importance,
  type IssueCategory,
  type LeadVerification,
} from "@/lib/enquiry-labels";
import { istDatePlus, istNextMonday, istToday } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import { WhatsAppButton } from "@/components/whatsapp/button";
import { courseTextFor } from "@/lib/whatsapp-text";

import { logCall, updateEnquiryDetails, type LogCallResult } from "./actions";

export type Master = { id: string; name: string };
export type SubjectMaster = { id: string; name: string; course_id: string };

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
  termId: string | null;
  sourceId: string | null;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  items: PanelItem[];
};

type NewLine = {
  key: string;
  teacherId: string;
  courseId: string;
  subjectId: string;
  contentId: string;
  won: boolean;
  amount: string;
};

type Decision = { won: boolean; amount: string; close: boolean };

/* -------------------------------------------------------------------------- */

/**
 * Teacher typeahead. 73 names is too many to scan in a native select and far
 * too few to need a server round-trip, so the whole list is filtered in place.
 * Enter is consumed here when the list is open, otherwise it would reach the
 * panel's save handler while the counsellor is still choosing.
 */
function TeacherPicker({
  teachers,
  value,
  onChange,
}: {
  teachers: Master[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = teachers.find((t) => t.id === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teachers.slice(0, 8);
    return teachers.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8);
  }, [teachers, query]);

  function choose(teacher: Master) {
    onChange(teacher.id);
    setQuery(teacher.name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Teacher"
        placeholder="Teacher…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setCursor(0);
          if (value) onChange("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => (c + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => (c - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            // Consumed: the panel saves on Enter, and picking a teacher must
            // not also submit the call.
            e.preventDefault();
            e.stopPropagation();
            choose(matches[cursor]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line-2 bg-surface py-1 shadow-lg"
        >
          {matches.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(t)}
                className={cx(
                  "block w-full px-2.5 py-1 text-left text-[12.5px]",
                  i === cursor ? "bg-accent-soft text-accent" : "text-ink-2",
                )}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function itemLabel(item: PanelItem) {
  return (
    [item.teacher, item.course, item.subject, item.content].filter(Boolean).join(" · ") ||
    "Untitled interest"
  );
}

/* -------------------------------------------------------------------------- */

export function CallLogPanel({
  enquiry,
  masters,
  onSaved,
  onCancel,
}: {
  enquiry: PanelEnquiry;
  masters: PanelMasters;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isPurchase = enquiry.type === "purchase";
  const openItems = enquiry.items.filter((i) => i.status === "open");

  const [discussion, setDiscussion] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [issueCategory, setIssueCategory] = useState<IssueCategory | "">("");
  const [orderId, setOrderId] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [showInterests, setShowInterests] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [details, setDetails] = useState({
    importance: (enquiry.importance ?? "") as Importance | "",
    termId: enquiry.termId ?? "",
    sourceId: enquiry.sourceId ?? "",
    leadVerification: (enquiry.leadVerification ?? "") as LeadVerification | "",
    studentName: enquiry.studentName ?? "",
  });
  const [detailsResult, setDetailsResult] = useState<LogCallResult | null>(null);
  const [savingDetails, startDetails] = useTransition();

  function saveDetails() {
    setDetailsResult(null);
    startDetails(async () => {
      setDetailsResult(
        await updateEnquiryDetails({
          enquiryId: enquiry.id,
          importance: details.importance,
          termId: details.termId || null,
          sourceId: details.sourceId || null,
          leadVerification: details.leadVerification,
          studentName: details.studentName,
        }),
      );
    });
  }
  const [result, setResult] = useState<LogCallResult | null>(null);
  const [pending, startTransition] = useTransition();

  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  const purchased = outcome === "purchased";
  const tickedCount =
    Object.values(decisions).filter((d) => d.won).length +
    newLines.filter((l) => l.won).length;
  const needsAnItem = purchased && openItems.length === 0 && newLines.length === 0;

  function decision(id: string): Decision {
    return decisions[id] ?? { won: false, amount: "", close: false };
  }

  function setDecision(id: string, patch: Partial<Decision>) {
    setDecisions((d) => ({ ...d, [id]: { ...decision(id), ...patch } }));
  }

  function addLine() {
    setNewLines((l) => [
      ...l,
      {
        key: `${Date.now()}-${l.length}`,
        teacherId: "",
        courseId: "",
        subjectId: "",
        contentId: "",
        // A line added during a purchase was almost certainly added because it
        // was bought — pre-ticked so the common case is one click, not two.
        won: purchased,
        amount: "",
      },
    ]);
  }

  function setLine(key: string, patch: Partial<NewLine>) {
    setNewLines((lines) =>
      lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  /** Outcome drives what the rest of the form is asking for. */
  function chooseOutcome(next: CallOutcome | "") {
    setOutcome(next);
    setResult(null);
    if (next === "call_back") {
      // §6 bucket 5: call backs are re-tried the same evening.
      setFollowUpDate(istToday());
    } else if (next === "follow_up" || next === "noted") {
      setFollowUpDate("");
    } else {
      setFollowUpDate("");
    }
    if (next === "purchased" && enquiry.items.filter((i) => i.status === "open").length === 0) {
      // Nothing to tick: open the interests editor rather than let them hit a
      // wall on save.
      setShowInterests(true);
      setNewLines((l) => (l.length ? l : [
        {
          key: `${Date.now()}`,
          teacherId: "",
          courseId: "",
          subjectId: "",
          contentId: "",
          won: true,
          amount: "",
        },
      ]));
    }
  }

  function save() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      const res = await logCall({
        enquiryId: enquiry.id,
        outcome,
        discussion,
        nextFollowUpDate: outcomeTakesDate(outcome) ? followUpDate || null : null,
        issueCategory: enquiry.type === "after_sale" ? issueCategory : null,
        orderId: purchased ? orderId : enquiry.type === "after_sale" ? orderId : null,
        existingItems: openItems.map((i) => ({
          id: i.id,
          won: decision(i.id).won,
          amount: decision(i.id).amount || null,
          close: decision(i.id).close,
        })),
        newItems: newLines
          .filter((l) => l.teacherId && l.courseId)
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
      className="rounded-lg border border-accent/40 bg-surface shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
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

      <div className="flex flex-col gap-3 px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
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
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
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
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
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

          {outcomeTakesDate(outcome) ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
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
                      "rounded-full border px-2 py-0.5 text-[11px]",
                      followUpDate === chip.value
                        ? "border-accent/50 bg-accent-soft text-accent"
                        : "border-line-2 bg-surface-2 text-ink-2 hover:text-ink",
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
              courseText={courseTextFor(enquiry.items, enquiry.productText)}
            />
          </div>
        </div>

        {purchased ? (
          <section className="rounded-md border border-ok/40 bg-ok-soft/40 px-3 py-2.5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
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

        <div>
          <button
            type="button"
            onClick={() => setShowDetails((d) => !d)}
            className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
          >
            {showDetails ? "▾" : "›"} Edit enquiry details
          </button>

          {showDetails ? (
            <div className="mt-2 grid gap-2 rounded-md border border-line bg-sunk/30 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                  Student name
                </span>
                <Input
                  value={details.studentName}
                  onChange={(e) =>
                    setDetails((d) => ({ ...d, studentName: e.target.value }))
                  }
                  placeholder="Not recorded"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                  Importance
                </span>
                <Select
                  aria-label="Importance"
                  value={details.importance}
                  onChange={(e) =>
                    setDetails((d) => ({
                      ...d,
                      importance: e.target.value as Importance | "",
                    }))
                  }
                >
                  <option value="">—</option>
                  {Object.entries(IMPORTANCE_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                  Term
                </span>
                <Select
                  aria-label="Term"
                  value={details.termId}
                  onChange={(e) => setDetails((d) => ({ ...d, termId: e.target.value }))}
                >
                  <option value="">—</option>
                  {masters.terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                  Source
                </span>
                <Select
                  aria-label="Source"
                  value={details.sourceId}
                  onChange={(e) => setDetails((d) => ({ ...d, sourceId: e.target.value }))}
                >
                  <option value="">—</option>
                  {masters.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                  Lead verification
                </span>
                <Select
                  aria-label="Lead verification"
                  value={details.leadVerification}
                  onChange={(e) =>
                    setDetails((d) => ({
                      ...d,
                      leadVerification: e.target.value as LeadVerification | "",
                    }))
                  }
                >
                  <option value="">—</option>
                  {Object.entries(LEAD_VERIFICATION_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingDetails}
                  onClick={saveDetails}
                >
                  {savingDetails ? "Saving…" : "Save details"}
                </Button>
                {detailsResult?.ok ? (
                  <span className="pb-1.5 text-[11.5px] text-ok" role="status">
                    {detailsResult.ok}
                  </span>
                ) : null}
              </div>

              {detailsResult?.error ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <ErrorNote>{detailsResult.error}</ErrorNote>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Interests are a purchase concept: an after-sale enquiry is about an
            order that already exists, so there is nothing to record here. */}
        <div className={isPurchase ? undefined : "hidden"}>
          <button
            type="button"
            onClick={() => setShowInterests((s) => !s)}
            className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
          >
            {showInterests ? "▾" : "›"} Edit interests ({enquiry.items.length})
          </button>

          {showInterests ? (
            <div className="mt-2 rounded-md border border-line bg-sunk/30 px-3 py-2.5">
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

              {newLines.map((line) => {
                const subjects = masters.subjects.filter(
                  (s) => s.course_id === line.courseId,
                );
                return (
                  <div
                    key={line.key}
                    className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-b-0"
                  >
                    <div className="w-[190px]">
                      <TeacherPicker
                        teachers={masters.teachers}
                        value={line.teacherId}
                        onChange={(id) => setLine(line.key, { teacherId: id })}
                      />
                    </div>
                    <Select
                      className="w-[140px]"
                      aria-label="Course"
                      value={line.courseId}
                      onChange={(e) =>
                        setLine(line.key, { courseId: e.target.value, subjectId: "" })
                      }
                    >
                      <option value="">Course…</option>
                      {masters.courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      className="w-[140px]"
                      aria-label="Subject"
                      value={line.subjectId}
                      disabled={!line.courseId}
                      onChange={(e) => setLine(line.key, { subjectId: e.target.value })}
                    >
                      <option value="">{line.courseId ? "Subject…" : "Course first"}</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      className="w-[130px]"
                      aria-label="Content"
                      value={line.contentId}
                      onChange={(e) => setLine(line.key, { contentId: e.target.value })}
                    >
                      <option value="">Content…</option>
                      {masters.contents.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>

                    {purchased ? (
                      <label className="flex cursor-pointer items-center gap-1 text-[11.5px] text-ink-2">
                        <input
                          type="checkbox"
                          checked={line.won}
                          onChange={(e) => setLine(line.key, { won: e.target.checked })}
                        />
                        bought
                      </label>
                    ) : null}

                    <button
                      type="button"
                      onClick={() =>
                        setNewLines((l) => l.filter((x) => x.key !== line.key))
                      }
                      className="text-[11.5px] text-ink-3 hover:text-danger"
                    >
                      remove
                    </button>
                  </div>
                );
              })}

              <Button type="button" size="sm" variant="secondary" onClick={addLine}>
                Add line
              </Button>
            </div>
          ) : null}
        </div>

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
    </form>
  );
}
