"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { Importance, LeadVerification } from "@/lib/enquiry-labels";
import { describeNumber, type NumberState, type NumberStatus } from "@/lib/duplicate-rules";
import { applyAutoInterests } from "@/lib/auto-interests";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { looksLikeShopify } from "@/lib/shopify-checkouts";
import { fillBlankStudentName } from "@/lib/student-name";
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
  /**
   * §55.4. A Shopify export has no mapping worth remembering.
   *
   * Its pre-step knows the column names and never reads this table, so a saved
   * map for that header shape can only have come from a client that took the
   * generic path — and saving it makes the next upload repeat whatever that
   * client got wrong. One did: the guess matched "Lineitem quantity" before
   * "Lineitem name" (both contain "item", and find() takes the first), it was
   * saved, and a day's leads imported with the word "1" as their product text.
   */
  if (looksLikeShopify(headers)) return { error: null };
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
 * §10.1's six states and the facts the five sentences are built from now live
 * in lib/duplicate-rules, with the wording (Brief 31). Re-exported here
 * because this is where every caller already imports them from, and moving the
 * definition should not mean editing eight import lines.
 */
export type { NumberState, NumberStatus };

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
    closed_on: string | null;
    closed_as: "won" | "lost" | "wrong_number" | null;
    assigned_to: string | null;
    ticket_enquiry_id: number | null;
    ticket_status: "open" | "escalated" | null;
    ticket_note_by: string | null;
    ticket_note_on: string | null;
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
      closedOn: r.closed_on,
      closedAs: r.closed_as,
      assignedTo: r.assigned_to,
      ticketEnquiryId: r.ticket_enquiry_id,
      ticketStatus: r.ticket_status,
      ticketNoteBy: r.ticket_note_by,
      ticketNoteOn: r.ticket_note_on,
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
          closedOn: null,
          closedAs: null,
          assignedTo: null,
          ticketEnquiryId: null,
          ticketStatus: null,
          ticketNoteBy: null,
          ticketNoteOn: null,
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
  /** §48.2: when the lead really arrived, if the file said. */
  arrivedAt: string | null;
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
  /**
   * §55.2(c). Every Shopify checkout this candidate was merged from. Written
   * to import_rows (the first, which is what the row is) and to
   * enquiry_sources (all of them, which is what makes tomorrow's file skip
   * every one). Empty on every other import.
   */
  checkoutRefs?: string[];
  /** §55.2(a): "alt number 98…", when Billing and Shipping disagreed. */
  remarks?: string[];
  /** §55.2(d): the file's Vendor, passed to the parser as a hint. */
  vendorHint?: string | null;
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
  /**
   * §55.2(c). Every (enquiry, checkout) pair this chunk established.
   *
   * Collected rather than written per branch, because the two branches write
   * their source log in different places — the create path inline, the
   * re-enquiry path inside its RPC — and a ref recorded in only one of them is
   * a checkout that re-imports tomorrow. This is the single place that decides
   * what is dedupable.
   */
  const refLog: {
    enquiry_id: number;
    source_id: string | null;
    checkout_ref: string;
    note: string;
  }[] = [];

  const base = (row: CommitRow) => ({
    batch_id: batchId,
    row_number: row.rowNumber,
    raw: row.raw,
    normalised_mobile: row.mobile,
    // §55.2(c). The first ref is this row's identity; the rest are recorded on
    // enquiry_sources below, because a merged candidate has to make every one
    // of its checkouts skippable next time.
    checkout_ref: row.checkoutRefs?.[0] ?? null,
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

  /**
   * §55.4. A raw Shopify line item must never reach the generic commit path.
   *
   * The pre-step turns checkouts into candidates before anything is written; a
   * row that still carries the export's own columns and has no checkout
   * reference did not go through it. That can only happen from a client
   * running the code from before §55.2 — a tab opened before the deploy, which
   * is what happened on 18 September — and the result is ungrouped line items
   * with the quantity column as their product text.
   *
   * Checked on the server, because the server is the only place a stale client
   * cannot skip.
   */
  const strayShopify = (row: CommitRow) =>
    !row.checkoutRefs?.length && looksLikeShopify(Object.keys(row.raw ?? {}));

  for (const row of todo) {
    if (strayShopify(row)) {
      importRows.push({
        ...base(row),
        outcome: "skipped",
        skip_reason:
          "Shopify export rows must go through the checkout grouping. Reload " +
          "the Import page and upload the file again.",
      });
      counts.skipped += 1;
    } else if (row.decision === "dismiss") {
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

  // ---- 2. re-enquiries: one RPC for the chunk ------------------------------
  // Batched for the same reason the create path is (Brief 5): a morning
  // re-upload is mostly re-enquiries, so the per-row round trip was the common
  // path, not the rare one. Falls back to one call per row if the batch fails,
  // so one bad enquiry id cannot cost the whole chunk.
  if (updating.length) {
    const payload = updating.map((row) => ({
      enquiry_id: row.existingEnquiryId!,
      source_id: row.sourceId,
      product_text: row.productText,
      // §48.2. Deliberately not arrived_at. This branch re-opens an enquiry
      // that already exists, and arrived_at means when *that* enquiry arrived
      // — a fact the file cannot revise. The return itself is already dated by
      // re_enquired_at, which is what New Calls orders a returning lead by.
      // (It would also have been ignored: import_re_enquire_many reads a fixed
      // set of keys out of the jsonb, so an extra one is a silent no-op.)
      term_id: row.termId,
      importance: row.importance,
      lead_verification: row.leadVerification,
      // Returning it to the pool is what also frees today's assignment; the
      // RPC does both together so they cannot come apart.
      clear_follow_up: row.returnToNewCalls ?? false,
    }));

    for (const row of updating) {
      for (const ref of row.checkoutRefs ?? []) {
        refLog.push({
          enquiry_id: row.existingEnquiryId!,
          source_id: row.sourceId,
          checkout_ref: ref,
          note: `Arrived in an import. Shopify checkout ${ref}.`,
        });
      }
    }

    const { data, error } = await supabase.rpc("import_re_enquire_many", {
      p_rows: payload,
      p_import_batch_id: batchId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const status = new Map<number, { ok: boolean; message: string | null }>();
    if (!error) {
      for (const r of (data ?? []) as unknown as {
        enquiry_id: number;
        ok: boolean;
        message: string | null;
      }[]) {
        status.set(r.enquiry_id, { ok: r.ok, message: r.message });
      }
    } else {
      // The batch path failed. It is recoverable — the loop below finishes the
      // work — but it must not be silent: a broken batch that the fallback
      // quietly completes looks exactly like a healthy import, only slower.
      // That is how an ambiguous column reference survived a whole test pass.
      console.error(
        `[import] batch re-enquiry failed for ${updating.length} rows, falling back to one call per row: ${error.message}`,
      );
      await supabase.rpc("import_add_warning", {
        p_batch_id: batchId,
        p_warning: `Batch path failed: ${error.message}; completed row by row (${updating.length} rows).`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // One row at a time, so a single failure is attributed to its own row
      // rather than losing every re-enquiry in the chunk.
      for (const row of updating) {
        const one = await supabase.rpc("import_re_enquire", {
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
        status.set(row.existingEnquiryId!, {
          ok: !one.error,
          message: one.error?.message ?? (one.data as string | null),
        });
      }
    }

    // Brief 31 rule 3: an arriving row fills the name in if there isn't one.
    // Never overwrites — a name on file was typed by somebody who had the
    // person on the phone. The same helper Quick Add's grid uses, so the two
    // paths cannot disagree about what "if blank" means.
    await Promise.all(
      updating.map((row) =>
        fillBlankStudentName(supabase, row.existingStudentId, row.name),
      ),
    );

    for (const row of updating) {
      const r = status.get(row.existingEnquiryId!) ?? {
        ok: false,
        message: "The re-enquiry was not confirmed",
      };
      // Say where the lead actually went. Every one of these is a
      // "re-enquired" row, and until now they all looked identical in the
      // report whether the number went back in the pool, stayed on somebody's
      // list, or stayed put because it had already been called.
      //
      // The text comes back from the RPC on success: it is decided where the
      // assignment is read, so the report cannot drift from what was written.
      importRows.push({
        ...base(row),
        outcome: r.ok ? "re_enquired" : "skipped",
        skip_reason: r.message,
        student_id: row.existingStudentId,
        enquiry_id: r.ok ? row.existingEnquiryId : null,
      });
      if (r.ok) counts.re_enquired += 1;
      else counts.skipped += 1;
    }
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
        arrived_at: row.arrivedAt,
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
      .map(({ row, studentId }) => {
        const enquiryId = enquiryByStudent.get(studentId!);
        const note =
          row.decision === "supersede"
            ? "Re-uploaded; replaced the previous enquiry."
            : "Arrived in an import.";
        if (enquiryId) {
          for (const ref of row.checkoutRefs ?? []) {
            refLog.push({
              enquiry_id: enquiryId,
              source_id: row.sourceId,
              checkout_ref: ref,
              note: `${note} Shopify checkout ${ref}.`,
            });
          }
        }
        // No checkout_ref here: the refLog above writes one row per cart, and
        // putting the first one on this row as well logs it twice.
        return {
          enquiry_id: enquiryId,
          source_id: row.sourceId,
          import_batch_id: batchId,
          note,
        };
      })
      .filter((r) => r.enquiry_id);
    if (sourceRows.length) {
      const { error } = await supabase.from("enquiry_sources").insert(sourceRows as never);
      // Not fatal: the enquiries are already in, and losing a log row must not
      // fail a 3,000-row import. It is reported on the row instead.
      if (error) {
        console.error("enquiry_sources insert failed", error.message);
      }
    }

    // §49.2. Same rule as Quick Add: the title these rows arrived with becomes
    // their interests, flagged auto, and only where the lead has no lines.
    // Chunked with the rest of the commit, so a 3,000-row import fills as it
    // goes rather than in one pass at the end.
    const createdIds = [...enquiryByStudent.values()];
    if (createdIds.length) {
      // §55.2(d). The Vendor the file gave, keyed by the enquiry it became.
      const hints: Record<number, string> = {};
      for (const { row, studentId } of withStudent) {
        const enquiryId = enquiryByStudent.get(studentId!);
        if (enquiryId && row.vendorHint) hints[enquiryId] = row.vendorHint;
      }
      const auto = await applyAutoInterests(createdIds, hints);
      // Not fatal, for the same reason the source log is not: the enquiries
      // are in, and a title the parser cannot read must not fail the import.
      if (auto.error) console.error("auto interests failed", auto.error);
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

  // ---- 4b. the checkout log (§55.2(c)) ------------------------------------
  //
  // One row per (enquiry, checkout), for every branch. A candidate merged from
  // three carts writes three, because tomorrow's file carries all three Ids
  // and every one of them has to be recognised — the first alone would let the
  // other two back in as new leads.
  if (refLog.length) {
    const { error } = await supabase.from("enquiry_sources").insert(
      refLog.map((r) => ({ ...r, import_batch_id: batchId })) as never,
    );
    // Not fatal, for the same reason the source log above is not — but it is
    // the dedupe key, so it is logged loudly rather than swallowed.
    if (error) console.error("checkout ref log failed", error.message);
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

/* -------------------------------------------------------------------------- */
/* Shopify checkouts (§55.2, §55.3)                                            */
/* -------------------------------------------------------------------------- */

/**
 * §55.2(c). Which of these checkout references Calman has already seen.
 *
 * Asked once with the whole file's keys rather than a query per row. The
 * answer covers both places a checkout can have landed: an imported row, and
 * a held one waiting for its number — a checkout sitting on the Missing
 * number tab must not be re-held tomorrow.
 */
export async function seenCheckoutRefs(
  refs: string[],
): Promise<{ error: string | null; seen?: string[] }> {
  await requireUser();
  if (!refs.length) return { error: null, seen: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seen_checkout_refs", {
    p_refs: refs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (error) return { error: error.message };
  return {
    error: null,
    seen: ((data ?? []) as { checkout_ref: string }[]).map((r) => r.checkout_ref),
  };
}

export type HeldInput = {
  checkoutRef: string;
  name: string;
  email: string;
  productText: string;
  arrivedAt: string | null;
  vendor: string | null;
  rawPhones: string[];
};

/**
 * §55.3. Park the checkouts with no usable number.
 *
 * Upserted on the reference, so re-uploading the same file does not stack
 * duplicates, and a row somebody has already dealt with is left alone — the
 * conflict target is the ref and the update deliberately touches only the
 * facts from the file, never the resolution.
 */
export async function holdCheckouts(
  batchId: string,
  rows: HeldInput[],
): Promise<{ error: string | null; held?: number }> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!rows.length) return { error: null, held: 0 };

  const supabase = await createClient();
  const { error } = await supabase.from("held_checkouts").upsert(
    rows.map((r) => ({
      checkout_ref: r.checkoutRef,
      batch_id: batchId,
      name: r.name || null,
      email: r.email || null,
      product_text: r.productText || null,
      arrived_at: r.arrivedAt,
      vendor: r.vendor,
      raw_phones: r.rawPhones,
    })),
    { onConflict: "checkout_ref", ignoreDuplicates: true },
  );
  if (error) return { error: error.message };
  revalidatePath("/import");
  return { error: null, held: rows.length };
}

export type HeldRow = {
  id: string;
  checkout_ref: string;
  name: string | null;
  email: string | null;
  product_text: string | null;
  arrived_at: string | null;
  vendor: string | null;
  raw_phones: string[];
};

export async function loadHeldCheckouts(): Promise<{
  error: string | null;
  rows: HeldRow[];
}> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("held_checkouts")
    .select("id, checkout_ref, name, email, product_text, arrived_at, vendor, raw_phones")
    .is("resolution", null)
    .order("arrived_at", { ascending: true });
  if (error) return { error: error.message, rows: [] };
  return { error: null, rows: (data ?? []) as unknown as HeldRow[] };
}

/**
 * §55.3. A held checkout, finished by hand.
 *
 * The number goes through exactly the path the import would have taken it
 * through — the same duplicate rules, the same parser, the original arrival
 * time — because a lead rescued from this tab is not a lesser lead and should
 * not end up shaped differently from its neighbours in the same batch.
 */
/**
 * §55.6. What a fill did, in the import review's own sentences.
 *
 * `label` is what the number *was* and `action` is what the fill *did* — the
 * same two halves every other screen shows, so somebody who has read a review
 * table does not have to learn a second vocabulary here.
 */
export type HeldOutcome = {
  kind: "imported" | "discarded";
  case: number | null;
  label: string;
  action: string;
  mobile: string | null;
  /** §55.6: the counsellor whose follow-up list this lead just left. */
  releasedFrom: string | null;
  tone: "ok" | "info" | "neutral" | "warn";
};

/**
 * §55.6. Case 4 says whose day changed.
 *
 * "Source updated, follow-up cleared, back into New Calls" is true and
 * incomplete: the lead was on somebody's follow-up list, and filling in this
 * number took it off. In the import review that is fine — a reviewer is
 * looking at fifty rows and the counsellor is named in the line above. Here
 * there is one row and the person reading it is usually not the person losing
 * the lead, so the sentence has to carry the name itself.
 */
function heldOutcomeFor(
  status: NumberStatus | null,
  mobile: string,
): HeldOutcome {
  if (!status) {
    return {
      kind: "imported",
      case: 1,
      label: "New number",
      action: "New enquiry into New Calls",
      mobile,
      releasedFrom: null,
      tone: "ok",
    };
  }

  const verdict = describeNumber(status, "purchase");
  const releasedFrom =
    verdict.case === 4 ? (status.lastCallBy ?? status.assignedTo ?? null) : null;

  return {
    kind: "imported",
    case: verdict.case,
    label: verdict.label,
    action: releasedFrom
      ? `Released from ${releasedFrom}'s follow-ups to New Calls`
      : verdict.action,
    mobile,
    releasedFrom,
    tone: verdict.tone,
  };
}

export type ResolvedHeldRow = {
  id: string;
  checkout_ref: string;
  name: string | null;
  resolution: "imported" | "discarded";
  resolved_mobile: string | null;
  resolution_case: number | null;
  resolution_label: string | null;
  resolution_action: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
};

/**
 * §55.6. The last twenty fills, newest first.
 *
 * Twenty because the list answers "what did I just do, and what did the person
 * before me do" — a day's worth of a tab nobody sits on. Older than that is
 * the enquiry's own history, which is where it belongs.
 */
export async function loadResolvedHeldCheckouts(): Promise<{
  error: string | null;
  rows: ResolvedHeldRow[];
}> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("held_checkouts")
    .select(
      `id, checkout_ref, name, resolution, resolved_mobile, resolution_case,
       resolution_label, resolution_action, resolved_at,
       resolver:profiles!held_checkouts_resolved_by_fkey ( full_name )`,
    )
    .not("resolution", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(20);
  if (error) return { error: error.message, rows: [] };

  return {
    error: null,
    rows: ((data ?? []) as unknown as (Omit<ResolvedHeldRow, "resolved_by_name"> & {
      resolver: { full_name: string | null } | null;
    })[]).map(({ resolver, ...r }) => ({
      ...r,
      resolved_by_name: resolver?.full_name ?? null,
    })),
  };
}

export async function resolveHeldCheckout(input: {
  id: string;
  mobile?: string;
  discard?: boolean;
  reason?: string;
  /**
   * §55.5. The number is already somebody else's, and the person filling this
   * in has been told whose and said to go ahead anyway.
   */
  attachToExisting?: boolean;
}): Promise<{
  error: string | null;
  outcome?: HeldOutcome;
  /**
   * §55.5. Set instead of an outcome when the number belongs to a student
   * under a different name. Nothing is written; the caller asks and comes
   * back with attachToExisting.
   */
  confirmExisting?: { existingName: string; checkoutName: string };
}> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const supabase = await createClient();
  const { data: held, error: readError } = await supabase
    .from("held_checkouts")
    .select("*")
    .eq("id", input.id)
    .is("resolution", null)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!held) return { error: "That row has already been dealt with." };

  if (input.discard) {
    // §55.6. A discard gets the same two-part sentence as a fill, because it
    // is the same question answered the other way and the Resolved list below
    // shows them side by side.
    const discarded: HeldOutcome = {
      kind: "discarded",
      case: null,
      label: `Discarded · ${held.name || held.checkout_ref}`,
      action: input.reason?.trim() || "Discarded — no number could be found",
      mobile: null,
      releasedFrom: null,
      tone: "neutral",
    };
    const { error } = await supabase
      .from("held_checkouts")
      .update({
        resolution: "discarded",
        resolution_note: discarded.action,
        resolution_label: discarded.label,
        resolution_action: discarded.action,
        resolved_by: viewer.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/import");
    return { error: null, outcome: discarded };
  }

  const mobile = normaliseMobile(input.mobile ?? "");
  if (!isValidMobile(mobile)) {
    return { error: "That is not a valid ten-digit Indian mobile number." };
  }

  // The five-case rules, asked the same way the review table asks them.
  const lookup = await lookupNumbers([mobile]);
  if (lookup.error) return { error: lookup.error };
  const status = lookup.statuses?.[0] ?? null;

  /**
   * §55.5. A number that already belongs to somebody else.
   *
   * On the first day's use, three different checkouts were filled in with one
   * number and all three attached to the same lead — three people's carts on
   * one student, and nothing said so. It is a typo more often than not, but it
   * is sometimes right: a parent's phone, a shared number, a student who
   * checked out twice under two spellings. So it asks rather than refuses, and
   * the existing name is kept either way — the person in Calman is who
   * somebody rang, and a checkout is not evidence they are called something
   * else.
   */
  const checkoutName = (held.name ?? "").trim();
  const existingName = (status?.studentName ?? "").trim();
  if (
    !input.attachToExisting &&
    existingName &&
    checkoutName &&
    existingName.toLowerCase() !== checkoutName.toLowerCase()
  ) {
    return { error: null, confirmExisting: { existingName, checkoutName } };
  }

  // A number somebody has already called today is the one case no rule can
  // decide (Brief 31), and a tab with one input is the wrong place to ask. It
  // goes in as a fresh arrival on the existing lead, which is what "re-enquire"
  // does everywhere else.
  const decision: RowDecision =
    status?.state === "open_uncalled" ||
    status?.state === "open_called_earlier" ||
    // Brief 31 case 5 — somebody rang this number today — is the one case no
    // rule decides, and a tab with a single input is the wrong place to put
    // that question. A fresh arrival on the lead they already have is the
    // conservative answer: nothing is lost and nobody is sent to re-ring.
    status?.state === "open_called_today"
      ? "re_enquire"
      : status?.state === "resolved" || status?.state === "wrong_number"
        ? "supersede"
        : "import";

  // §55.6. Read before the commit, because committing is what makes it stop
  // being true: a case-4 lead is in somebody's follow-up list until this
  // writes, and afterwards it is in New Calls with nothing left to name.
  const outcome = heldOutcomeFor(status, mobile);
  // Only worth saying when the two names differ — which is the same condition
  // that put the question up in the first place. "Attached to X" where X is
  // the name on the checkout is a sentence about nothing.
  const attachNote =
    existingName && existingName.toLowerCase() !== checkoutName.toLowerCase()
      ? `Attached to ${existingName}, who already had this number`
      : null;

  const acSource = await supabase
    .from("sources")
    .select("id")
    .ilike("name", "AC")
    .maybeSingle();

  const batch = await supabase
    .from("import_batches")
    .insert({
      filename: `Missing number — checkout ${held.checkout_ref}`,
      total_rows: 1,
      uploaded_by: viewer.userId,
    })
    .select("id")
    .single();
  if (batch.error) return { error: batch.error.message };

  const commit = await commitChunk(batch.data.id, [
    {
      rowNumber: 1,
      raw: {
        "Checkout Id": held.checkout_ref,
        "Billing Name": held.name ?? "",
        Email: held.email ?? "",
        "Lineitem name": held.product_text ?? "",
        Mobile: mobile,
      },
      mobile,
      decision,
      skipReason: null,
      // §55.5. Only when the number is new to Calman. An existing student keeps
      // the name they are known by — the import rules would not overwrite it
      // anyway, and sending it is how a future change to that rule would
      // quietly start renaming people from a checkout.
      name: existingName ? null : held.name,
      sourceId: acSource.data?.id ?? null,
      productText: held.product_text,
      arrivedAt: held.arrived_at,
      termId: null,
      importance: null,
      leadVerification: null,
      existingStudentId: status?.studentId ?? null,
      existingEnquiryId: status?.openEnquiryId ?? null,
      returnToNewCalls: status?.state === "open_called_earlier",
      checkoutRefs: [held.checkout_ref],
      vendorHint: held.vendor,
    },
  ]);
  if (commit.error) return { error: commit.error };

  const { data: row } = await supabase
    .from("import_rows")
    .select("enquiry_id")
    .eq("batch_id", batch.data.id)
    .maybeSingle();

  const { error } = await supabase
    .from("held_checkouts")
    .update({
      resolution: "imported",
      resolution_note: existingName
        ? `Attached to ${existingName}, who already had this number.`
        : null,
      resolved_mobile: mobile,
      resolution_case: outcome.case,
      resolution_label: outcome.label,
      resolution_action: attachNote
        ? `${outcome.action}. ${attachNote}`
        : outcome.action,
      resolved_enquiry_id: row?.enquiry_id ?? null,
      resolved_by: viewer.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { error: error.message };

  revalidatePath("/import");
  revalidatePath("/new-calls");
  revalidatePath("/my-day");
  return {
    error: null,
    outcome: attachNote
      ? { ...outcome, action: `${outcome.action}. ${attachNote}` }
      : outcome,
  };
}
