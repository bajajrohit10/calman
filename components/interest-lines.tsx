"use client";

import { useId, useMemo, useState } from "react";

import { Button, Input, Select, cx } from "@/components/ui";

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

/** A line is worth saving once it names at least a teacher and a course. */
export function isComplete(line: NewLine): boolean {
  return Boolean(line.teacherId && line.courseId);
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
      {lines.map((line, index) => {
        const subjects = masters.subjects.filter((s) => s.course_id === line.courseId);
        return (
          <div
            key={line.key}
            className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2 last:mb-0 last:border-b-0 last:pb-0"
          >
            <div className="w-[190px]">
              <TeacherPicker
                teachers={masters.teachers}
                value={line.teacherId}
                onChange={(id) => setLine(line.key, { teacherId: id })}
                inputRef={index === 0 ? firstFieldRef : undefined}
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

            {showWon ? (
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
              onClick={() => removeLine(line.key)}
              className="text-[11.5px] text-ink-3 hover:text-danger"
            >
              clear
            </button>
          </div>
        );
      })}

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
