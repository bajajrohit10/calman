"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";
import { parsePaymentsWorkbook, type PaymentParseResult } from "@/lib/accounts/payments-sheet";
import type { SheetCell } from "@/lib/accounts/sales-sheet";
import {
  EMPTY_PAYMENT_PREVIEW, EMPTY_PAYMENT_COMMIT,
  type PaymentPreview, type PaymentCommitResult,
} from "./import-state";

/** §50F.2. Upload, read 126 tabs, show what will land, then commit. */

async function readSheets(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a .xlsx file.", sheets: null, fileName: "" };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheets = wb.worksheets.map((ws) => {
    const rows: SheetCell[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row: SheetCell[] = [];
      for (let c = 1; c <= ws.columnCount; c++) row.push(ws.getRow(r).getCell(c).value);
      rows.push(row);
    }
    return { name: ws.name, rows };
  });
  return { error: null, sheets, fileName: file.name };
}

async function parseUpload(form: FormData): Promise<
  { error: string; parsed: null; fileName: string } |
  { error: null; parsed: PaymentParseResult; fileName: string }
> {
  const { error, sheets, fileName } = await readSheets(form);
  if (error || !sheets) return { error: error ?? "Unreadable file.", parsed: null, fileName };

  const supabase = await createClient();
  const vendors = await fetchAllRows<{ id: string; name: string }>((from, to) =>
    supabase.schema("accounts").from("vendors").select("id, name").range(from, to));
  const aliases = await fetchAllRows<{ vendor_id: string; alias: string }>((from, to) =>
    supabase.schema("accounts").from("vendor_aliases").select("vendor_id, alias").range(from, to));
  if (vendors.error || aliases.error) {
    return { error: vendors.error ?? aliases.error ?? "", parsed: null, fileName };
  }
  return { error: null, parsed: parsePaymentsWorkbook(sheets, vendors.rows, aliases.rows), fileName };
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

  const s = data as { inserted: number; duplicates_dropped: number; month: string };
  revalidatePath("/accounts/reconcile");
  return {
    ok: true, error: null,
    inserted: Number(s.inserted ?? 0),
    duplicatesDropped: Number(s.duplicates_dropped ?? 0),
    month: s.month ?? month,
  };
}
