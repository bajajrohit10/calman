"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";
import { parseSalesSheet, type ParseResult, type SheetCell } from "@/lib/accounts/sales-sheet";
import {
  EMPTY_PREVIEW, EMPTY_COMMIT,
  type ImportPreview, type CommitResult,
} from "./import-state";

/**
 * §50E.2. Uploading a month of sales.
 *
 * Preview and commit both take the file and parse it again, rather than the
 * preview handing the commit a parsed payload. Two reasons: a server action is
 * stateless, so the payload would have to make a round trip through the
 * browser — 1,500 rows of it — and more importantly what gets committed is
 * then guaranteed to be what the file says, not what a screen said some
 * minutes ago.
 */

const CONVERSION_TAB = "Converted Orders";

function grid(ws: ExcelJS.Worksheet): SheetCell[][] {
  const out: SheetCell[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: SheetCell[] = [];
    for (let c = 1; c <= ws.columnCount; c++) row.push(ws.getRow(r).getCell(c).value);
    out.push(row);
  }
  return out;
}

/** The first worksheet whose first three rows name an "Order Number" column. */
function findSalesTab(wb: ExcelJS.Workbook): string | null {
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(3, ws.rowCount); r++) {
      for (let c = 1; c <= ws.columnCount; c++) {
        const h = String(ws.getRow(r).getCell(c).value ?? "").replace(/\s+/g, " ").trim();
        if (h.toLowerCase() === "order number") return ws.name;
      }
    }
  }
  return null;
}

async function readWorkbook(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a .xlsx file." as string, wb: null, tabs: [] as string[] };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return { error: null, wb, tabs: wb.worksheets.map((w) => w.name) };
}

/** The vendor master, read whole — it is well under a page but the cap is silent. */
async function vendorLookup() {
  const supabase = await createClient();
  const vendors = await fetchAllRows<{ id: string; name: string }>((from, to) =>
    supabase.schema("accounts").from("vendors").select("id, name").range(from, to));
  const aliases = await fetchAllRows<{ vendor_id: string; alias: string }>((from, to) =>
    supabase.schema("accounts").from("vendor_aliases").select("vendor_id, alias").range(from, to));
  return { vendors: vendors.rows, aliases: aliases.rows, error: vendors.error ?? aliases.error };
}

async function parseUpload(form: FormData): Promise<
  { error: string; parsed: null; tabs: string[]; tab: null } |
  { error: null; parsed: ParseResult; tabs: string[]; tab: string }
> {
  const { error, wb, tabs } = await readWorkbook(form);
  if (error || !wb) return { error: error ?? "Unreadable file.", parsed: null, tabs, tab: null };

  // §50F.0(c). Which sheet holds the sales.
  //
  // "Course" by name, and failing that the first tab whose top three rows
  // contain an "Order Number" header. The workbook opens on Sheet33 — a
  // scratch list — so falling back to the first tab picked a sheet with no
  // sales in it and, worse, showed "Sheet33" in the dropdown while having
  // silently parsed Course, so the screen disagreed with what it had done.
  const wanted = String(form.get("tab") ?? "").trim();
  const tab = wanted && tabs.includes(wanted)
    ? wanted
    : tabs.includes("Course") ? "Course" : (findSalesTab(wb) ?? tabs[0]);
  const ws = wb.getWorksheet(tab);
  if (!ws) return { error: `No tab named ${tab}.`, parsed: null, tabs, tab: null };

  const conv = wb.getWorksheet(CONVERSION_TAB);
  const { vendors, aliases, error: vErr } = await vendorLookup();
  if (vErr) return { error: vErr, parsed: null, tabs, tab: null };

  const parsed = parseSalesSheet(grid(ws), conv ? grid(conv) : [], vendors, aliases);
  return { error: null, parsed, tabs, tab };
}

