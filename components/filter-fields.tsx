"use client";

import { useMemo } from "react";

import { MultiSelect } from "@/components/multi-select";
import { FIELD_LABEL, FILLED, Input, Select, cx } from "@/components/ui";
import { IMPORTANCE_LABELS, STAGE_FILTER_LABELS } from "@/lib/enquiry-labels";
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
    // A filter that is doing something says so: the same accent edge the
    // multi-selects wear, so a glance across the bar finds what is narrowing
    // the list without reading every value.
    <Select name={name} defaultValue={value} className={value ? FILLED : undefined}>
      <option value="">{anyLabel}</option>
      {ordered.map((o) => {
        const empty = isEmptyOption(facet, o.id, facets);
        return (
          <option
            key={o.id}
            value={o.id}
            className={empty ? "text-ink-3" : undefined}
          >
            {facets ? countLabel(o.name, facet, counts?.[o.id]) : o.name}
          </option>
        );
      })}
    </Select>
  );
}

/**
 * One filter cell.
 *
 * `flex-1` with a fixed basis is what keeps the bar tidy: the cells wrap and
 * then stretch to fill their row, so the last row is as full as the ones above
 * it however many filters a screen has. The grid this replaced left whatever
 * was left over sitting alone in a quarter-width cell — the Institute row on
 * New Calls — and needed re-counting every time a filter was added.
 */
export function Labelled({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  /** Text search boxes earn twice the room. */
  wide?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex min-w-[11rem] flex-col gap-[3px]",
        wide ? "flex-[2_1_16rem]" : "flex-[1_1_11rem]",
      )}
    >
      <span className={FIELD_LABEL}>{label}</span>
      {children}
    </label>
  );
}

const IMPORTANCE_OPTIONS: FilterMaster[] = Object.entries(IMPORTANCE_LABELS).map(
  ([id, name]) => ({ id, name }),
);

const STAGE_OPTIONS: FilterMaster[] = Object.entries(STAGE_FILTER_LABELS).map(
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
  multi,
}: {
  masters: FilterMasters;
  selected: Record<string, string>;
  /** Multi-select selections, by query-string key. */
  multi?: Record<string, string[]>;
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
      <Labelled label="Source">
        <FacetSelect
          name="source"
          facet="source"
          options={masters.sources}
          value={selected.source ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Teacher">
        <MultiSelect
          name="teacher"
          facet="teacher"
          options={masters.teachers}
          values={multi?.teacher ?? []}
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
        <MultiSelect
          name="content"
          facet="content"
          options={masters.contents}
          values={multi?.content ?? []}
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

      <Labelled label="Term">
        <FacetSelect
          name="term"
          facet="term"
          options={masters.terms}
          value={selected.term ?? ""}
          facets={facets}
        />
      </Labelled>

      <Labelled label="Institute">
        <FacetSelect
          name="institute"
          facet="institute"
          options={masters.institutes}
          value={selected.institute ?? ""}
          facets={facets}
        />
      </Labelled>

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

      <Labelled label="Stage">
        <MultiSelect
          name="stage"
          facet="stage"
          options={STAGE_OPTIONS}
          values={multi?.stage ?? []}
          facets={facets}
        />
      </Labelled>

      {/* Paired with Stage on purpose: "fresh call yesterday and nothing
          since" is one stage plus one date. */}
      <Labelled label="Last called between" wide>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            name="lastCalledFrom"
            defaultValue={selected.lastCalledFrom ?? ""}
          />
          <span className="text-[12px] text-ink-3">→</span>
          <Input type="date" name="lastCalledTo" defaultValue={selected.lastCalledTo ?? ""} />
        </div>
      </Labelled>

      <Labelled label="Discussion contains" wide>
        <Input name="q" defaultValue={selected.q ?? ""} placeholder="text in any call note" />
      </Labelled>

      <Labelled label="Enquired between" wide>
        <div className="flex items-center gap-1.5">
          <Input type="date" name="createdFrom" defaultValue={selected.createdFrom ?? ""} />
          <span className="text-[12px] text-ink-3">→</span>
          <Input type="date" name="createdTo" defaultValue={selected.createdTo ?? ""} />
        </div>
      </Labelled>

      <Labelled label="Follow-up between" wide>
        <div className="flex items-center gap-1.5">
          <Input type="date" name="followUpFrom" defaultValue={selected.followUpFrom ?? ""} />
          <span className="text-[12px] text-ink-3">→</span>
          <Input type="date" name="followUpTo" defaultValue={selected.followUpTo ?? ""} />
        </div>
      </Labelled>
    </>
  );
}
