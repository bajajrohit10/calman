import "server-only";

import { fetchAllRows } from "@/lib/paged";
import { createClient } from "@/lib/supabase/server";
import {
  TARGET_KEYS,
  TARGET_TABLES,
  type Offer,
  type OfferPerformance,
  type OfferTargetKey,
} from "@/lib/offer-shape";

export * from "@/lib/offer-shape";

/**
 * Every offer with its targets, and the performance numbers beside them.
 *
 * Six reads rather than one nested select: PostgREST can embed the join tables
 * in a single query, but each embed comes back capped at its own max_rows with
 * no indication, and an offer whose teacher list is quietly truncated is an
 * offer that stops matching leads it was aimed at. Read whole, assembled here.
 */
export async function loadOffers(): Promise<{
  offers: Offer[];
  performance: Record<string, OfferPerformance>;
  error: string | null;
}> {
  const supabase = await createClient();

  const [base, perf, ...targetRows] = await Promise.all([
    fetchAllRows<{
      id: string;
      name: string;
      start_date: string;
      end_date: string;
      reminder_days: number;
      is_active: boolean;
    }>((from, to) =>
      supabase
        .from("offers")
        .select("id, name, start_date, end_date, reminder_days, is_active")
        .order("end_date", { ascending: false })
        .order("name")
        .range(from, to) as never,
    ),
    supabase.rpc("offer_performance", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    ...TARGET_KEYS.map((key) =>
      fetchAllRows<Record<string, string>>((from, to) =>
        supabase
          .from(TARGET_TABLES[key].table)
          .select(`offer_id, ${TARGET_TABLES[key].column}`)
          .range(from, to) as never,
      ),
    ),
  ]);

  if (base.error) return { offers: [], performance: {}, error: base.error };

  // A fresh set of arrays per offer: one shared blank would hand every offer
  // the same five arrays, and one push would appear on all of them.
  const blank = (): Record<OfferTargetKey, string[]> =>
    Object.fromEntries(TARGET_KEYS.map((k) => [k, [] as string[]])) as Record<
      OfferTargetKey,
      string[]
    >;
  const targets = new Map<string, Record<OfferTargetKey, string[]>>();
  const forOffer = (id: string) => {
    const existing = targets.get(id);
    if (existing) return existing;
    const fresh = blank();
    targets.set(id, fresh);
    return fresh;
  };
  TARGET_KEYS.forEach((key, i) => {
    for (const row of targetRows[i].rows) {
      const value = row[TARGET_TABLES[key].column];
      if (value) forOffer(row.offer_id)[key].push(value);
    }
  });

  const performance: Record<string, OfferPerformance> = {};
  for (const row of (perf.data ?? []) as unknown as OfferPerformance[]) {
    performance[row.offer_id] = row;
  }

  return {
    offers: base.rows.map((o) => ({
      ...o,
      targets: targets.get(o.id) ?? blank(),
    })),
    performance,
    error: perf.error?.message ?? null,
  };
}

/**
 * How many open leads a set of targets reaches right now.
 *
 * Asked of the database rather than computed from the masters, because the
 * question is about leads and only the database knows what is on them. Takes
 * the targets being typed, so the form can answer before anything is saved.
 */
export async function countOfferMatches(
  targets: Record<OfferTargetKey, string[]>,
): Promise<{ count: number; error: string | null }> {
  const supabase = await createClient();
  const list = (v: string[]) => (v.length ? v : undefined);
  const { data, error } = await supabase.rpc("offer_match_count", {
    p_teachers: list(targets.teachers),
    p_institutes: list(targets.institutes),
    p_courses: list(targets.courses),
    p_subjects: list(targets.subjects),
    p_contents: list(targets.contents),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { count: 0, error: error.message };
  return { count: Number(data ?? 0), error: null };
}

/** The active offers, for the desk's filter. Name only; ordered by urgency. */
export async function loadOfferOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("offers")
    .select("id, name")
    .eq("is_active", true)
    .order("end_date", { ascending: false })
    .limit(200);
  return data ?? [];
}

/**
 * Every target's name by id, for the export's one readable targets column.
 *
 * Reads the master lists directly rather than through loadMasters(), because
 * that one filters to active rows and an offer aimed at a teacher who has
 * since been deactivated still has to say who it was aimed at.
 */
export async function loadOfferTargetNames(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const [institutes, teachers, courses, subjects, contents] = await Promise.all([
    supabase.from("institutes").select("id, name"),
    supabase.from("teachers").select("id, name"),
    supabase.from("courses").select("id, name"),
    supabase.from("subjects").select("id, name"),
    supabase.from("contents").select("id, name"),
  ]);

  const out: Record<string, string> = {};
  for (const result of [institutes, teachers, courses, subjects, contents]) {
    for (const row of result.data ?? []) out[row.id] = row.name;
  }
  return out;
}
