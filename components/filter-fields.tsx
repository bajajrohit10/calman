"use client";

import { useMemo } from "react";

import { Input, Select } from "@/components/ui";
import { IMPORTANCE_LABELS } from "@/lib/enquiry-labels";
import {
  countLabel,
  isEmptyOption,
  orderOptions,
  type FacetMap,
} from "@/lib/facet-shape";

export type FilterMaster = { id: string; name: string };
export type FilterSubject = FilterMaster & { course_id: string };

export type FilterMasters = {
  teachers: FilterMaster[];
  institutes: FilterMaster[];
  courses: FilterMaster[];
  subjects: FilterSubject[];
  contents: FilterMaster[];
  terms: FilterMaster[];
  sources: FilterMaster[];
};

/**
 * A filter select whose options carry their counts (§5.5).
 *
 * The counts are faceted: each option says how much is behind it with the
 * *other* active filters applied, so a counsellor can see where the work is
 * before committing to a click, and never picks a combination that turns out
 * to be empty. Busiest first; empty options sink and grey out rather than
 * vanish. With no facet map — the Enquiries table does not have one — this is
 * an ordinary select in the master list's own order.
 */
export function FacetSelect({
  name,
  facet,
  options,
  value,
  anyLabel = "Any",
  facets,
}: {
  name: string;
  /** The facet key in the map; often but not always the same as `name`. */
  facet: string;
  options: FilterMaster[];
  value: string;
  anyLabel?: string;
  facets?: FacetMap;
}) {
  const counts = facets?.byFacet[facet];
  const ordered = useMemo(() => orderOptions(options, counts), [options, counts]);

  return (
    <Select name={name} defaultValue={value}>
      <option value="">{anyLabel}</option>
      {ordered.map((o) => {
        const empty = isEmptyOption(facet, o.id, facets);
        return (
          <option
            key={o.id}
            value={o.id}
            className={empty ? "text-ink-3" : undefined}
          >
            {counts ? countLabel(o.name, facet, counts[o.id]) : o.name}
          </option>
        );
      })}
    </Select>
  );
}

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

const IMPORTANCE_OPTIONS: FilterMaster[] = Object.entries(IMPORTANCE_LABELS).map(
  ([id, name]) => ({ id, name }),
);

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
  facets,
}: {
  masters: FilterMasters;
  selected: Record<string, string>;
  roster?: { id: string; name: string }[];
  /** Omit for a screen with no faceted counts. */
  facets?: FacetMap;
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
          <FacetSelect
            name="counsellor"
            facet="counsellor"
            options={roster}
            value={selected.counsellor ?? ""}
            anyLabel="Anyone"
            facets={facets}
          />
        </Labelled>
      ) : null}

      <Labelled label="Institute">
        <FacetSelect
          name="institute"
          facet="institute"
          options={masters.institutes}
          value={selected.institute ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Teacher">
        <FacetSelect
          name="teacher"
          facet="teacher"
          options={masters.teachers}
          value={selected.teacher ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Course">
        <FacetSelect
          name="course"
          facet="course"
          options={masters.courses}
          value={selected.course ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Subject">
        <FacetSelect
          name="subject"
          facet="subject"
          options={subjectsForCourse}
          value={selected.subject ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Content">
        <FacetSelect
          name="content"
          facet="content"
          options={masters.contents}
          value={selected.content ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Term">
        <FacetSelect
          name="term"
          facet="term"
          options={masters.terms}
          value={selected.term ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Source">
        <FacetSelect
          name="source"
          facet="source"
          options={masters.sources}
          value={selected.source ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Importance">
        <FacetSelect
          name="importance"
          facet="importance"
          options={IMPORTANCE_OPTIONS}
          value={selected.importance ?? ""}
          facets={facets}
        />
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
