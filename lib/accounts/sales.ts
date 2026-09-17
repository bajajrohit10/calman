import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";

/** §50E.3. The month's lines, as the list screen needs them. */

export {
  RATE_SOURCES, LINE_STATUSES, NO_REMITTANCE_REASONS,
} from "@/lib/accounts/sales-enums";

export type SalesLine = {
  id: string;
  order_id: string;
  order_number: string | null;
  order_date: string | null;
  student_name: string | null;
  course_title: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  level: string | null;
  product_type: string | null;
  is_combo: boolean;
  is_center: boolean;
  language: string;
  teachers_price: number | null;
  base_amount: number | null;
  base_source: string | null;
  payment_mode: string | null;
  rate_pct: number | null;
  rate_source: string | null;
  override_pct: number | null;
  override_note: string | null;
  calculated_remittance: number | null;
  no_remittance_reason: string | null;
  status: string;
  remarks: string | null;
  conversion: { difference_amount: number | null; reason: string | null } | null;
};

export type Batch = { id: string; month: string; row_count: number; file_name: string };

export async function loadBatches(): Promise<Batch[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounts").from("sales_batches")
    .select("id, month, row_count, file_name")
    .order("month", { ascending: false });
  return (data ?? []) as Batch[];
}

export { SALES_TABS, type SalesTab } from "@/lib/accounts/sales-enums";
import { SALES_TABS } from "@/lib/accounts/sales-enums";
import type { SalesTab } from "@/lib/accounts/sales-enums";

export type SalesFilters = {
  batchId: string;
  tab?: SalesTab;
  vendor?: string;
  status?: string;
  rateSource?: string;
  level?: string;
  productType?: string;
  attention?: boolean;
};

export async function loadSalesLines(
  f: SalesFilters,
): Promise<{ rows: SalesLine[]; error: string | null }> {
  const supabase = await createClient();

  // fetchAllRows because a month is 1,500 rows and PostgREST stops at 1,000
  // without saying so — the footer totals would be quietly short.
  const { rows, error } = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let q = supabase
      .schema("accounts").from("sales_lines")
      .select(`id, order_id, order_number, order_date, student_name, course_title,
               vendor_id, level, product_type, is_combo, is_center, language,
               teachers_price, base_amount, base_source, rate_pct,
               rate_source, override_pct, override_note, calculated_remittance,
               no_remittance_reason, payment_mode, status, remarks, vendors ( name )`)
      .eq("batch_id", f.batchId)
      .order("order_date", { ascending: true })
      .range(from, to);
    if (f.vendor) q = q.eq("vendor_id", f.vendor);
    if (f.status) q = q.eq("status", f.status);
    if (f.rateSource) q = q.eq("rate_source", f.rateSource);
    if (f.level) q = q.eq("level", f.level);
    if (f.productType) q = q.eq("product_type", f.productType);
    return q;
  });
  if (error) return { rows: [], error };

  // The tab is the line's own payment_mode, which the import copied from the
  // vendor — so a line stays in the tab it was imported under even if the
  // vendor's default changes later, which is what somebody reconciling a
  // closed month expects.
  const mode = SALES_TABS.find((t) => t.id === (f.tab ?? "all"))?.mode ?? null;
  const byTab = mode ? rows.filter((r) => r.payment_mode === mode) : rows;

  // "Needs attention" is an OR across two columns, which PostgREST can express
  // but not alongside the other filters without getting hard to read; 1,500
  // rows are already in memory, so it is applied here.
  const filtered = f.attention
    ? byTab.filter((r) => !r.vendor_id || r.rate_source === "none")
    : byTab;

  const orderNumbers = [...new Set(filtered.map((r) => r.order_number).filter(Boolean))] as string[];
  const conversions = new Map<string, { difference_amount: number | null; reason: string | null }>();
  for (let i = 0; i < orderNumbers.length; i += 400) {
    const { data } = await supabase
      .schema("accounts").from("order_conversions")
      .select("order_number, difference_amount, reason")
      .in("order_number", orderNumbers.slice(i, i + 400));
    for (const c of data ?? []) {
      conversions.set(c.order_number as string, {
        difference_amount: c.difference_amount === null ? null : Number(c.difference_amount),
        reason: (c.reason as string) ?? null,
      });
    }
  }

  return {
    rows: filtered.map((r) => ({
      id: r.id as string,
      order_id: r.order_id as string,
      order_number: (r.order_number as string) ?? null,
      order_date: (r.order_date as string) ?? null,
      student_name: (r.student_name as string) ?? null,
      course_title: (r.course_title as string) ?? null,
      vendor_id: (r.vendor_id as string) ?? null,
      vendor_name: ((r.vendors as { name: string } | null) ?? null)?.name ?? null,
      level: (r.level as string) ?? null,
      product_type: (r.product_type as string) ?? null,
      is_combo: Boolean(r.is_combo),
      is_center: Boolean(r.is_center),
      language: (r.language as string) ?? "hindi",
      teachers_price: r.teachers_price === null ? null : Number(r.teachers_price),
      base_amount: r.base_amount === null ? null : Number(r.base_amount),
      base_source: (r.base_source as string) ?? null,
      payment_mode: (r.payment_mode as string) ?? null,
      rate_pct: r.rate_pct === null || r.rate_pct === undefined ? null : Number(r.rate_pct),
      rate_source: (r.rate_source as string) ?? null,
      override_pct: r.override_pct === null || r.override_pct === undefined ? null : Number(r.override_pct),
      override_note: (r.override_note as string) ?? null,
      calculated_remittance: r.calculated_remittance === null ? null : Number(r.calculated_remittance),
      no_remittance_reason: (r.no_remittance_reason as string) ?? null,
      status: r.status as string,
      remarks: (r.remarks as string) ?? null,
      conversion: conversions.get(r.order_number as string) ?? null,
    })),
    error: null,
  };
}

/** Vendors plus their aliases, for the inline "change vendor" dropdown. */
export async function loadVendorChoices(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const vendors = await fetchAllRows<{ id: string; name: string }>((from, to) =>
    supabase.schema("accounts").from("vendors").select("id, name").order("name").range(from, to));
  const aliases = await fetchAllRows<{ vendor_id: string; alias: string }>((from, to) =>
    supabase.schema("accounts").from("vendor_aliases").select("vendor_id, alias").range(from, to));

  const out = vendors.rows.map((v) => ({ id: v.id, label: v.name }));
  const names = new Map(vendors.rows.map((v) => [v.id, v.name]));
  for (const a of aliases.rows) {
    const n = names.get(a.vendor_id);
    if (n && a.alias !== n) out.push({ id: a.vendor_id, label: `${a.alias}  →  ${n}` });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
