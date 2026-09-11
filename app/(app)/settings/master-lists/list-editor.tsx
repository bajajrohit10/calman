"use client";

import { Fragment, useActionState, useEffect, useMemo, useState } from "react";

import {
  fillTemplate,
  PLACEHOLDERS,
  STAGE_LABELS,
  type Stage,
} from "@/lib/whatsapp-text";

import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Input,
  Select,
  Textarea,
  cx,
} from "@/components/ui";

import {
  createItem,
  setItemActive,
  updateItem,
  type ListActionResult,
} from "./actions";
import type { FieldSpec, ListSpec } from "./config";
import type { Row } from "./page";

const EMPTY: ListActionResult = { error: null };

type Course = { id: string; name: string };

function FieldInput({
  field,
  defaultValue,
  courses,
  institutes,
  autoFocus,
}: {
  field: FieldSpec;
  defaultValue?: unknown;
  courses: Course[];
  institutes: Course[];
  autoFocus?: boolean;
}) {
  const value = defaultValue == null ? "" : String(defaultValue);

  if (field.kind === "stage") {
    return (
      <Select name={field.name} defaultValue={value || "any"}>
        {Object.entries(STAGE_LABELS).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </Select>
    );
  }

  if (field.kind === "institute") {
    return (
      <Select name={field.name} defaultValue={value} required={field.required}>
        {/* Optional: a teacher with no institute yet is the normal state until
            the teacher→institute sheet is loaded. */}
        <option value="">No institute</option>
        {institutes.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
    );
  }

  if (field.kind === "course") {
    return (
      <Select name={field.name} defaultValue={value} required={field.required}>
        <option value="">Choose a course…</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    );
  }

  if (field.kind === "textarea") {
    return (
      <Textarea
        name={field.name}
        defaultValue={value}
        required={field.required}
        rows={3}
        placeholder={field.placeholder}
        autoFocus={autoFocus}
      />
    );
  }

  return (
    <Input
      name={field.name}
      type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
      defaultValue={value}
      required={field.required}
      placeholder={field.placeholder}
      autoFocus={autoFocus}
    />
  );
}

function AddForm({ spec, courses, institutes }: { spec: ListSpec; courses: Course[]; institutes: Course[] }) {
  const [state, action] = useActionState(createItem, EMPTY);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add {spec.label.replace(/s$/, "").toLowerCase()}
      </Button>
    );
  }

  return (
    <form action={action} className="rounded-lg border border-line bg-surface p-4">
      <input type="hidden" name="table" value={spec.table} />
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">New entry</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {spec.fields.map((field, i) => (
          <div key={field.name} className={cx(field.width ?? "min-w-[220px] flex-1")}>
            <Field label={field.label} hint={field.hint}>
              <FieldInput field={field} courses={courses} institutes={institutes} autoFocus={i === 0} />
            </Field>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Button type="submit" variant="primary">
          Add
        </Button>
      </div>

      {state.error ? (
        <div className="mt-3">
          <ErrorNote>{state.error}</ErrorNote>
        </div>
      ) : null}
    </form>
  );
}

