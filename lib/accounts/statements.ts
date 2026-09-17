import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";

/**
 * §50G.2. A vendor's month, as they will see it.
 *
 * Built from the live rows while the month is open and from the frozen
 * snapshot once it is closed — but the shape is the same either way, so the
 * screen and the export do not have to know which they are looking at.
 */

export {
  ADJUSTMENT_REASONS, ADJUSTMENT_REASON_LABELS,
} from "@/lib/accounts/adjustment-enums";

export type StatementLine = {
  order_id: string;
  order_date: string | null;
  student_name: string | null;
  course_title: string | null;
  course_medium: string | null;
  list_price: number | null;
  teachers_price: number | null;
  base_amount: number | null;
  base_source: string | null;
  rate_pct: number | null;
  calculated_remittance: number;
  payment_mode: string | null;
  paid: number;
  balance_due: number;
  no_remittance_reason: string | null;
  remarks: string | null;
  status: string;
};

export type StatementAdjustment = {
  id: string;
  amount: number;
  reason: string | null;
  linked_order_id: string | null;
  note: string | null;
};

export type WalletBlock = {
  opening: number;
  top_ups: number;
  deductions: number;
  closing: number;
};

export type Statement = {
  vendor_id: string;
  vendor_name: string;
  institute: string | null;
  payment_mode: string;
  month: string;
  status: "draft" | "final" | "paid";
  version: number | null;
  lines: StatementLine[];
  adjustments: StatementAdjustment[];
  total_remittance: number;
  total_paid: number;
  total_adjustments: number;
  net_payable: number;
  wallet: WalletBlock | null;
  paid_on: string | null;
  payment_reference: string | null;
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Statement-eligible lines: cancelled and deferred are not owed on. */
const SHOWN = ["draft", "ready", "paid"];

export async function loadStatement(
  vendorId: string,
  month: string,
): Promise<{ statement: Statement | null; error: string | null }> {
  const supabase = await createClient();

  const { data: vendor } = await supabase
    .schema("accounts").from("vendors")
    .select("id, name, institute, default_payment_mode, tracks_portal_balance, portal_owner_vendor_id")
    .eq("id", vendorId).maybeSingle();
  if (!vendor) return { statement: null, error: "Vendor not found." };

  const { data: batch } = await supabase
    .schema("accounts").from("sales_batches")
    .select("id").eq("month", `${month}-01`).maybeSingle();

  const lines = batch
    ? await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.schema("accounts").from("sales_lines")
          .select(`order_id, order_date, student_name, course_title, course_medium,
                   list_price, teachers_price, base_amount, base_source, rate_pct,
                   calculated_remittance, payment_mode, no_remittance_reason, remarks, status`)
          .eq("batch_id", batch.id).eq("vendor_id", vendorId)
          .in("status", SHOWN)
          .order("order_date").range(from, to))
    : { rows: [], error: null, truncated: false };
  if (lines.error) return { statement: null, error: lines.error };

  // What has actually been paid, per order.
  const orderIds = lines.rows.map((l) => l.order_id as string);
  const paidBy = new Map<string, number>();
  for (let i = 0; i < orderIds.length; i += 400) {
    const { data } = await supabase
      .schema("accounts").from("payments")
      .select("order_id, amount").in("order_id", orderIds.slice(i, i + 400));
    for (const p of data ?? []) {
      const k = p.order_id as string;
      paidBy.set(k, (paidBy.get(k) ?? 0) + Number(p.amount ?? 0));
    }
  }

  const statementLines: StatementLine[] = lines.rows.map((l) => {
    const remit = Number(l.calculated_remittance ?? 0);
    const paid = paidBy.get(l.order_id as string) ?? 0;
    return {
      order_id: l.order_id as string,
      order_date: (l.order_date as string) ?? null,
      student_name: (l.student_name as string) ?? null,
      course_title: (l.course_title as string) ?? null,
      course_medium: (l.course_medium as string) ?? null,
      list_price: n(l.list_price),
      teachers_price: n(l.teachers_price),
      base_amount: n(l.base_amount),
      base_source: (l.base_source as string) ?? null,
      rate_pct: n(l.rate_pct),
      calculated_remittance: remit,
      payment_mode: (l.payment_mode as string) ?? null,
      paid,
      balance_due: Math.round((remit - paid) * 100) / 100,
      no_remittance_reason: (l.no_remittance_reason as string) ?? null,
      remarks: (l.remarks as string) ?? null,
      status: l.status as string,
    };
  });

  const { data: adjRows } = await supabase
    .schema("accounts").from("adjustments")
    .select("id, amount, reason, linked_order_id, note")
    .eq("vendor_id", vendorId).eq("month", `${month}-01`);
  const adjustments: StatementAdjustment[] = (adjRows ?? []).map((a) => ({
    id: a.id as string,
    amount: Number(a.amount ?? 0),
    reason: (a.reason as string) ?? null,
    linked_order_id: (a.linked_order_id as string) ?? null,
    note: (a.note as string) ?? null,
  }));

  const { data: stmt } = await supabase
    .schema("accounts").from("statements")
    .select("version, status, paid_on, payment_reference")
    .eq("vendor_id", vendorId).eq("month", `${month}-01`)
    .order("version", { ascending: false }).limit(1).maybeSingle();

  const totalRemit = statementLines.reduce((a, l) => a + l.calculated_remittance, 0);
  const totalPaid = statementLines.reduce((a, l) => a + l.paid, 0);
  const totalAdj = adjustments.reduce((a, x) => a + x.amount, 0);

  // §50G.2. Wallet block, for a vendor that owns one.
  let wallet: WalletBlock | null = null;
  if (vendor.tracks_portal_balance && !vendor.portal_owner_vendor_id) {
    wallet = await walletBlock(vendorId, month);
  }

  return {
    statement: {
      vendor_id: vendorId,
      vendor_name: vendor.name as string,
      institute: (vendor.institute as string) ?? null,
      payment_mode: vendor.default_payment_mode as string,
      month,
      status: (stmt?.status as "final" | "paid") ?? "draft",
      version: stmt ? Number(stmt.version) : null,
      lines: statementLines,
      adjustments,
      total_remittance: Math.round(totalRemit * 100) / 100,
      total_paid: Math.round(totalPaid * 100) / 100,
      total_adjustments: Math.round(totalAdj * 100) / 100,
      net_payable: Math.round((totalRemit + totalAdj - totalPaid) * 100) / 100,
      wallet,
      paid_on: (stmt?.paid_on as string) ?? null,
      payment_reference: (stmt?.payment_reference as string) ?? null,
    },
    error: null,
  };
}

