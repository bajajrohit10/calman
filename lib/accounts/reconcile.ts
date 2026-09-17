import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";

/**
 * §50F.3. What we think a line earns against what was actually paid.
 *
 * One row per sales line of the month, plus one row per payment whose order we
 * never sold. That second half matters more than its size suggests: a payment
 * with no sale is either an order we failed to import or money we were not
 * owed, and both are worth knowing before the month is closed.
 */

export const RESULTS = [
  "matched", "underpaid", "overpaid", "unpaid", "no_sale", "no_rate", "zero",
] as const;
export type ReconResult = (typeof RESULTS)[number];

export const RESULT_LABELS: Record<ReconResult, string> = {
  matched: "Matched",
  underpaid: "Underpaid",
  overpaid: "Overpaid",
  unpaid: "Unpaid",
  no_sale: "Payment, no sale",
  no_rate: "No rate",
  zero: "Earns nothing",
};

export type ReconRow = {
  key: string;
  line_id: string | null;
  order_id: string;
  vendor_name: string | null;
  course_head: string | null;
  status: string | null;
  base_amount: number | null;
  base_source: string | null;
  rate_pct: number | null;
  rate_source: string | null;
  calculated: number;
  paid: number;
  diff: number;
  methods: string[];
  paid_on: string | null;
  result: ReconResult;
  /** §50F.4. Only meaningful on a portal/center row with a rate. */
  implied_price: number | null;
  product_key: string | null;
  payment_ids: string[];
  reviewed: boolean;
  review_note: string | null;
  override_pct: number | null;
  no_remittance_reason: string | null;
};

/** The head of a course title — everything before "by". */
export function courseHead(title: string | null): string | null {
  if (!title) return null;
  return title.replace(/\s+by\s+.*$/i, "").trim();
}

const PORTAL_METHODS = /portal|center|centre/i;

export async function loadReconciliation(
  batchId: string,
  paymentBatchId: string | null,
): Promise<{ rows: ReconRow[]; error: string | null }> {
  const supabase = await createClient();

  const lines = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase.schema("accounts").from("sales_lines")
      .select(`id, order_id, course_title, status, base_amount, base_source, rate_pct,
               rate_source, calculated_remittance, no_remittance_reason, override_pct,
               product_key, vendor_id, vendors ( name )`)
      .eq("batch_id", batchId)
      .order("order_id")
      .range(from, to));
  if (lines.error) return { rows: [], error: lines.error };

  const payments = paymentBatchId
    ? await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.schema("accounts").from("payments")
          .select("id, order_id, method, amount, paid_on, vendor_tab_name, reviewed, review_note")
          .eq("batch_id", paymentBatchId)
          .range(from, to))
    : { rows: [], error: null, truncated: false };
  if (payments.error) return { rows: [], error: payments.error };

  const byOrder = new Map<string, Record<string, unknown>[]>();
  for (const p of payments.rows) {
    const k = (p.order_id as string) ?? "";
    if (!byOrder.has(k)) byOrder.set(k, []);
    byOrder.get(k)!.push(p);
  }

  const rows: ReconRow[] = [];
  const seen = new Set<string>();

  for (const l of lines.rows) {
    const orderId = l.order_id as string;
    seen.add(orderId);
    const paid = byOrder.get(orderId) ?? [];
    const paidSum = paid.reduce((a, p) => a + Number(p.amount ?? 0), 0);
    const calculated = Number(l.calculated_remittance ?? 0);
    const diff = Math.round((paidSum - calculated) * 100) / 100;
    const pct = l.rate_pct === null || l.rate_pct === undefined ? null : Number(l.rate_pct);
    const dead = l.status === "cancelled" || l.status === "deferred" || l.no_remittance_reason;

    let result: ReconResult;
    if (dead) result = "zero";
    else if (l.rate_source === "none") result = "no_rate";
    else if (paid.length === 0) result = calculated > 0 ? "unpaid" : "zero";
    else if (Math.abs(diff) <= 1) result = "matched";
    else result = diff < 0 ? "underpaid" : "overpaid";

    const methods = [...new Set(paid.map((p) => (p.method as string) ?? "—"))];
    // §50F.4. paid = price × (1 − pct/100), so the price the vendor is really
    // working from falls out of what they sent. Only meaningful when a rate is
    // agreed and the money came through a portal or a branch.
    const portalish = methods.some((m) => PORTAL_METHODS.test(m));
    const implied =
      portalish && pct !== null && pct < 100 && paidSum > 0 &&
      (result === "underpaid" || result === "overpaid")
        ? Math.round((paidSum / (1 - pct / 100)) * 100) / 100
        : null;

    rows.push({
      key: `l:${l.id as string}`,
      line_id: l.id as string,
      order_id: orderId,
      vendor_name: ((l.vendors as { name: string } | null) ?? null)?.name ?? null,
      course_head: courseHead(l.course_title as string),
      status: l.status as string,
      base_amount: l.base_amount === null ? null : Number(l.base_amount),
      base_source: (l.base_source as string) ?? null,
      rate_pct: pct,
      rate_source: (l.rate_source as string) ?? null,
      calculated,
      paid: paidSum,
      diff,
      methods,
      paid_on: (paid[0]?.paid_on as string) ?? null,
      result,
      implied_price: implied,
      product_key: (l.product_key as string) ?? null,
      payment_ids: paid.map((p) => p.id as string),
      reviewed: paid.length > 0 && paid.every((p) => Boolean(p.reviewed)),
      review_note: (paid.find((p) => p.review_note)?.review_note as string) ?? null,
      override_pct: l.override_pct === null || l.override_pct === undefined
        ? null : Number(l.override_pct),
      no_remittance_reason: (l.no_remittance_reason as string) ?? null,
    });
  }

  // Payments whose order we never sold.
  for (const [orderId, paid] of byOrder) {
    if (seen.has(orderId)) continue;
    const paidSum = paid.reduce((a, p) => a + Number(p.amount ?? 0), 0);
    rows.push({
      key: `p:${orderId}`,
      line_id: null,
      order_id: orderId,
      vendor_name: (paid[0]?.vendor_tab_name as string) ?? null,
      course_head: null, status: null, base_amount: null, base_source: null,
      rate_pct: null, rate_source: null,
      calculated: 0, paid: paidSum, diff: paidSum,
      methods: [...new Set(paid.map((p) => (p.method as string) ?? "—"))],
      paid_on: (paid[0]?.paid_on as string) ?? null,
      result: "no_sale", implied_price: null, product_key: null,
      payment_ids: paid.map((p) => p.id as string),
      reviewed: paid.every((p) => Boolean(p.reviewed)),
      review_note: (paid.find((p) => p.review_note)?.review_note as string) ?? null,
      override_pct: null, no_remittance_reason: null,
    });
  }

  return { rows, error: null };
}

export async function loadPaymentBatches(): Promise<{ id: string; month: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounts").from("payment_batches")
    .select("id, month").order("month", { ascending: false });
  return (data ?? []) as { id: string; month: string }[];
}
