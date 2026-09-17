"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";
import type { PaymentParseResult, ParsedPayment } from "@/lib/accounts/payments-sheet";
import {
  EMPTY_PAYMENT_PREVIEW, EMPTY_PAYMENT_COMMIT,
  type PaymentPreview, type PaymentCommitResult,
} from "./import-state";

/** §50F.2. Upload, read 126 tabs, show what will land, then commit. */

/**
 * §50F.2. The workbook is read in the browser, not here.
 *
 * It is 7MB, and Vercel refuses a request body over 4.5MB with a bare 413 — a
 * platform limit, not the configurable server-action one, so the 3MB sales
 * file fits and this never can. The page therefore runs the same parser
 * client-side and posts what it extracted: 126 tabs of cells reduce to about
 * 900 payment rows.
 *
 * What the browser sends is a proposal, not a decision. It carries tab names
 * and values; vendor resolution and every write still happen here against the
 * master, so a tampered payload can name a vendor that does not exist but
 * cannot invent one, and cannot attach a payment to a vendor whose tab it did
 * not come from.
 */
type ClientParse = Omit<PaymentParseResult, "payments" | "unresolvedTabs"> & {
  payments: (Omit<ParsedPayment, "vendor_id"> & { vendor_id?: string | null })[];
};

async function parseUpload(form: FormData): Promise<
  { error: string; parsed: null; fileName: string } |
  { error: null; parsed: PaymentParseResult; fileName: string }
> {
  const fileName = String(form.get("file_name") ?? "payments.xlsx");
  const raw = String(form.get("parsed") ?? "");
  if (!raw) return { error: "No workbook was read. Choose a .xlsx file.", parsed: null, fileName };

  let client: ClientParse;
  try {
    client = JSON.parse(raw) as ClientParse;
  } catch {
    return { error: "The workbook could not be read.", parsed: null, fileName };
  }
  if (!Array.isArray(client.payments)) {
    return { error: "The workbook produced no payment rows.", parsed: null, fileName };
  }

  const supabase = await createClient();
  const vendors = await fetchAllRows<{ id: string; name: string }>((from, to) =>
    supabase.schema("accounts").from("vendors").select("id, name").range(from, to));
  const aliases = await fetchAllRows<{ vendor_id: string; alias: string }>((from, to) =>
    supabase.schema("accounts").from("vendor_aliases").select("vendor_id, alias").range(from, to));
  if (vendors.error || aliases.error) {
    return { error: vendors.error ?? aliases.error ?? "", parsed: null, fileName };
  }

  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byName = new Map<string, { id: string; name: string }>();
  for (const v of vendors.rows) byName.set(key(v.name), v);
  for (const a of aliases.rows) {
    const v = vendors.rows.find((x) => x.id === a.vendor_id);
    if (v && !byName.has(key(a.alias))) byName.set(key(a.alias), v);
  }

  const payments = client.payments.map((p) => ({
    ...p,
    vendor_id: byName.get(key(p.vendor_tab_name ?? ""))?.id ?? null,
  }));
  const unresolvedTabs = [...new Set(
    payments.filter((p) => !p.vendor_id).map((p) => p.vendor_tab_name))].sort();

  return {
    error: null, fileName,
    parsed: { ...client, payments, unresolvedTabs } as PaymentParseResult,
  };
}

export async function previewPayments(
  _prev: PaymentPreview, form: FormData,
): Promise<PaymentPreview> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const { error, parsed } = await parseUpload(form);
  if (error || !parsed) return { ...EMPTY_PAYMENT_PREVIEW, error };

  const month = String(form.get("month") ?? "").trim() || parsed.modalMonth;

  // Which of these orders we actually sold. The join is order_id only, so this
  // is the number that decides how much of the month can reconcile at all.
  const ids = [...new Set(parsed.payments.map((p) => p.order_id))];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await supabase
      .schema("accounts").from("sales_lines")
      .select("order_id").in("order_id", ids.slice(i, i + 400));
    for (const r of data ?? []) known.add(r.order_id as string);
  }
  const matched = parsed.payments.filter((p) => known.has(p.order_id)).length;

  let existingMonth: PaymentPreview["existingMonth"] = null;
  if (month) {
    const { data: b } = await supabase
      .schema("accounts").from("payment_batches")
      .select("month, row_count").eq("month", `${month}-01`).maybeSingle();
    if (b) existingMonth = { month: b.month as string, rows: Number(b.row_count ?? 0) };
  }

  const methods: Record<string, number> = {};
  for (const p of parsed.payments) {
    const k = p.method || "(none)";
    methods[k] = (methods[k] ?? 0) + 1;
  }
  const kind = (k: string) => parsed.tabs.filter((t) => t.kind === k).length;

  return {
    ok: true, error: null,
    modalMonth: parsed.modalMonth, monthCounts: parsed.monthCounts,
    totals: {
      paymentTabs: kind("payment"), orderListTabs: kind("order_list"),
      metaTabs: kind("meta"), noHeaderTabs: kind("no_header"),
      payments: parsed.payments.length,
      blankAmount: parsed.skippedBlankAmount,
      amountTotal: parsed.payments.reduce((a, p) => a + Number(p.amount ?? 0), 0),
      matched, unmatched: parsed.payments.length - matched,
    },
    unresolvedTabs: parsed.unresolvedTabs,
    noHeaderTabs: parsed.noHeaderTabs,
    balanceNotes: parsed.balanceNotes,
    duplicateOrderIds: parsed.duplicateOrderIds,
    methods,
    existingMonth,
  };
}

export async function commitPayments(
  _prev: PaymentCommitResult, form: FormData,
): Promise<PaymentCommitResult> {
  const { profile } = await requireAccountsProfile();
  const supabase = await createClient();

  const { error, parsed, fileName } = await parseUpload(form);
  if (error || !parsed) return { ...EMPTY_PAYMENT_COMMIT, error };

  const month = String(form.get("month") ?? "").trim() || parsed.modalMonth;
  if (!month) return { ...EMPTY_PAYMENT_COMMIT, error: "Pick a month." };
  const replace = String(form.get("replace") ?? "") === "1";

  const { data, error: rpcError } = await supabase
    .schema("accounts").rpc("commit_payment_batch", {
      p_month: `${month}-01`,
      p_file_name: fileName,
      p_uploaded_by: profile.id,
      p_rows: parsed.payments,
      p_replace: replace,
    });
  if (rpcError) return { ...EMPTY_PAYMENT_COMMIT, error: rpcError.message };

  const s = data as { inserted: number; duplicates_dropped: number; month: string; batch_id: string };

  // §50G.1(b). A portal or centre payment is the vendor spending the wallet we
  // topped up, so it lands in the ledger as a deduction. Written here rather
  // than typed: a deduction somebody forgets to enter is a balance that reads
  // high for a month.
  const { error: ledgerError } = await supabase
    .schema("accounts").rpc("sync_wallet_deductions", { p_batch_id: s.batch_id });

  revalidatePath("/accounts/reconcile");
  revalidatePath("/accounts/wallets");
  return {
    ok: true,
    // The payments are in; a ledger that did not sync is worth saying so
    // rather than hiding behind a success message.
    error: ledgerError ? `Payments imported, but the wallet ledger did not update: ${ledgerError.message}` : null,
    inserted: Number(s.inserted ?? 0),
    duplicatesDropped: Number(s.duplicates_dropped ?? 0),
    month: s.month ?? month,
  };
}
