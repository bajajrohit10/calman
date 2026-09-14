"use client";

import { useId, useMemo, useState } from "react";

import { Badge, Button, Input, Select, cx } from "@/components/ui";

/**
 * The interest line editor, shared by the call panel and the student history
 * card.
 *
 * §5.3 and §7 both hang off these four columns: a lead with no teacher against
 * it is invisible to the teacher-wise reports, and a *won* lead with no
 * teacher is a sale nobody can attribute. That is why the table is open by
 * default in both places rather than hidden behind a link — a counsellor
 * should have to decide not to record an interest, not remember to.
 *
 * One component rather than two so the two screens cannot drift into disagreeing
 * about what a valid line is.
 */

export type ItemMaster = { id: string; name: string };
export type SubjectMaster = { id: string; name: string; course_id: string };

export type ItemMasters = {
  teachers: ItemMaster[];
  courses: ItemMaster[];
  subjects: SubjectMaster[];
  contents: ItemMaster[];
};

export type NewLine = {
  key: string;
  teacherId: string;
  courseId: string;
  subjectId: string;
  contentId: string;
  /** Only used where a purchase is being recorded. */
  won: boolean;
  amount: string;
};

let counter = 0;

export function blankLine(won = false): NewLine {
  counter += 1;
  return {
    key: `line-${counter}`,
    teacherId: "",
    courseId: "",
    subjectId: "",
    contentId: "",
    won,
    amount: "",
  };
}

/**
 * A line is worth saving once it names anything at all (§39.2).
 *
 * It used to demand a teacher *and* a course, which meant "CA Final, FR" —
 * everything a student said before naming a teacher — could only be recorded
 * by not recording it. Half an interest is still an interest, and the teacher
 * gets added to the same line on a later call.
 *
 * A subject is the one part that cannot stand alone: subjects belong to
 * courses, and the table enforces the same pairing.
 */
export function hasDetail(line: NewLine): boolean {
  return Boolean(line.teacherId || line.courseId || line.subjectId || line.contentId);
}

/**
 * Teacher typeahead. 73 names is too many to scan in a native select and far
 * too few to need a server round-trip, so the whole list is filtered in place.
 * Enter is consumed here when the list is open, otherwise it would reach the
 * panel's save handler while the counsellor is still choosing.
 */
