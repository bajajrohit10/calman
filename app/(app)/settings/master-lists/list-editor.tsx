"use client";

import { Fragment, useActionState, useMemo, useState } from "react";

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
  autoFocus,
}: {
  field: FieldSpec;
  defaultValue?: unknown;
  courses: Course[];
  autoFocus?: boolean;
}) {
  const value = defaultValue == null ? "" : String(defaultValue);

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

function AddForm({ spec, courses }: { spec: ListSpec; courses: Course[] }) {
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
              <FieldInput field={field} courses={courses} autoFocus={i === 0} />
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
}: {
  spec: ListSpec;
  row: Row;
  courses: Course[];
}) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction] = useActionState(updateItem, EMPTY);
  const [activeState, activeAction] = useActionState(setItemActive, EMPTY);

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
                      courses={courses}
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
                onClick={() => setEditing(false)}
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
        if (field.kind === "course") {
          display = courses.find((c) => c.id === raw)?.name ?? "—";
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
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
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
}: {
  spec: ListSpec;
  rows: Row[];
  courses: Course[];
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
            <p className="mt-1.5 max-w-2xl rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2">
              Placeholders: <code className="font-mono text-ink">{"{name}"}</code> becomes
              the student&rsquo;s name and{" "}
              <code className="font-mono text-ink">{"{course}"}</code> the course from the
              enquiry. Both are filled in before the preview opens, and anything else is
              sent literally.
            </p>
          ) : null}
        </div>
        <AddForm spec={spec} courses={courses} />
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
                    courses={courses}
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