/** Opening, movement and closing for one wallet in one month. */
export async function walletBlock(vendorId: string, month: string): Promise<WalletBlock> {
  const supabase = await createClient();
  const start = `${month}-01`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString().slice(0, 10);

  const all = await fetchAllRows<{ entry_date: string; kind: string; amount: number }>((from, to) =>
    supabase.schema("accounts").from("portal_ledger")
      .select("entry_date, kind, amount").eq("vendor_id", vendorId)
      .order("entry_date").range(from, to));

  let opening = 0, topUps = 0, deductions = 0, adjustments = 0;
  for (const e of all.rows) {
    const amt = Number(e.amount ?? 0);
    if (e.entry_date < start) { opening += amt; continue; }
    if (e.entry_date > end) continue;
    if (e.kind === "opening") opening += amt;
    else if (e.kind === "top_up") topUps += amt;
    else if (e.kind === "deduction") deductions += amt;
    else adjustments += amt;
  }
  const closing = opening + topUps + deductions + adjustments;
  return {
    opening: Math.round(opening * 100) / 100,
    top_ups: Math.round(topUps * 100) / 100,
    deductions: Math.round(deductions * 100) / 100,
    closing: Math.round(closing * 100) / 100,
  };
}

export type VendorMonthRow = {
  vendor_id: string;
  vendor_name: string;
  kind: string;
  lines: number;
  remittance: number;
  paid: number;
  adjustments: number;
  diff: number;
  statement_status: "draft" | "final" | "paid";
  version: number | null;
  wallet_balance: number | null;
};

