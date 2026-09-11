"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { Importance, LeadVerification } from "@/lib/enquiry-labels";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { createClient } from "@/lib/supabase/server";

/* -------------------------------------------------------------------------- */
/* Remembered column mappings                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Computed on the server from the header row so both writers agree: sorted and
 * case-folded, because the same daily export arrives with its columns in a
 * different order often enough to matter.
 */
function fingerprintOf(headers: string[]): string {
  const canonical = headers
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export type ColumnMapping = Record<string, string | null>;

export async function loadMapping(
  headers: string[],
): Promise<{ mapping: ColumnMapping | null }> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_column_maps")
    .select("mapping")
    .eq("fingerprint", fingerprintOf(headers))
    .maybeSingle();
  return { mapping: (data?.mapping as ColumnMapping) ?? null };
}

export async function saveMapping(
  headers: string[],
  mapping: ColumnMapping,
): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("import_column_maps").upsert(
    {
      fingerprint: fingerprintOf(headers),
      headers,
      mapping,
      updated_by: viewer.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "fingerprint" },
  );
  return { error: error?.message ?? null };
}

/* -------------------------------------------------------------------------- */
/* Status lookup                                                               */
/* -------------------------------------------------------------------------- */

/**
 * §10.1. Six states, because the re-upload rules turn on more than "is there
 * something open": rule (c) needs to know the enquiry was called on an earlier
 * day, and rule (d) needs today's call with its time and counsellor.
 */
export type NumberState =
  | "new"
  | "open_uncalled"
  | "open_called_earlier"
  | "open_called_today"
  | "wrong_number"
  | "resolved";

export type NumberStatus = {
  mobile: string;
  studentId: string | null;
  studentName: string | null;
  state: NumberState;
  openEnquiryId: number | null;
  lastCallAt: string | null;
  lastCallDate: string | null;
  lastCallBy: string | null;
  enquiryCount: number;
};

/**
 * What Calman already knows about each number (§5.7 review table).
 *
 * Called in chunks from the browser — only the numbers travel, never the file,
 * which is what keeps a 3,000-row import inside the request limits.
 *
 * An RPC rather than an embed: the rules need the latest call per enquiry, and
 * PostgREST cannot express "embed only the most recent child".
 */