export async function previewImport(
  _prev: ImportPreview,
  form: FormData,
): Promise<ImportPreview> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const { error, parsed, tabs, tab } = await parseUpload(form);
  if (error || !parsed) return { ...EMPTY_PREVIEW, error, tabs };

  if (parsed.missingHeaders.length) {
    return {
      ...EMPTY_PREVIEW, tabs, tab,
      missingHeaders: parsed.missingHeaders,
      error: `The sheet is missing ${parsed.missingHeaders.length} expected column(s): ${parsed.missingHeaders.join(", ")}.`,
    };
  }

  const chosenMonth = String(form.get("month") ?? "").trim() || parsed.modalMonth;

  // Which of these orders already exist, and does this month already have a
  // batch? Both are read here so the preview can say what the commit will do.
  const orderIds = parsed.lines.map((l) => l.order_id);
  const existingOrders = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 400) {
    const slice = orderIds.slice(i, i + 400);
    const { data } = await supabase
      .schema("accounts").from("sales_lines")
      .select("order_id").in("order_id", slice);
    for (const r of data ?? []) existingOrders.add(r.order_id as string);
  }

  let existingMonth: ImportPreview["existingMonth"] = null;
  if (chosenMonth) {
    const { data: batch } = await supabase
      .schema("accounts").from("sales_batches")
      .select("id, month, row_count").eq("month", `${chosenMonth}-01`).maybeSingle();
    if (batch) {
      const { count } = await supabase
        .schema("accounts").from("sales_lines")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batch.id).eq("status", "paid");
      existingMonth = {
        month: batch.month as string,
        rows: Number(batch.row_count ?? 0),
        paid: count ?? 0,
      };
    }
  }

  // rate_source none is predicted, not computed: the real resolution happens
  // inside the commit. A line with no vendor, level or type can never resolve,
  // which is the number worth warning about.
  const rateNone = parsed.lines.filter(
    (l) => !l.vendor_id || !l.level || !l.product_type).length;

  const vendorNullNames: Record<string, number> = {};
  for (const l of parsed.lines) {
    if (l.vendor_id) continue;
    const k = l.vendor_name || l._sheetVendor || "(blank)";
    vendorNullNames[k] = (vendorNullNames[k] ?? 0) + 1;
  }

  const byStatus = (s: string) => parsed.lines.filter((l) => l.status === s).length;

  return {
    ok: true, error: null, missingHeaders: [], tabs, tab,
    modalMonth: parsed.modalMonth, monthCounts: parsed.monthCounts,
    totals: {
      lines: parsed.lines.length,
      draft: byStatus("draft"),
      cancelled: byStatus("cancelled"),
      deferred: byStatus("deferred"),
      vendorNull: parsed.lines.filter((l) => !l.vendor_id).length,
      rateNone,
      alreadyImported: [...existingOrders].length,
      conversions: parsed.conversions.length,
    },
    droppedMarkers: parsed.droppedMarkers,
    pairedMarkers: parsed.pairedMarkers,
    centerArmSplit: parsed.centerArmSplit,
    vendorNullNames,
    duplicateOrders: [...existingOrders].slice(0, 50),
    existingMonth,
  };
}

export async function commitImport(
  _prev: CommitResult,
  form: FormData,
): Promise<CommitResult> {
  const { profile } = await requireAccountsProfile();
  const supabase = await createClient();

  const { error, parsed } = await parseUpload(form);
  if (error || !parsed) return { ...EMPTY_COMMIT, error };
  if (parsed.missingHeaders.length) {
    return { ...EMPTY_COMMIT, error: `Missing columns: ${parsed.missingHeaders.join(", ")}.` };
  }

  const month = String(form.get("month") ?? "").trim() || parsed.modalMonth;
  if (!month) return { ...EMPTY_COMMIT, error: "Pick a month." };
  const replace = String(form.get("replace") ?? "") === "1";
  const fileName = String((form.get("file") as File)?.name ?? "upload.xlsx");

  // The diagnostics the preview needed are not columns; strip them.
  const rows = parsed.lines.map(({ _sheetVendor, _row, vendor_name, ...r }) => {
    void _sheetVendor; void _row; void vendor_name;
    return r;
  });

  const { data, error: rpcError } = await supabase
    .schema("accounts")
    .rpc("commit_sales_batch", {
      p_month: `${month}-01`,
      p_file_name: fileName,
      p_uploaded_by: profile.id,
      p_rows: rows,
      p_conversions: parsed.conversions,
      p_replace: replace,
    });

  if (rpcError) return { ...EMPTY_COMMIT, error: rpcError.message };

  const summary = data as {
    inserted: number; superseded_deferred: number;
    skipped: { order_id: string; status: string }[]; conversions: number; month: string;
  };

  revalidatePath("/accounts/sales");
  revalidatePath("/accounts/rates");
  return {
    ok: true, error: null,
    inserted: Number(summary.inserted ?? 0),
    superseded: Number(summary.superseded_deferred ?? 0),
    skipped: summary.skipped ?? [],
    conversions: Number(summary.conversions ?? 0),
    month: summary.month ?? month,
  };
}