/**
 * §50G.3. The overview: every vendor with something in this month.
 *
 * One pass over the month's lines rather than a query per vendor — 1,500 rows
 * grouped in memory is faster than 100 round trips and, more to the point,
 * gives a consistent picture rather than a hundred snapshots taken at slightly
 * different times.
 */
export async function loadVendorMonths(
  month: string,
): Promise<{ rows: VendorMonthRow[]; error: string | null }> {
  const supabase = await createClient();

  const { data: batch } = await supabase
    .schema("accounts").from("sales_batches")
    .select("id").eq("month", `${month}-01`).maybeSingle();

  const lines = batch
    ? await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase.schema("accounts").from("sales_lines")
          .select("vendor_id, order_id, calculated_remittance, status, vendors ( name, kind )")
          .eq("batch_id", batch.id).in("status", SHOWN).range(from, to))
    : { rows: [], error: null, truncated: false };
  if (lines.error) return { rows: [], error: lines.error };

  const payments = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase.schema("accounts").from("payments")
      .select("order_id, amount, payment_batches!inner ( month )")
      .eq("payment_batches.month", `${month}-01`).range(from, to));

  const paidBy = new Map<string, number>();
  for (const p of payments.rows) {
    const k = p.order_id as string | null;
    if (!k) continue;
    paidBy.set(k, (paidBy.get(k) ?? 0) + Number(p.amount ?? 0));
  }

  const agg = new Map<string, VendorMonthRow>();
  for (const l of lines.rows) {
    const id = l.vendor_id as string | null;
    if (!id) continue;
    const v = (l.vendors as { name: string; kind: string } | null) ?? null;
    const cur = agg.get(id) ?? {
      vendor_id: id, vendor_name: v?.name ?? "—", kind: v?.kind ?? "—",
      lines: 0, remittance: 0, paid: 0, adjustments: 0, diff: 0,
      statement_status: "draft" as const, version: null, wallet_balance: null,
    };
    cur.lines += 1;
    cur.remittance += Number(l.calculated_remittance ?? 0);
    cur.paid += paidBy.get(l.order_id as string) ?? 0;
    agg.set(id, cur);
  }

  const { data: adjRows } = await supabase
    .schema("accounts").from("adjustments")
    .select("vendor_id, amount, vendors ( name, kind )").eq("month", `${month}-01`);
  for (const a of adjRows ?? []) {
    const id = a.vendor_id as string;
    const v = (a.vendors as { name: string; kind: string } | null) ?? null;
    const cur = agg.get(id) ?? {
      vendor_id: id, vendor_name: v?.name ?? "—", kind: v?.kind ?? "—",
      lines: 0, remittance: 0, paid: 0, adjustments: 0, diff: 0,
      statement_status: "draft" as const, version: null, wallet_balance: null,
    };
    cur.adjustments += Number(a.amount ?? 0);
    agg.set(id, cur);
  }

  const { data: stmts } = await supabase
    .schema("accounts").from("statements")
    .select("vendor_id, version, status").eq("month", `${month}-01`)
    .order("version", { ascending: true });
  for (const s of stmts ?? []) {
    const cur = agg.get(s.vendor_id as string);
    if (cur) {
      cur.statement_status = s.status as "final" | "paid";
      cur.version = Number(s.version);
    }
  }

  const { data: balances } = await supabase
    .schema("accounts").from("portal_balances").select("vendor_id, balance_after, entry_date");
  const latest = new Map<string, number>();
  for (const b of balances ?? []) latest.set(b.vendor_id as string, Number(b.balance_after ?? 0));
  for (const [id, row] of agg) {
    if (latest.has(id)) row.wallet_balance = latest.get(id)!;
    row.remittance = Math.round(row.remittance * 100) / 100;
    row.paid = Math.round(row.paid * 100) / 100;
    row.adjustments = Math.round(row.adjustments * 100) / 100;
    row.diff = Math.round((row.remittance + row.adjustments - row.paid) * 100) / 100;
  }

  return {
    rows: [...agg.values()].sort((a, b) => b.remittance - a.remittance),
    error: null,
  };
}