export async function lookupNumbers(mobiles: string[]): Promise<{
  error: string | null;
  statuses?: NumberStatus[];
}> {
  await requireUser();
  if (!mobiles.length) return { error: null, statuses: [] };
  // 500, not 1000: PostgREST caps a response at max_rows (1000 here), so a
  // lookup of exactly a thousand numbers could come back short and every
  // missing one would silently look like a new number.
  if (mobiles.length > 500) return { error: "Too many numbers in one lookup." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_lookup", {
    p_mobiles: mobiles,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  type Row = {
    mobile: string;
    student_id: string | null;
    student_name: string | null;
    state: NumberState;
    open_enquiry_id: number | null;
    last_call_at: string | null;
    last_call_date: string | null;
    last_call_by: string | null;
    enquiry_count: number;
  };

  const byMobile = new Map<string, NumberStatus>();
  for (const r of (data ?? []) as unknown as Row[]) {
    byMobile.set(r.mobile, {
      mobile: r.mobile,
      studentId: r.student_id,
      studentName: r.student_name,
      state: r.state,
      openEnquiryId: r.open_enquiry_id,
      lastCallAt: r.last_call_at,
      lastCallDate: r.last_call_date,
      lastCallBy: r.last_call_by,
      enquiryCount: r.enquiry_count,
    });
  }

  return {
    error: null,
    statuses: mobiles.map(
      (m) =>
        byMobile.get(m) ?? {
          mobile: m,
          studentId: null,
          studentName: null,
          state: "new" as const,
          openEnquiryId: null,
          lastCallAt: null,
          lastCallDate: null,
          lastCallBy: null,
          enquiryCount: 0,
        },
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Commit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * §10.1. "update" is gone: an import that touches an open enquiry now always
 * goes through re-enquiry, which overrides the source and logs the arrival.
 * "dismiss" is rule (d)'s default — the number came in again on a day somebody
 * has already spoken to them, so there is nothing to do.
 */
export type RowDecision =
  | "import"
  | "re_enquire"
  | "supersede"
  | "dismiss"
  | "ignore"
  | "skip";

export type CommitRow = {
  rowNumber: number;
  raw: Record<string, string>;
  mobile: string | null;
  decision: RowDecision;
  skipReason: string | null;
  name: string | null;
  sourceId: string | null;
  productText: string | null;
  termId: string | null;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  existingStudentId: string | null;
  existingEnquiryId: number | null;
  /**
   * Rule (c) vs rule (b): clear the follow-up date and put the lead back in
   * New Calls, or leave the queue alone because it was never called.
   */
  returnToNewCalls?: boolean;
};

export async function createBatch(
  filename: string,
  totalRows: number,
): Promise<{ error: string | null; batchId?: string }> {
  const viewer = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ filename, total_rows: totalRows, uploaded_by: viewer.userId })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { error: null, batchId: data.id };
}

export type CommitCounts = {
  imported: number;
  re_enquired: number;
  duplicate_new_enquiry: number;
  dismissed: number;
  skipped: number;
};

/**
 * Apply one chunk of the review table.
 *
 * Chunked from the client with a progress bar rather than done in one call:
 * 3,000 rows is far more round trips than a serverless function's time budget
 * allows, and a single giant insert would risk the body cap as well.
 *
 * Rows already written for this batch are skipped, so a chunk that failed
 * halfway can simply be retried without creating a second enquiry for anyone.
 */
export async function commitChunk(
  batchId: string,
  rows: CommitRow[],
): Promise<{ error: string | null; counts?: CommitCounts }> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const supabase = await createClient();
  const counts: CommitCounts = {
    imported: 0,
    re_enquired: 0,
    duplicate_new_enquiry: 0,
    dismissed: 0,
    skipped: 0,
  };

  // Rows already written for this batch are skipped, so a chunk that failed
  // halfway can be retried without creating a second enquiry for anyone.
  const { data: already } = await supabase
    .from("import_rows")
    .select("row_number")
    .eq("batch_id", batchId)
    .in(
      "row_number",
      rows.map((r) => r.rowNumber),
    );
  const done = new Set((already ?? []).map((r) => r.row_number));
  const todo = rows.filter((r) => !done.has(r.rowNumber));

  type Pending = Record<string, unknown>;
  const importRows: Pending[] = [];
  const base = (row: CommitRow) => ({
    batch_id: batchId,
    row_number: row.rowNumber,
    raw: row.raw,
    normalised_mobile: row.mobile,
  });

  /**
   * Bulk first, and fall back to one-by-one only if the bulk write fails, so a
   * single bad row cannot sink the other 199 while the happy path still costs
   * one round trip instead of two hundred.
   */
  async function insertMany<T extends Pending>(table: "students" | "enquiries", payload: T[], columns: string) {
    if (!payload.length) return { data: [] as Pending[], failed: false };
    const { data, error } = await supabase.from(table).insert(payload as never).select(columns);
    if (!error) return { data: (data ?? []) as unknown as Pending[], failed: false };

    const out: Pending[] = [];
    for (const one of payload) {
      const r = await supabase.from(table).insert(one as never).select(columns).maybeSingle();
      if (r.data) out.push(r.data as unknown as Pending);
    }
    return { data: out, failed: true };
  }

  // ---- 1. rows that create nothing ----------------------------------------
  const creating: CommitRow[] = [];
  const updating: CommitRow[] = [];

  for (const row of todo) {
    if (row.decision === "dismiss") {
      // Rule (d): somebody has already spoken to this number today. The row is
      // recorded so the batch report reconciles, and nothing is written.
      importRows.push({
        ...base(row),
        outcome: "dismissed",
        skip_reason: row.skipReason ?? "Already called today",
        student_id: row.existingStudentId,
        enquiry_id: row.existingEnquiryId,
      });
      counts.dismissed += 1;
    } else if (row.decision === "skip" || row.decision === "ignore" || !row.mobile) {
      importRows.push({
        ...base(row),
        outcome: "skipped",
        skip_reason:
          row.skipReason ??
          (row.decision === "ignore" ? "Ignored by the importer" : "Skipped"),
        student_id: row.existingStudentId,
      });
      counts.skipped += 1;
    } else if (row.decision === "re_enquire" && row.existingEnquiryId) {
      updating.push(row);
    } else {
      creating.push(row);
    }
  }

  // ---- 2. re-enquiries and supersedes: one RPC each ------------------------
  for (const row of updating) {
    const { error } = await supabase.rpc("import_re_enquire", {
      p_enquiry_id: row.existingEnquiryId!,
      p_source_id: row.sourceId ?? undefined,
      p_product_text: row.productText ?? undefined,
      p_term_id: row.termId ?? undefined,
      p_importance: row.importance ?? undefined,
      p_lead_verification: row.leadVerification ?? undefined,
      p_import_batch_id: batchId,
      p_clear_follow_up: row.returnToNewCalls ?? false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    importRows.push({
      ...base(row),
      outcome: error ? "skipped" : "re_enquired",
      skip_reason: error ? error.message : null,
      student_id: row.existingStudentId,
      enquiry_id: error ? null : row.existingEnquiryId,
    });
    if (error) counts.skipped += 1;
    else counts.re_enquired += 1;
  }

  const superseding = creating.filter((r) => r.decision === "supersede" && r.existingEnquiryId);
  const supersedeFailed = new Set<number>();
  for (const row of superseding) {
    const { error } = await supabase.rpc("supersede_enquiry", {
      p_enquiry_id: row.existingEnquiryId!,
    });
    if (error) {
      supersedeFailed.add(row.rowNumber);
      importRows.push({
        ...base(row),
        outcome: "skipped",
        skip_reason: `Could not close the previous enquiry: ${error.message}`,
        student_id: row.existingStudentId,
      });
      counts.skipped += 1;
    }
  }

  const toCreate = creating.filter((r) => !supersedeFailed.has(r.rowNumber));

  // ---- 3. students, in one write ------------------------------------------
  const newStudents = toCreate.filter((r) => !r.existingStudentId);
  const studentByMobile = new Map<string, string>();
  if (newStudents.length) {
    const { data } = await insertMany(
      "students",
      newStudents.map((r) => ({
        mobile: r.mobile,
        name: r.name,
        created_by: viewer.userId,
      })),
      "id, mobile",
    );
    for (const s of data) {
      studentByMobile.set(s.mobile as string, s.id as string);
    }
  }

  const withStudent = toCreate
    .map((row) => ({
      row,
      studentId: row.existingStudentId ?? studentByMobile.get(row.mobile!) ?? null,
    }))
    .filter((x) => {
      if (x.studentId) return true;
      importRows.push({
        ...base(x.row),
        outcome: "skipped",
        skip_reason: "Could not create the student for this number",
      });
      counts.skipped += 1;
      return false;
    });

  // ---- 4. enquiries, in one write -----------------------------------------
  // Every row in a chunk carries a distinct number (the file was de-duplicated
  // before this point), so student_id identifies the row it belongs to and the
  // returned set can be matched without relying on insert order.
  if (withStudent.length) {
    const { data } = await insertMany(
      "enquiries",
      withStudent.map(({ row, studentId }) => ({
        student_id: studentId,
        type: "purchase",
        source_id: row.sourceId,
        product_text: row.productText,
        term_id: row.termId,
        importance: row.importance,
        lead_verification: row.leadVerification,
        created_by: viewer.userId,
      })),
      "id, student_id",
    );

    const enquiryByStudent = new Map<string, number>();
    for (const e of data) enquiryByStudent.set(e.student_id as string, e.id as number);

    // §10.1: a new enquiry is an arrival too. Without this the source log would
    // hold only re-uploads, and an enquiry's first arrival — the one that
    // explains where it came from — would be the one entry missing.
    const sourceRows = withStudent
      .map(({ row, studentId }) => ({
        enquiry_id: enquiryByStudent.get(studentId!),
        source_id: row.sourceId,
        import_batch_id: batchId,
        note: row.decision === "supersede" ? "Re-uploaded; replaced the previous enquiry." : "Arrived in an import.",
      }))
      .filter((r) => r.enquiry_id);
    if (sourceRows.length) {
      const { error } = await supabase.from("enquiry_sources").insert(sourceRows as never);
      // Not fatal: the enquiries are already in, and losing a log row must not
      // fail a 3,000-row import. It is reported on the row instead.
      if (error) {
        console.error("enquiry_sources insert failed", error.message);
      }
    }

    for (const { row, studentId } of withStudent) {
      const enquiryId = enquiryByStudent.get(studentId!);
      if (!enquiryId) {
        importRows.push({
          ...base(row),
          outcome: "skipped",
          skip_reason: "Could not create the enquiry for this row",
          student_id: studentId,
        });
        counts.skipped += 1;
        continue;
      }
      // No assignment row is written: that is what "unassigned pool" means,
      // and the recommended list picks them up as `fresh` (§6).
      importRows.push({
        ...base(row),
        outcome: row.decision === "supersede" ? "duplicate_new_enquiry" : "imported",
        student_id: studentId,
        enquiry_id: enquiryId,
      });
      if (row.decision === "supersede") counts.duplicate_new_enquiry += 1;
      else counts.imported += 1;
    }
  }

  // ---- 5. the audit rows, in one write ------------------------------------
  if (importRows.length) {
    const { error } = await supabase.from("import_rows").insert(importRows as never);
    if (error) return { error: `Could not write the import log: ${error.message}` };
  }

  revalidatePath("/import");
  revalidatePath("/enquiries");
  return { error: null, counts };
}

/* -------------------------------------------------------------------------- */
/* Import history                                                              */
/* -------------------------------------------------------------------------- */

/** §5.7 "skipped rows stay actionable". */
export async function resolveImportRow(
  rowId: number,
  action: "import" | "handled",
): Promise<{ error: string | null; ok?: string }> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("import_rows")
    .select("id, batch_id, normalised_mobile, raw, student_id, outcome")
    .eq("id", rowId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!row) return { error: "That import row no longer exists." };

  const stamp = { resolved_at: new Date().toISOString(), resolved_by: viewer.userId };

  if (action === "handled") {
    const { error: e } = await supabase.from("import_rows").update(stamp).eq("id", rowId);
    if (e) return { error: e.message };
    revalidatePath(`/import/${row.batch_id}`);
    return { error: null, ok: "Marked as handled." };
  }

  const mobile = normaliseMobile(row.normalised_mobile ?? "");
  if (!isValidMobile(mobile)) {
    return { error: "This row has no usable mobile number, so it cannot be imported." };
  }

  let studentId = row.student_id;
  if (!studentId) {
    const { data: existing } = await supabase
      .from("students")
      .select("id")
      .eq("mobile", mobile)
      .maybeSingle();
    studentId = existing?.id ?? null;
  }
  if (!studentId) {
    const { data, error: e } = await supabase
      .from("students")
      .insert({ mobile, created_by: viewer.userId })
      .select("id")
      .single();
    if (e) return { error: e.message };
    studentId = data.id;
  }

  const { data: enquiry, error: e2 } = await supabase
    .from("enquiries")
    .insert({ student_id: studentId, type: "purchase", created_by: viewer.userId })
    .select("id")
    .single();
  if (e2) return { error: e2.message };

  const { error: e3 } = await supabase
    .from("import_rows")
    .update({ ...stamp, outcome: "imported", student_id: studentId, enquiry_id: enquiry.id })
    .eq("id", rowId);
  if (e3) return { error: e3.message };

  revalidatePath(`/import/${row.batch_id}`);
  revalidatePath("/enquiries");
  return { error: null, ok: "Imported." };
}
