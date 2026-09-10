"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import { TABLES } from "./config";

export type ListActionResult = { error: string | null; ok?: string };

/**
 * This screen is one engine over eight tables, so the row shape is only known
 * at run time. The generated types cannot express "a row belonging to
 * whichever of these eight", so the write surface is narrowed structurally,
 * once, here — rather than scattering casts through every call site. The
 * table name is still checked against the config allowlist before use.
 */
type PgResult = { error: { message: string } | null };

type GenericWriter = {
  insert(values: Record<string, unknown>): PromiseLike<PgResult>;
  update(values: Record<string, unknown>): {
    eq(column: string, value: unknown): PromiseLike<PgResult>;
  };
};

/**
 * Master-list writes go through the caller's own session, not the service
 * role, so the RLS policies written in the first migration are what decide
 * whether this is allowed — a counsellor reaching this endpoint directly gets
 * a database refusal, not a silent success.
 *
 * The table name still has to be checked against the config allowlist: it
 * arrives in a form field, and PostgREST would happily aim at any table the
 * caller can reach.
 */
function resolveTable(formData: FormData) {
  const table = String(formData.get("table") ?? "");
  const spec = TABLES[table];
  if (!spec) return null;
  return spec;
}

function readFields(formData: FormData, spec: NonNullable<ReturnType<typeof resolveTable>>) {
  const values: Record<string, string | number | null> = {};

  for (const field of spec.fields) {
    const raw = formData.get(field.name);
    if (raw === null) continue;
    const text = String(raw).trim();

    if (field.kind === "number") {
      values[field.name] = text === "" ? 0 : Number(text);
      if (Number.isNaN(values[field.name] as number)) {
        throw new Error(`${field.label} must be a number.`);
      }
    } else {
      if (field.required && text === "") {
        throw new Error(`${field.label} is required.`);
      }
      values[field.name] = text === "" ? null : text;
    }
  }

  return values;
}

export async function createItem(
  _prev: ListActionResult,
  formData: FormData,
): Promise<ListActionResult> {
  const spec = resolveTable(formData);
  if (!spec) return { error: "Unknown list." };

  let values;
  try {
    values = readFields(formData, spec);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const supabase = await createClient();
  const table = supabase.from(spec.table) as unknown as GenericWriter;
  const { error } = await table.insert(values);

  if (error) return { error: friendly(error.message, spec.label) };

  revalidatePath("/settings/master-lists");
  return { error: null, ok: "Added." };
}

export async function updateItem(
  _prev: ListActionResult,
  formData: FormData,
): Promise<ListActionResult> {
  const spec = resolveTable(formData);
  if (!spec) return { error: "Unknown list." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing row identifier." };

  let values;
  try {
    values = readFields(formData, spec);
  } catch (e) {
    return { error: (e as Error).message };
  }

  // The primary key is not editable: changing a holiday's date would be an
  // insert, not an edit, and every other list keys on a generated id.
  delete values[spec.pk];

  const supabase = await createClient();
  const table = supabase.from(spec.table) as unknown as GenericWriter;
  const { error } = await table.update(values).eq(spec.pk, id);

  if (error) return { error: friendly(error.message, spec.label) };

  revalidatePath("/settings/master-lists");
  return { error: null, ok: "Saved." };
}

export async function setItemActive(
  _prev: ListActionResult,
  formData: FormData,
): Promise<ListActionResult> {
  const spec = resolveTable(formData);
  if (!spec) return { error: "Unknown list." };

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return { error: "Missing row identifier." };

  const supabase = await createClient();
  const table = supabase.from(spec.table) as unknown as GenericWriter;
  const { error } = await table.update({ is_active: active }).eq(spec.pk, id);

  if (error) return { error: friendly(error.message, spec.label) };

  revalidatePath("/settings/master-lists");
  return { error: null, ok: active ? "Reactivated." : "Deactivated." };
}

/** Postgres error text is precise but unfriendly; translate the common ones. */
function friendly(message: string, label: string) {
  if (/duplicate key|already exists|unique constraint/i.test(message)) {
    return `That entry already exists in ${label}.`;
  }
  if (/row-level security|permission denied/i.test(message)) {
    return "You do not have permission to change master lists.";
  }
  if (/violates foreign key/i.test(message)) {
    return "That refers to something which no longer exists.";
  }
  return message;
}