function EditableRow({
  spec,
  row,
  courses,
  institutes,
}: {
  spec: ListSpec;
  row: Row;
  courses: Course[];
  institutes: Course[];
}) {
  const [saveState, saveAction] = useActionState(updateItem, EMPTY);
  const [activeState, activeAction] = useActionState(setItemActive, EMPTY);

  // Opening the editor records the action state it opened against.
  // useActionState hands back a fresh object per submit, so "a result arrived
  // since we opened" is just an identity check — no effect pushing state, and
  // a failed save keeps the form open with its error rather than closing.
  const [openedAt, setOpenedAt] = useState<ListActionResult | null>(null);
  const [noticeDone, setNoticeDone] = useState(false);
  const saved = openedAt !== null && saveState !== openedAt && Boolean(saveState.ok);
  const editing = openedAt !== null && !saved;

  useEffect(() => {
    if (!saved || noticeDone) return;
    const timer = setTimeout(() => setNoticeDone(true), 2500);
    return () => clearTimeout(timer);
  }, [saved, noticeDone]);

  function openEditor() {
    setOpenedAt(saveState);
    setNoticeDone(false);
  }

  const id = String(row[spec.pk]);
  const active = row.is_active !== false;

  if (editing) {
    return (
      <tr className="border-b border-line bg-surface-2 last:border-b-0">
        <td colSpan={spec.fields.length + 2} className="px-3 py-3">
          <form action={saveAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="table" value={spec.table} />
            <input type="hidden" name="id" value={id} />
            {spec.fields
              .filter((f) => f.name !== spec.pk)
              .map((field, i) => (
                <div key={field.name} className={cx(field.width ?? "min-w-[220px] flex-1")}>
                  <Field label={field.label} hint={field.hint}>
                    <FieldInput
                      field={field}
                      defaultValue={row[field.name]}
                      courses={courses} institutes={institutes}
                      autoFocus={i === 0}
                    />
                  </Field>
                </div>
              ))}
            <div className="flex gap-1.5 pb-0.5">
              <Button type="submit" variant="primary" size="sm">
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpenedAt(null)}
              >
                Cancel
              </Button>
            </div>
            {saveState.error ? (
              <span className="w-full text-[11.5px] text-danger" role="alert">
                {saveState.error}
              </span>
            ) : null}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={cx(
        "border-b border-line last:border-b-0",
        !active && "bg-sunk/40 text-ink-3",
      )}
    >
      {spec.fields.map((field) => {
        const raw = row[field.name];
        let display: string;
        if (field.kind === "stage") {
          display = STAGE_LABELS[(raw as Stage) ?? "any"] ?? String(raw ?? "—");
        } else if (field.kind === "course") {
          display = courses.find((c) => c.id === raw)?.name ?? "—";
        } else if (field.kind === "institute") {
          display = institutes.find((i) => i.id === raw)?.name ?? "—";
        } else if (raw == null || raw === "") {
          display = "—";
        } else {
          display = String(raw);
        }

        return (
          <td
            key={field.name}
            className={cx(
              "px-3 py-2 align-top",
              field.kind === "number" && "tabular-nums",
              field.name === "name" && active && "font-medium text-ink",
              field.kind === "textarea" && "max-w-md whitespace-pre-wrap text-ink-2",
            )}
          >
            {display}
          </td>
        );
      })}

      <td className="px-3 py-2 align-top">
        {active ? (
          <Badge tone="ok">Active</Badge>
        ) : (
          <Badge tone="neutral">Inactive</Badge>
        )}
      </td>

      <td className="px-3 py-2 align-top">
        <div className="flex items-center justify-end gap-1">
          {saved && !noticeDone ? (
            <span className="mr-1 text-[11px] text-ok" role="status">
              Saved
            </span>
          ) : null}
          <Button size="sm" variant="ghost" onClick={openEditor}>
            Edit
          </Button>
          <form action={activeAction}>
            <input type="hidden" name="table" value={spec.table} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="active" value={String(!active)} />
            <Button type="submit" size="sm" variant={active ? "ghost" : "secondary"}>
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          </form>
        </div>
        {activeState.error ? (
          <span className="block text-right text-[11px] text-danger" role="alert">
            {activeState.error}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function ListEditor({
  spec,
  rows,
  courses,
  institutes,
}: {
  spec: ListSpec;
  rows: Row[];
  courses: Course[];
  institutes: Course[];
}) {
  const [showInactive, setShowInactive] = useState(false);

  const visible = useMemo(
    () => (showInactive ? rows : rows.filter((r) => r.is_active !== false)),
    [rows, showInactive],
  );

  const inactiveCount = rows.filter((r) => r.is_active === false).length;

  // Subjects read far better grouped under their course than as one flat list
  // of "DT, FM, IDT, …" with a course column repeated down the side.
  const groups = useMemo(() => {
    if (!spec.groupByCourse)
      return [{ id: "all", title: null as string | null, rows: visible }];
    const byCourse = new Map<string, Row[]>();
    for (const row of visible) {
      const key = String(row.course_id ?? "");
      if (!byCourse.has(key)) byCourse.set(key, []);
      byCourse.get(key)!.push(row);
    }
    return [...byCourse.entries()]
      .map(([courseId, groupRows]) => ({
        // Keyed by course id, not title: two unplaced courses would both fall
        // back to "Unknown course" and collide.
        id: courseId,
        title: courses.find((c) => c.id === courseId)?.name ?? "Unknown course",
        rows: groupRows,
      }))
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  }, [visible, spec.groupByCourse, courses]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">
            {spec.label}{" "}
            <span className="font-normal text-ink-3">({visible.length})</span>
          </h2>
          <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-ink-2">
            {spec.blurb}
          </p>
          {spec.table === "whatsapp_templates" ? (
            <TemplateHelp rows={visible} />
          ) : null}
        </div>
        <AddForm spec={spec} courses={courses} institutes={institutes} />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="accent-accent"
          />
          Show inactive
          {inactiveCount > 0 ? (
            <span className="text-ink-3">({inactiveCount})</span>
          ) : null}
        </label>
        <span className="text-[11.5px] text-ink-3">
          Entries are never deleted — deactivated options stay on historical rows.
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              {spec.fields.map((field) => (
                <th
                  key={field.name}
                  scope="col"
                  className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-3"
                >
                  {field.label}
                </th>
              ))}
              <th
                scope="col"
                className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-3"
              >
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.id}>
                {group.title ? (
                  <tr className="border-b border-line bg-sunk/60">
                    <td
                      colSpan={spec.fields.length + 2}
                      className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2"
                    >
                      {group.title}
                    </td>
                  </tr>
                ) : null}
                {group.rows.map((row) => (
                  <EditableRow
                    key={String(row[spec.pk])}
                    spec={spec}
                    row={row}
                    courses={courses} institutes={institutes}
                  />
                ))}
              </Fragment>
            ))}

            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={spec.fields.length + 2}
                  className="px-3 py-6 text-center text-ink-3"
                >
                  Nothing in {spec.label.toLowerCase()} yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* -------------------------------------------------------------------------- */

/** A sample enquiry, so the preview shows real substitution rather than prose. */
const SAMPLE = {
  name: "Ravi Kumar",
  items: [
    { teacher: "Bhanwar Borana", course: "CA Final", subject: "DT", content: "Full" },
    { teacher: "Vishal Bhattad", course: "CA Final", subject: "Audit", content: "FT" },
  ],
  term: "May-27",
  counsellor: "You",
};

/**
 * §5.10's placeholder reference, a live preview, and the one thing a list of
 * templates cannot tell you by looking: which stage has nothing written for it
 * yet, so the picker will silently fall back to 'any'.
 */
function TemplateHelp({ rows }: { rows: Row[] }) {
  const [preview, setPreview] = useState<string>(
    "Hi {name}, about {teacher} for {subject} ({content}) — {term}. — {counsellor}",
  );

  const covered = new Set(
    rows.filter((r) => r.is_active !== false).map((r) => String(r.stage ?? "any")),
  );
  const missing = (Object.keys(STAGE_LABELS) as Stage[]).filter(
    (s) => s !== "any" && !covered.has(s),
  );

  return (
    <div className="mt-2 flex max-w-3xl flex-col gap-2">
      <div className="rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[12px] text-ink-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {PLACEHOLDERS.map((p) => (
            <span key={p.token}>
              <code className="font-mono text-ink">{p.token}</code> {p.description}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-ink-3">
          A value the enquiry does not have renders as nothing — never as the
          placeholder itself. Several interests join with commas.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
          Try a message
        </span>
        <Textarea rows={2} value={preview} onChange={(e) => setPreview(e.target.value)} />
      </label>
      <p className="rounded-md border border-ok/40 bg-ok-soft/40 px-2.5 py-1.5 text-[12.5px] whitespace-pre-wrap text-ink">
        {fillTemplate(preview, SAMPLE)}
      </p>

      {missing.length ? (
        <p className="rounded-md border border-warn/40 bg-warn-soft/50 px-2.5 py-1.5 text-[12px] text-warn">
          No active template for {missing.map((s) => STAGE_LABELS[s]).join(", ")}. The
          picker will fall back to an &ldquo;Any&rdquo; template at those stages.
        </p>
      ) : null}
    </div>
  );
}