export function TeacherPicker({
  teachers,
  value,
  onChange,
  inputRef,
}: {
  teachers: ItemMaster[];
  value: string;
  onChange: (id: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
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

  function choose(teacher: ItemMaster) {
    onChange(teacher.id);
    setQuery(teacher.name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
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

/**
 * The four columns a line is made of, written once.
 *
 * Both the unsaved rows below and the saved-line editor (§39.3) put the same
 * question to the counsellor, so they ask it with the same controls: a line
 * being corrected a week later has to be correctable into exactly the shapes a
 * line can be created in, or the two screens start disagreeing about what a
 * valid line is.
 */
export function LineFields({
  line,
  masters,
  showWon,
  onChange,
  firstFieldRef,
}: {
  line: NewLine;
  masters: ItemMasters;
  showWon?: boolean;
  onChange: (patch: Partial<NewLine>) => void;
  firstFieldRef?: React.Ref<HTMLInputElement>;
}) {
  const subjects = masters.subjects.filter((s) => s.course_id === line.courseId);
  return (
    <>
      <div className="w-[190px]">
        <TeacherPicker
          teachers={masters.teachers}
          value={line.teacherId}
          onChange={(id) => onChange({ teacherId: id })}
          inputRef={firstFieldRef}
        />
      </div>
      <Select
        className="w-[140px]"
        aria-label="Course"
        value={line.courseId}
        // Subjects belong to courses, so a course change cannot leave last
        // course's subject sitting underneath it.
        onChange={(e) => onChange({ courseId: e.target.value, subjectId: "" })}
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
        onChange={(e) => onChange({ subjectId: e.target.value })}
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
        onChange={(e) => onChange({ contentId: e.target.value })}
      >
        <option value="">Content…</option>
        {masters.contents.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      {showWon ? (
        <label className="flex cursor-pointer items-center gap-1 text-[11.5px] text-ink-2">
          <input
            type="checkbox"
            checked={line.won}
            onChange={(e) => onChange({ won: e.target.checked })}
          />
          bought
        </label>
      ) : null}
    </>
  );
}

/**
 * The editable rows, plus the inline "Add line" control.
 *
 * There is always at least one blank row on screen: the caller seeds `lines`
 * with one. A counsellor recording an interest mid-call should be able to
 * start typing, not click a disclosure first.
 */
export function InterestLineRows({
  lines,
  masters,
  showWon,
  onChange,
  firstFieldRef,
}: {
  lines: NewLine[];
  masters: ItemMasters;
  /** Render the "bought" tick and the amount box (purchase being recorded). */
  showWon?: boolean;
  onChange: (next: NewLine[]) => void;
  /** Focus target for "add now" prompts. */
  firstFieldRef?: React.Ref<HTMLInputElement>;
}) {
  function setLine(key: string, patch: Partial<NewLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    const next = lines.filter((l) => l.key !== key);
    // Never leave the table with nothing to type into.
    onChange(next.length ? next : [blankLine(showWon)]);
  }

  return (
    <>
      {lines.map((line, index) => (
        <div
          key={line.key}
          className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2 last:mb-0 last:border-b-0 last:pb-0"
        >
          <LineFields
            line={line}
            masters={masters}
            showWon={showWon}
            onChange={(patch) => setLine(line.key, patch)}
            firstFieldRef={index === 0 ? firstFieldRef : undefined}
          />
          <button
            type="button"
            onClick={() => removeLine(line.key)}
            className="text-[11.5px] text-ink-3 hover:text-danger"
          >
            clear
          </button>
        </div>
      ))}

      <div className="mt-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange([...lines, blankLine(showWon)])}
        >
          Add line
        </Button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** A line that is already in the database. */
export type SavedLine = {
  id: string;
  status: string;
  teacherId: string | null;
  courseId: string | null;
  subjectId: string | null;
  contentId: string | null;
  teacher: string | null;
  course: string | null;
  subject: string | null;
  content: string | null;
};

export function savedLineLabel(line: {
  teacher: string | null;
  course: string | null;
  subject: string | null;
  content: string | null;
}): string {
  return (
    [line.teacher, line.course, line.subject, line.content].filter(Boolean).join(" · ") ||
    "Untitled interest"
  );
}

function asNewLine(line: SavedLine): NewLine {
  return {
    key: line.id,
    teacherId: line.teacherId ?? "",
    courseId: line.courseId ?? "",
    subjectId: line.subjectId ?? "",
    contentId: line.contentId ?? "",
    won: false,
    amount: "",
  };
}

/**
 * Saved lines, correctable where they sit (§39.3).
 *
 * A partial line is only worth allowing if it can be completed later, and a
 * line recorded mid-call is a line recorded in a hurry — so every one of them
 * opens into the same four controls it was created with, in all three places
 * they are shown.
 *
 * Removing closes the line rather than deleting it: an interest that was
 * recorded and then withdrawn is a fact about the lead, and the teacher-wise
 * reports in §7 count closed lines as interest that went nowhere. A row that
 * vanished would take that with it.
 *
 * A won line is read-only. It has an order id and an amount against it, and
 * rewriting what was bought after the money is recorded is not a correction —
 * it is a different sale.
 */
export function SavedLineRows<T extends SavedLine>({
  lines,
  masters,
  onSave,
  onRemove,
  busy,
  readOnly,
  extra,
}: {
  lines: T[];
  masters: ItemMasters;
  onSave: (id: string, line: NewLine) => void;
  onRemove: (id: string) => void;
  /** The id currently being written, if any. */
  busy?: string | null;
  /** The viewer may not edit anything here (no masters loaded). */
  readOnly?: boolean;
  /** Anything the host screen shows alongside a line — an order id, an amount. */
  extra?: (line: T) => React.ReactNode;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewLine | null>(null);

  function open(line: T) {
    setEditing(line.id);
    setDraft(asNewLine(line));
  }

  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line) => {
        const isOpen = editing === line.id && draft != null;
        const fixed = readOnly || line.status === "won";
        return (
          <li key={line.id} className="text-[12.5px]">
            {isOpen ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-surface px-2 py-1.5">
                <LineFields
                  // Remounted per line id so the teacher typeahead opens
                  // showing the name this line already has.
                  key={line.id}
                  line={draft!}
                  masters={masters}
                  onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={busy === line.id || !hasDetail(draft!)}
                  onClick={() => {
                    onSave(line.id, draft!);
                    setEditing(null);
                  }}
                >
                  {busy === line.id ? "Saving…" : "Save"}
                </Button>
                <button
                  type="button"
                  className="text-[11.5px] text-ink-3 hover:text-ink"
                  onClick={() => setEditing(null)}
                >
                  cancel
                </button>
                <button
                  type="button"
                  className="text-[11.5px] text-ink-3 hover:text-danger"
                  onClick={() => {
                    onRemove(line.id);
                    setEditing(null);
                  }}
                >
                  remove
                </button>
                {!hasDetail(draft!) ? (
                  <span className="w-full text-[11.5px] text-danger">
                    A line has to name at least one of teacher, course, subject or
                    content. Use remove to take it off the lead.
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 py-0.5">
                <span className={fixed ? "text-ink" : "text-ink-2"}>
                  {savedLineLabel(line)}
                </span>
                <Badge
                  tone={
                    line.status === "won" ? "ok" : line.status === "open" ? "info" : "neutral"
                  }
                >
                  {STATUS_WORD[line.status] ?? line.status}
                </Badge>
                {line.status === "won" ? (
                  <span className="text-[11px] text-ink-3">bought — not editable</span>
                ) : fixed ? null : (
                  <button
                    type="button"
                    className="text-[11.5px] text-accent underline-offset-2 hover:underline"
                    onClick={() => open(line)}
                  >
                    edit
                  </button>
                )}
                {extra?.(line)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Kept local so this file does not drag the whole label module in. */
const STATUS_WORD: Record<string, string> = {
  open: "Open",
  won: "Won",
  competitor: "Competitor",
  closed: "Closed",
};
