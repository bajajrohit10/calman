"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type {
  EnquiryStatus,
  EnquiryType,
  Importance,
  LeadVerification,
} from "@/lib/enquiry-labels";
import { lookupNumbers } from "@/app/(app)/import/actions";
import {
  describeNumber,
  ticketOnly,
  type Case5Decision,
  type DuplicateCase,
} from "@/lib/duplicate-rules";
import { applyAutoInterests } from "@/lib/auto-interests";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { loadStudentByMobile, type StudentHistory } from "@/lib/students";
import { createClient } from "@/lib/supabase/server";

export type LookupResult = {
  error: string | null;
  mobile: string;
  student: StudentHistory | null;
};

/**
 * §5.1 live lookup. Called on every keystroke once ten digits are present, so
 * it does exactly one query and returns the same shape the history panel and
 * the /students page already render.
 */
export async function lookupMobile(raw: string): Promise<LookupResult> {
  const mobile = normaliseMobile(raw);
  if (!isValidMobile(mobile)) {
    return { error: "That is not a valid Indian mobile number.", mobile, student: null };
  }

  // Both at once (§28.2). The lookup used to await the session and only then
  // ask for the history — two serial crossings on the one interaction where a
  // counsellor is waiting with the phone already ringing. They do not depend
  // on each other: RLS is what decides whether the history comes back at all,
  // and requireUser is the redirect for somebody who is not signed in. So they
  // race, and the authorisation is still checked before anything is returned.
  try {
    const [, student] = await Promise.all([
      requireUser(),
      loadStudentByMobile(mobile),
    ]);
    return { error: null, mobile, student };
  } catch (e) {
    return { error: (e as Error).message, mobile, student: null };
  }
}

export type NewEnquiryInput = {
  mobile: string;
  name: string | null;
  type: EnquiryType;
  sourceId: string | null;
  productText: string | null;
  /** §7.1. What was said before there was a number to attach it to. */
  discussion: string | null;
  termId: string | null;
  importance: Importance | "" | null;
  leadVerification: LeadVerification | "" | null;
  /** Set when replacing an open enquiry: it is closed as superseded first. */
  supersedeEnquiryId: number | null;
};

export type NewEnquiryResult = {
  error: string | null;
  enquiry?: {
    id: number;
    type: EnquiryType;
    studentName: string | null;
    mobile: string;
    term: string | null;
    productText: string | null;
    slotsUsed: number;
    termId: string | null;
    sourceId: string | null;
    importance: Importance | null;
    leadVerification: LeadVerification | null;
    defaultFollowUpDate: string | null;
    status: EnquiryStatus;
    sourceNames: string[];
    nextFollowUpDate: string | null;
    reEnquiredAt: string | null;
    createdAt: string;
    timeline: never[];
    items: never[];
  };
};

/**
 * Create the enquiry Quick Add is about to log a call against, creating the
 * student too if this number has never been seen (§5.1).
 *
 * The mobile number is the only required field in the entire system (§3), so
 * everything else here is allowed to be null and filled in later.
 */
