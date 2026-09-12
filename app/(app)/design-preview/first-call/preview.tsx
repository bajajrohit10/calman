"use client";

import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  FIELD_LABEL,
  Input,
  Select,
  Textarea,
  cx,
} from "@/components/ui";
import {
  IMPORTANCE_LABELS,
  LEAD_VERIFICATION_LABELS,
  OUTCOME_LABELS,
  PURCHASE_OUTCOMES,
} from "@/lib/enquiry-labels";

type Master = { id: string; name: string };
type Subject = Master & { course_id: string };

/**
 * The proposed first-call layout (§26.2).
 *
 * Everything on one screen in the order a conversation actually goes: who they
 * are, what they want, how good the lead is, what was said, what happens next.
 * No drawers — a first call has nothing to hide behind one, and "Edit
 * interests" being a click away is why leads arrive at the second call with no
 * teacher on them.
 */
export function FirstCallPreview({
  teachers,
  courses,
  subjects,
  contents,
  terms,
}: {
  teachers: Master[];
  courses: Master[];
  subjects: Subject[];
  contents: Master[];
  terms: Master[];
}) {
  const [type, setType] = useState<"purchase" | "after_sale">("purchase");
  const [courseId, setCourseId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [contentId, setContentId] = useState("");
  const [picked, setPicked] = useState<Master[]>([]);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return teachers
      .filter((t) => t.name.toLowerCase().includes(q) && !picked.some((p) => p.id === t.id))
      .slice(0, 6);
  }, [query, teachers, picked]);

  const subjectsForCourse = useMemo(
    () => (courseId ? subjects.filter((s) => s.course_id === courseId) : subjects),
    [subjects, courseId],
  );

  const courseName = courses.find((c) => c.id === courseId)?.name;
  const contentName = contents.find((c) => c.id === contentId)?.name;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">
          First call — proposed layout
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-2">
          A preview for Brief 26.2. Nothing here saves. The panel on a lead that
          already has calls is unchanged — this is only what a counsellor sees the
          first time they speak to somebody.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="text-[13px] font-semibold text-ink">98765 43210</span>
          <Badge tone="info">First call</Badge>
          <span className="text-[12px] text-ink-3">
            No calls yet — every field is here, nothing is behind a drawer.
          </span>
        </header>

        {/* Three columns at ≥1280, two at ≥768, one below. The whole form is
            fourteen controls; at three across that is five rows, which fits a
            1440×900 window under the header without scrolling. */}
        <div className="grid gap-x-3 gap-y-2.5 px-4 py-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Name" hint="tab 1">
            <Input placeholder="Optional" />
          </Field>

          <Field label="Type" hint="tab 2">
            <div className="grid grid-cols-2 gap-1.5">
              {(["purchase", "after_sale"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cx(
                    "rounded-md border px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                    type === t
                      ? "border-accent bg-accent-soft font-medium text-accent"
                      : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
                  )}
                >
                  {t === "purchase" ? "Purchase" : "After Sale"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Course" hint="tab 3 · applies to every line">
            <Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setSubjectId(""); }}>
              <option value="">Choose…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>

          {/* The one field that is not a plain control: picking a teacher adds
              an interest line, and the chips below are those lines. */}
          <Field
            label="Teachers"
            hint="tab 4 · type to search, Enter adds"
            className="xl:col-span-2"
          >
            <div className="relative">
              <Input
                value={query}
                placeholder="Start typing a teacher's name…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) {
                    e.preventDefault();
                    setPicked((p) => [...p, matches[0]]);
                    setQuery("");
                  }
                }}
              />
              {matches.length ? (
                <div className="absolute z-20 mt-1 w-full rounded-md border border-line-2 bg-surface p-1 shadow-lg">
                  {matches.map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setPicked((p) => [...p, t]); setQuery(""); }}
                      className={cx(
                        "block w-full rounded px-2 py-1 text-left text-[12.5px]",
                        i === 0 ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2",
                      )}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {picked.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {picked.map((t, i) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2"
                  >
                    {[t.name, courseName, contentName].filter(Boolean).join(" · ")}
                    <button
                      type="button"
                      aria-label={`Remove ${t.name}`}
                      className="text-ink-3 hover:text-danger"
                      onClick={() => setPicked((p) => p.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-[11.5px] italic text-ink-3">
                No interest lines yet — each teacher you pick becomes one.
              </p>
            )}
          </Field>

          <Field label="Subject" hint="tab 5 · applies to every line">
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Choose…</option>
              {subjectsForCourse.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Content" hint="tab 6 · applies to every line">
            <Select value={contentId} onChange={(e) => setContentId(e.target.value)}>
              <option value="">Choose…</option>
              {contents.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Term" hint="tab 7">
            <Select>
              <option value="">Choose…</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Importance" hint="tab 8">
            <Select>
              <option value="">Not graded</option>
              {Object.entries(IMPORTANCE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>

          <Field label="Lead verification" hint="tab 9">
            <Select>
              <option value="">Not checked</option>
              {Object.entries(LEAD_VERIFICATION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>

          <Field label="Note" hint="tab 10" className="md:col-span-2 xl:col-span-3">
            <Textarea rows={2} placeholder="What was said. Enter saves, Shift+Enter for a new line." />
          </Field>

          <Field label="Outcome" hint="tab 11">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Choose…</option>
              {PURCHASE_OUTCOMES.map((o) => (
                <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
              ))}
            </Select>
          </Field>

          <Field label="Follow-up date" hint="tab 12">
            <Input
              type="date"
              disabled={!(outcome === "follow_up" || outcome === "call_back")}
            />
          </Field>

          <div className="flex items-end">
            <Button variant="primary" className="w-full">Save call</Button>
          </div>
        </div>

        <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
          Course, Subject and Content are the defaults every teacher you pick
          inherits; change one and it applies to the lines added after it, and each
          chip can be edited on its own. Follow-up date is enabled only by the two
          outcomes that take one.
        </p>
      </div>
    </div>
  );
}

function Field({
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
      <span className={FIELD_LABEL}>
        {label}
        {hint ? <span className="ml-1.5 font-normal normal-case text-ink-3">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
