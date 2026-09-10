"use client";

import { useMemo } from "react";

import { Input, Select } from "@/components/ui";
import { IMPORTANCE_LABELS } from "@/lib/enquiry-labels";

export type FilterMaster = { id: string; name: string };
export type FilterSubject = FilterMaster & { course_id: string };

export type FilterMasters = {
  teachers: FilterMaster[];
  courses: FilterMaster[];
  subjects: FilterSubject[];
  contents: FilterMaster[];
  terms: FilterMaster[];
  sources: FilterMaster[];
};

export function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * The filter fields the Assignment Desk (§5.5) and the Enquiries table (§5.6)
 * have in common, under the query-string names both screens parse in
 * app/(app)/assign/filters.ts.
 *
 * Shared as a component, not copied, so the two bars cannot drift apart and
 * then disagree about what a pasted URL means — the parser is only half the
 * guarantee if the forms emit different keys.
 */
export function CommonFilterFields({
  masters,
  selected,
  roster,
}: {
  masters: FilterMasters;
  selected: Record<string, string>;
  roster?: { id: string; name: string }[];
}) {
  const subjectsForCourse = useMemo(
    () =>
      selected.course
        ? masters.subjects.filter((s) => s.course_id === selected.course)
        : masters.subjects,
    [masters.subjects, selected.course],
  );

  return (
    <>
      {roster ? (
        <Labelled label="Counsellor">
          <Select name="counsellor" defaultValue={selected.counsellor ?? ""}>
            <option value="">Anyone</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Labelled>
      ) : null}

      <Labelled label="Teacher">
        <Select name="teacher" defaultValue={selected.teacher ?? ""}>
          <option value="">Any</option>
          {masters.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Course">
        <Select name="course" defaultValue={selected.course ?? ""}>
          <option value="">Any</option>
          {masters.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Subject">
        <Select name="subject" defaultValue={selected.subject ?? ""}>
          <option value="">Any</option>
          {subjectsForCourse.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Content">
        <Select name="content" defaultValue={selected.content ?? ""}>
          <option value="">Any</option>
          {masters.contents.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Term">
        <Select name="term" defaultValue={selected.term ?? ""}>
          <option value="">Any</option>
          {masters.terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Source">
        <Select name="source" defaultValue={selected.source ?? ""}>
          <option value="">Any</option>
          {masters.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Importance">
        <Select name="importance" defaultValue={selected.importance ?? ""}>
          <option value="">Any</option>
          {Object.entries(IMPORTANCE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Discussion contains">
        <Input name="q" defaultValue={selected.q ?? ""} placeholder="text in any call note" />
      </Labelled>

      <Labelled label="Enquired from">
        <Input type="date" name="createdFrom" defaultValue={selected.createdFrom ?? ""} />
      </Labelled>

      <Labelled label="Enquired to">
        <Input type="date" name="createdTo" defaultValue={selected.createdTo ?? ""} />
      </Labelled>

      <Labelled label="Follow-up from">
        <Input type="date" name="followUpFrom" defaultValue={selected.followUpFrom ?? ""} />
      </Labelled>

      <Labelled label="Follow-up to">
        <Input type="date" name="followUpTo" defaultValue={selected.followUpTo ?? ""} />
      </Labelled>
    </>
  );
}