export async function createEnquiry(
  input: NewEnquiryInput,
): Promise<NewEnquiryResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const mobile = normaliseMobile(input.mobile);
  if (!isValidMobile(mobile)) return { error: "That is not a valid Indian mobile number." };

  const supabase = await createClient();

  // --- the student ---------------------------------------------------------
  const { data: existing, error: findError } = await supabase
    .from("students")
    .select("id, name")
    .eq("mobile", mobile)
    .maybeSingle();

  if (findError) return { error: findError.message };

  let studentId = existing?.id ?? null;
  let studentName = existing?.name ?? null;

  if (!studentId) {
    const { data, error } = await supabase
      .from("students")
      .insert({
        mobile,
        name: input.name?.trim() || null,
        created_by: viewer.userId,
      })
      .select("id, name")
      .single();

    if (error) return { error: `Could not create the student: ${error.message}` };
    studentId = data.id;
    studentName = data.name;
  }

  // --- supersede the previous enquiry, if asked ----------------------------
  // §4.9: a human decision the recompute trigger deliberately will not undo.
  // RLS on enquiries only lets an admin (or same-day creator) update a row,
  // so this goes through the definer function added for exactly this case.
  if (input.supersedeEnquiryId != null) {
    const { error } = await supabase.rpc("supersede_enquiry", {
      p_enquiry_id: input.supersedeEnquiryId,
    });
    if (error) return { error: `Could not close the previous enquiry: ${error.message}` };
  }

  // --- the enquiry ---------------------------------------------------------
  const { data: enquiry, error: enquiryError } = await supabase
    .from("enquiries")
    .insert({
      student_id: studentId,
      type: input.type,
      source_id: input.sourceId || null,
      product_text: input.productText?.trim() || null,
      pre_call_note: input.discussion?.trim() || null,
      term_id: input.termId || null,
      importance: input.importance || null,
      lead_verification: input.leadVerification || null,
      created_by: viewer.userId,
    })
    .select("id, type, term:terms ( name )")
    .single();

  if (enquiryError) return { error: `Could not create the enquiry: ${enquiryError.message}` };

  // §10.1: the source log records every arrival, and a number typed into Quick
  // Add is an arrival. Nothing about the Quick Add flow changes — the
  // counsellor still chooses what happens — this only stops the log having a
  // hole where the hand-entered leads should be.
  const { error: sourceLogError } = await supabase.from("enquiry_sources").insert({
    enquiry_id: enquiry.id,
    source_id: input.sourceId || null,
    note: "Added in Quick Add.",
  });
  // Not fatal: the enquiry exists, and the counsellor has a call to log.
  if (sourceLogError) console.error("enquiry_sources insert failed", sourceLogError.message);

  const { data: nextDay } = await supabase.rpc("next_working_day", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  revalidatePath(`/students/${mobile}`);
  revalidatePath("/quick-add");

  return {
    error: null,
    enquiry: {
      id: enquiry.id,
      type: enquiry.type as EnquiryType,
      studentName,
      mobile,
      term: (enquiry.term as { name: string } | null)?.name ?? null,
      productText: input.productText?.trim() || null,
      // A brand-new enquiry has had no calls, so it is at the fresh stage.
      slotsUsed: 0,
      termId: input.termId || null,
      sourceId: input.sourceId || null,
      importance: (input.importance || null) as Importance | null,
      leadVerification: (input.leadVerification || null) as LeadVerification | null,
      defaultFollowUpDate: (nextDay as string | null) ?? null,
      // A brand-new enquiry: open, no calls, and the only source is the one
      // just chosen. The panel's timeline still shows the student's other
      // enquiries when there are any — Quick Add fills that in below.
      status: "open" as EnquiryStatus,
      sourceNames: [],
      nextFollowUpDate: null,
      reEnquiredAt: null,
      createdAt: new Date().toISOString(),
      timeline: [],
      items: [],
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The grid (§30.1, Brief 31)                                                 */
/* -------------------------------------------------------------------------- */

export type BulkRowInput = {
  mobile: string;
  name: string | null;
  sourceId: string | null;
  /** §48.3: what the student asked about, optional on both grids. */
  productText?: string | null;
  /** §7.1. The pre-call note, typed before the number in tab order. */
  discussion?: string | null;
  /**
   * §48.3. When the arrival really happened — the AC grid's own column. Null
   * on a Normal row, where the row is being typed as the call comes in and
   * created_at is already the truth.
   */
  arrivedAt?: string | null;
  /**
   * Case 5 only (Brief 31, extended by §42): a number somebody has already
   * called today. Three answers — log another call on the same enquiry and
   * change nothing else, put it back in New Calls, or throw the arrival away.
   * Every other case is decided by the rules, so there is nothing to send.
   */
  decision: Case5Decision | null;
  /** §38.3: which pipeline this arrival was sent to, when asked. */
  pipeline?: "ticket" | "purchase" | null;
};

export type BulkRowResult = {
  mobile: string;
  /** Which of the five, as the server saw it at save time. */
  case: DuplicateCase | null;
  action: "created" | "updated" | "returned" | "dismissed" | "untouched" | "failed";
  enquiryId: number | null;
  /** What happened, in the words the rule uses. */
  detail?: string;
  reason?: string;
  /** Anything typed that this save could not apply (§30.3). */
  ignored?: string[];
};

export type BulkResult = {
  error: string | null;
  rows?: BulkRowResult[];
  created?: number;
  updated?: number;
  returned?: number;
  dismissed?: number;
  /** §42: rows that were opened for another call and otherwise left alone. */
  untouched?: number;
  failed?: { mobile: string; reason: string }[];
};

/**
 * Save a screenful of numbers under §10.1's rules (Brief 31), in as few round
 * trips as the rules allow (§32.4).
 *
 * The rules are applied here, from a lookup taken now, rather than from
 * whatever the grid saw when the number was typed. Two reasons: a colleague
 * may have called the number in the minutes since, and a classification that
 * arrives from a browser is a classification anybody can send. The grid's job
 * is to show what will happen and to collect the one decision the rules cannot
 * make; the deciding is here.
 *
 * It used to write a row at a time through createEnquiry, which costs five
 * round trips and two cache revalidations *per row* — measured on production
 * at ~139 ms a row, so ten numbers took 1.7 s and the cost grew with the list.
 * Rows are now sorted into the three things that can happen to them and each
 * group is written in one statement, the way the importer has always done it.
 * What is left is a fixed cost: auth, one lookup, four writes, one revalidate.
 *
 * A number appearing twice in one grid is refused rather than silently given
 * two enquiries. That was the old behaviour, and it is the exact duplicate
 * §10.1 exists to prevent — arriving, of all places, from the screen whose job
 * is to prevent it.
 */
export async function createManyEnquiries(
  rows: BulkRowInput[],
): Promise<BulkResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!rows.length) return { error: "Nothing to save." };
  if (rows.length > 100) return { error: "That is more than 100 rows. Save in batches." };

  const supabase = await createClient();

  /** One slot per input row, filled in as each group is written. */
  const out: (BulkRowResult | null)[] = rows.map(() => null);
  const fail = (i: number, mobile: string, reason: string, which: DuplicateCase | null = null) => {
    out[i] = { mobile, case: which, action: "failed", enquiryId: null, reason };
  };

  // ---- 1. what each row is ------------------------------------------------
  type Job = { index: number; mobile: string; row: BulkRowInput };
  const jobs: Job[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const mobile = normaliseMobile(row.mobile);
    if (!isValidMobile(mobile)) {
      fail(index, row.mobile, "not a valid Indian mobile number");
      return;
    }
    // §32.4 refuses the same number twice. Brief 33 had briefly keyed this on
    // number *and* type, so one number could be typed as a lead and as a
    // ticket; with the Type column gone there is one row per number again.
    const first = seen.get(mobile);
    if (first !== undefined) {
      fail(index, mobile, `the same number is on row ${first + 1} of this grid`);
      return;
    }
    seen.set(mobile, index);
    jobs.push({ index, mobile, row });
  });

  // One lookup for the whole grid, taken now. Batched, so it costs the same
  // for ten numbers as for one — which is why reusing the grid's own lookup
  // would buy nothing measurable.
  // Every row: the rules need to know both what is open on the purchase side
  // and whether a ticket is already running (§33.5, §35.1).
  const toLookUp = jobs.map((j) => j.mobile);
  const { statuses, error: lookupError } = await lookupNumbers([...new Set(toLookUp)]);
  if (lookupError) return { error: lookupError };
  const known = new Map((statuses ?? []).map((s) => [s.mobile, s]));

  const creating: Job[] = [];
  const reEnquiring: (Job & { enquiryId: number; returns: boolean; which: DuplicateCase })[] = [];
  /** §33.5: rows that join an open ticket rather than making anything. */
  const attaching: (Job & { ticketId: number })[] = [];
  /** §38.3: rows asked for a ticket on a number that has none. */
  const openingTicket: Job[] = [];

  for (const job of jobs) {
    const status = known.get(job.mobile);

    // §35.1 and §38.3. A row is a purchase lead unless the number's only live
    // conversation is a ticket, in which case the arrival joins that ticket.
    // Either way the counsellor can say otherwise: "New purchase enquiry" on a
    // ticket, "Log ticket instead" on a lead. A number can hold one of each.
    const wants = job.row.pipeline ?? null;
    const rule = status && ticketOnly(status) ? "ticket" : "purchase";
    const side = wants ?? rule;

    if (status?.ticketEnquiryId && side === "ticket") {
      attaching.push({ ...job, ticketId: status.ticketEnquiryId });
      continue;
    }
    if (side === "ticket" && !status?.ticketEnquiryId) {
      // Asked for a ticket on a number that has none: make one beside the
      // lead rather than touching the lead.
      openingTicket.push(job);
      continue;
    }
    if (wants === "purchase" && status && ticketOnly(status)) {
      // Asked for a lead on a number whose only record is a ticket: a plain
      // new purchase enquiry, and the ticket is not touched.
      creating.push(job);
      continue;
    }

    const which = status ? describeNumber(status, "purchase").case : 1;

    if (which === 5) {
      if (job.row.decision === "dismiss") {
        out[job.index] = {
          mobile: job.mobile,
          case: 5,
          action: "dismissed",
          enquiryId: status?.openEnquiryId ?? null,
          detail: "Left alone; the call made today stands.",
        };
        continue;
      }
      /**
       * §42. The common answer: the student rang again, and the counsellor is
       * about to take the call. Nothing is written here at all — no source
       * touch, no re-enquire, no cleared follow-up — because the whole point
       * of this option is that the earlier call stands and the lead keeps its
       * place. What happens next is decided by the outcome of the call the
       * window is about to open, exactly as on any other day.
       */
      if (job.row.decision === "log_call") {
        out[job.index] = {
          mobile: job.mobile,
          case: 5,
          action: "untouched",
          enquiryId: status?.openEnquiryId ?? null,
          detail: "Left exactly as it was; ready for another call.",
        };
        continue;
      }
      if (job.row.decision !== "add_anyway") {
        fail(
          job.index,
          job.mobile,
          "somebody called this number today — choose Log another call, Add to New Calls anyway, or Dismiss",
          5,
        );
        continue;
      }
    }

    // Cases 1 and 2: nothing is open, so this is a fresh lead in the pool.
    if (which === 1 || which === 2) {
      creating.push(job);
      continue;
    }

    const enquiryId = status?.openEnquiryId ?? null;
    if (!enquiryId) {
      fail(job.index, job.mobile, "the open enquiry disappeared between the lookup and the save", which);
      continue;
    }
    // Case 3 stays exactly where it is; case 4 and a waved-through case 5
    // clear the follow-up and come back to the pool.
    reEnquiring.push({ ...job, enquiryId, returns: which !== 3, which });
  }

  // ---- 2. the ones that already exist, in one call ------------------------
  if (reEnquiring.length) {
    await reEnquireMany(supabase, reEnquiring, known, out);
  }

  // ---- 3. the ones joining a ticket ---------------------------------------
  for (const job of attaching) {
    const { data, error } = await supabase.rpc("attach_to_ticket", {
      p_enquiry_id: job.ticketId,
      p_source_id: job.row.sourceId ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    out[job.index] = error
      ? {
          mobile: job.mobile,
          case: 6,
          action: "failed",
          enquiryId: null,
          reason: error.message,
        }
      : {
          mobile: job.mobile,
          case: 6,
          action: "updated",
          enquiryId: job.ticketId,
          detail: (data as string | null) ?? undefined,
        };
  }

  // ---- 3b. rows that want a ticket where none exists -----------------------
  for (const job of openingTicket) {
    const res = await createEnquiry({
      mobile: job.mobile,
      name: job.row.name,
      type: "after_sale",
      sourceId: job.row.sourceId,
      productText: null,
      discussion: null,
      termId: null,
      importance: null,
      leadVerification: null,
      supersedeEnquiryId: null,
    });
    out[job.index] = res.error || !res.enquiry
      ? {
          mobile: job.mobile,
          case: null,
          action: "failed",
          enquiryId: null,
          reason: res.error ?? "could not be saved",
        }
      : {
          mobile: job.mobile,
          case: null,
          action: "created",
          enquiryId: res.enquiry.id,
          detail: "Opened as a ticket beside the existing enquiry.",
        };
  }

  // ---- 4. the new ones, in four --------------------------------------------
  if (creating.length) {
    await createMany(supabase, creating, viewer.userId ?? null, out);
  }

  // New purchase leads land unassigned, which is what puts them in New Calls:
  // the pool is "open, never had a fresh call, on nobody's day". Once for the
  // whole save rather than twice per row, which is what it used to be.
  revalidatePath("/new-calls");
  revalidatePath("/quick-add");
  revalidatePath("/tickets");

  const done = out.map(
    (r, i) =>
      r ?? {
        mobile: normaliseMobile(rows[i].mobile),
        case: null,
        action: "failed" as const,
        enquiryId: null,
        reason: "this row was not written",
      },
  );

  return {
    error: null,
    rows: done,
    created: done.filter((r) => r.action === "created").length,
    updated: done.filter((r) => r.action === "updated").length,
    returned: done.filter((r) => r.action === "returned").length,
    dismissed: done.filter((r) => r.action === "dismissed").length,
    untouched: done.filter((r) => r.action === "untouched").length,
    failed: done
      .filter((r) => r.action === "failed")
      .map((r) => ({ mobile: r.mobile, reason: r.reason ?? "could not be saved" })),
  };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Cases 3, 4 and a waved-through 5: one RPC for the lot.
 *
 * import_re_enquire_many is the function the importer uses for a morning
 * re-upload, and it already takes clear_follow_up per row — which is the only
 * thing that differs between "stays where it is" and "back into the pool". So
 * this is the same rule reaching the database by the same route, not a second
 * implementation that happens to agree today.
 */
async function reEnquireMany(
  supabase: Client,
  jobs: { index: number; mobile: string; row: BulkRowInput; enquiryId: number; returns: boolean; which: DuplicateCase }[],
  known: Map<string, { studentId: string | null }>,
  out: (BulkRowResult | null)[],
) {
  const { data, error } = await supabase.rpc("import_re_enquire_many", {
    p_rows: jobs.map((j) => ({
      enquiry_id: j.enquiryId,
      source_id: j.row.sourceId,
      clear_follow_up: j.returns,
    })),
    p_import_batch_id: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const landed = new Map<number, { ok: boolean; message: string | null }>();
  if (error) {
    for (const j of jobs) landed.set(j.enquiryId, { ok: false, message: error.message });
  } else {
    for (const r of (data ?? []) as unknown as {
      enquiry_id: number;
      ok: boolean;
      message: string | null;
    }[]) {
      landed.set(r.enquiry_id, { ok: r.ok, message: r.message });
    }
  }

  // Brief 31 rule 3: an arriving row fills the name in if there isn't one.
  // One read for every student at once; the writes that follow are only for
  // the ones actually missing a name, which is usually none.
  const named = jobs.filter((j) => j.row.name?.trim());
  const ignoredFor = new Map<number, string[]>();
  if (named.length) {
    const ids = named
      .map((j) => known.get(j.mobile)?.studentId)
      .filter((id): id is string => Boolean(id));
    const { data: students } = await supabase
      .from("students")
      .select("id, name")
      .in("id", ids);
    const current = new Map((students ?? []).map((s) => [s.id, s.name?.trim() || null]));

    await Promise.all(
      named.map(async (j) => {
        const id = known.get(j.mobile)?.studentId;
        if (!id) return;
        const have = current.get(id) ?? null;
        const wanted = j.row.name!.trim();
        if (have && have !== wanted) {
          ignoredFor.set(j.index, [`Name stays "${have}" — this number already has one`]);
          return;
        }
        if (have) return;
        const { error: writeError } = await supabase
          .from("students")
          .update({ name: wanted })
          .eq("id", id);
        if (writeError) {
          ignoredFor.set(j.index, [`Name could not be set: ${writeError.message}`]);
        }
      }),
    );
  }

  for (const j of jobs) {
    const r = landed.get(j.enquiryId) ?? { ok: false, message: "the re-enquiry was not confirmed" };
    if (!r.ok) {
      out[j.index] = {
        mobile: j.mobile,
        case: j.which,
        action: "failed",
        enquiryId: null,
        reason: r.message ?? "could not be saved",
      };
      continue;
    }
    out[j.index] = {
      mobile: j.mobile,
      case: j.which,
      action: j.returns ? "returned" : "updated",
      enquiryId: j.enquiryId,
      detail: r.message ?? undefined,
      ignored: ignoredFor.get(j.index),
    };
  }
}

/**
 * Cases 1 and 2, and every after-sale row: students, enquiries and the arrival
 * log, one statement each.
 *
 * Matched back to rows by student_id rather than by the order the database
 * returned them, which is the same reason the importer does it that way: every
 * row here carries a distinct number, so student_id identifies its row, and
 * relying on insert order would be relying on something nobody promised.
 */
async function createMany(
  supabase: Client,
  jobs: { index: number; mobile: string; row: BulkRowInput }[],
  userId: string | null,
  out: (BulkRowResult | null)[],
) {
  const { data: existing } = await supabase
    .from("students")
    .select("id, mobile")
    .in("mobile", jobs.map((j) => j.mobile));
  const studentByMobile = new Map(
    ((existing ?? []) as { id: string; mobile: string }[]).map((s) => [s.mobile, s.id]),
  );

  const missing = jobs.filter((j) => !studentByMobile.has(j.mobile));
  if (missing.length) {
    const { data, error } = await supabase
      .from("students")
      .insert(
        missing.map((j) => ({
          mobile: j.mobile,
          name: j.row.name?.trim() || null,
          created_by: userId,
        })) as never,
      )
      .select("id, mobile");
    if (error) {
      for (const j of missing) {
        out[j.index] = {
          mobile: j.mobile,
          case: null,
          action: "failed",
          enquiryId: null,
          reason: `could not create the student: ${error.message}`,
        };
      }
    } else {
      for (const s of (data ?? []) as { id: string; mobile: string }[]) {
        studentByMobile.set(s.mobile, s.id);
      }
    }
  }

  const ready = jobs.filter((j) => studentByMobile.has(j.mobile) && !out[j.index]);
  if (!ready.length) return;

  const { data: made, error: enquiryError } = await supabase
    .from("enquiries")
    .insert(
      ready.map((j) => ({
        student_id: studentByMobile.get(j.mobile)!,
        // §35.1: always a purchase lead. The call window is where it becomes
        // an after-sale enquiry, if that is what the conversation turns out
        // to be about.
        type: "purchase",
        source_id: j.row.sourceId,
        product_text: j.row.productText?.trim() || null,
        pre_call_note: j.row.discussion?.trim() || null,
        // §48.3. Only ever what the grid was told. A Normal row sends null and
        // the enquiry falls back to created_at, which for a number typed as
        // the phone rings is the same instant anyway.
        arrived_at: j.row.arrivedAt ?? null,
        created_by: userId,
      })) as never,
    )
    .select("id, student_id");

  if (enquiryError) {
    for (const j of ready) {
      out[j.index] = {
        mobile: j.mobile,
        case: null,
        action: "failed",
        enquiryId: null,
        reason: `could not create the enquiry: ${enquiryError.message}`,
      };
    }
    return;
  }

  const enquiryByStudent = new Map(
    ((made ?? []) as { id: number; student_id: string }[]).map((e) => [e.student_id, e.id]),
  );

  // §10.1: a new enquiry is an arrival too. Without this the source log would
  // hold only re-uploads, and an enquiry's first arrival — the one that
  // explains where it came from — would be the one entry missing.
  const sources = ready
    .map((j) => ({
      enquiry_id: enquiryByStudent.get(studentByMobile.get(j.mobile)!),
      source_id: j.row.sourceId,
      note: "Added in Quick Add.",
    }))
    .filter((r) => r.enquiry_id);
  if (sources.length) {
    const { error } = await supabase.from("enquiry_sources").insert(sources as never);
    // Not fatal: the enquiries are already in, and losing a log row must not
    // fail the save the counsellor is waiting on.
    if (error) console.error("enquiry_sources insert failed", error.message);
  }

  // §49.2. The product text these rows carry is the only description of them
  // that exists, so it becomes their interests — flagged auto, and only where
  // the lead has no lines, which a brand-new enquiry never does.
  //
  // Not fatal and not awaited for its result beyond logging: the enquiries are
  // saved, and a parser that cannot read one title must not fail the save a
  // counsellor is waiting on.
  const createdIds = [...enquiryByStudent.values()];
  if (createdIds.length) {
    const auto = await applyAutoInterests(createdIds);
    if (auto.error) console.error("auto interests failed", auto.error);
  }

  for (const j of ready) {
    const enquiryId = enquiryByStudent.get(studentByMobile.get(j.mobile)!);
    out[j.index] = enquiryId
      ? { mobile: j.mobile, case: null, action: "created", enquiryId }
      : {
          mobile: j.mobile,
          case: null,
          action: "failed",
          enquiryId: null,
          reason: "could not create the enquiry for this row",
        };
  }
}

/**
 * Remember which grid this counsellor was last on (§48.3).
 *
 * Fire-and-forget from the client: the tab has already switched by the time
 * this is called, and a preference that fails to save is not worth an error
 * message in front of somebody mid-list. The next page load simply opens where
 * it last managed to record.
 */
export async function setMyQuickAddTab(tab: "normal" | "ac"): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("set_my_quick_add_tab", {
    p_tab: tab,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}
