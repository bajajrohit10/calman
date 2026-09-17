/**
 * §50F.2. Reading the monthly payments workbook.
 *
 * The sales sheet is one tab with a fixed layout. This is 126 tabs with 59
 * different ones: the header sits on row 1 or row 2, the columns march from
 * N–Q to S–V depending on how many extra columns that vendor's tab grew, and
 * the method column is headed "Payment Method" on some tabs and "Portal" on
 * others. So nothing here is addressed by position — every column is found by
 * its header name, per tab.
 *
 * One exception proves why. `Sanjay Saraf` has two columns headed "Amount":
 * column J beside Course Name, which is what the student paid us, and column P
 * beside Payment Method, which is what the vendor paid out. Taking the first
 * match — the obvious implementation — reads the wrong number for that entire
 * tab. So Amount is the one that sits *between* the method column and the date
 * column, which is true on all 59 and needs no special case.
 */

import { cellText, cellDate, istDate, type SheetCell } from "@/lib/accounts/sales-sheet";

export const META_TABS = ["Top Sheet", "Details", "Portal Links", "VSmart Sharing Ratio"];

const ORDER_HEADERS = ["order id"];
const METHOD_HEADERS = ["payment method", "portal"];
const AMOUNT_HEADERS = ["amount"];
const DATE_HEADERS = ["date of payment"];
const TXN_HEADERS = ["transaction id"];

export type TabKind = "payment" | "order_list" | "meta" | "no_header";

export type TabReport = {
  name: string;
  kind: TabKind;
  headerRow: number | null;
  rows: number;
  blankAmount: number;
  /** Opening/closing balance notes, carried so nothing is silently dropped. */
  notes: string[];
  vendorId: string | null;
  vendorName: string | null;
};

export type ParsedPayment = {
  order_id: string;
  vendor_tab_name: string;
  vendor_id: string | null;
  method: string | null;
  amount: string | null;
  paid_on: string | null;
  transaction_id: string | null;
  raw_row: Record<string, string>;
};

export type PaymentParseResult = {
  payments: ParsedPayment[];
  tabs: TabReport[];
  unresolvedTabs: string[];
  noHeaderTabs: { name: string; rows: number }[];
  balanceNotes: { tab: string; note: string }[];
  skippedBlankAmount: number;
  duplicateOrderIds: { order_id: string; tabs: string[] }[];
  monthCounts: Record<string, number>;
  modalMonth: string | null;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const vendorKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Header = {
  row: number;
  order: number;
  method: number | null;
  amount: number | null;
  date: number | null;
  txn: number | null;
};

/**
 * Find the header inside the first three rows.
 *
 * Amount is chosen positionally among the columns headed "Amount": the one
 * after the method column and before the date column. Where there is only one
 * it is that one, so the rule costs nothing on the other 58 tabs.
 */
export function findHeader(rows: SheetCell[][]): Header | null {
  for (let r = 0; r < Math.min(3, rows.length); r++) {
    const cells = (rows[r] ?? []).map((c) => norm(cellText(c)));
    const at = (names: string[]) => {
      const out: number[] = [];
      cells.forEach((h, i) => { if (h && names.includes(h)) out.push(i); });
      return out;
    };
    const order = at(ORDER_HEADERS)[0];
    const method = at(METHOD_HEADERS)[0];
    const date = at(DATE_HEADERS)[0];
    const amounts = at(AMOUNT_HEADERS);
    if (order === undefined || date === undefined || amounts.length === 0) continue;

    const amount =
      amounts.find((i) => (method === undefined || i > method) && i < date) ??
      amounts[amounts.length - 1];

    return {
      row: r,
      order,
      method: method ?? null,
      amount,
      date,
      txn: at(TXN_HEADERS)[0] ?? null,
    };
  }
  return null;
}

/** Any Opening/Closing balance wording in the first three rows, with its value. */
function balanceNotes(rows: SheetCell[][]): string[] {
  const out: string[] = [];
  for (let r = 0; r < Math.min(3, rows.length); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = cellText(row[c]).trim();
      if (!/opening\s*bal|closing\s*bal/i.test(t)) continue;
      const next = cellText(row[c + 1]).trim();
      // Two shapes in the wild: the value in the next cell, or inside the label.
      out.push(next ? `${t} ${next}` : t);
    }
  }
  return out;
}

const num = (v: SheetCell): string | null => {
  const t = cellText(v).trim().replace(/,/g, "").replace(/^₹/, "");
  if (!t) return null;
  return Number.isNaN(Number(t)) ? null : t;
};

export function parsePaymentsWorkbook(
  sheets: { name: string; rows: SheetCell[][] }[],
  vendors: { id: string; name: string }[],
  aliases: { vendor_id: string; alias: string }[],
): PaymentParseResult {
  const byName = new Map<string, { id: string; name: string }>();
  for (const v of vendors) byName.set(vendorKey(v.name), v);
  for (const a of aliases) {
    const v = vendors.find((x) => x.id === a.vendor_id);
    if (v && !byName.has(vendorKey(a.alias))) byName.set(vendorKey(a.alias), v);
  }

  const payments: ParsedPayment[] = [];
  const tabs: TabReport[] = [];
  const noHeaderTabs: { name: string; rows: number }[] = [];
  const allNotes: { tab: string; note: string }[] = [];
  const unresolvedTabs: string[] = [];
  const seenIn = new Map<string, Set<string>>();
  const monthCounts: Record<string, number> = {};
  let skippedBlankAmount = 0;

  for (const sheet of sheets) {
    const dataRows = Math.max(0, sheet.rows.length - 1);

    if (META_TABS.includes(sheet.name)) {
      tabs.push({ name: sheet.name, kind: "meta", headerRow: null, rows: dataRows,
        blankAmount: 0, notes: [], vendorId: null, vendorName: null });
      continue;
    }

    const header = findHeader(sheet.rows);
    if (!header) {
      // Either an order list, or a tab whose header we could not see. Both are
      // skipped, and both are named in the preview — a payment tab that grew a
      // title row would otherwise vanish without a sound.
      const hasOrderId = sheet.rows.slice(0, 3).some((row) =>
        (row ?? []).some((c) => ORDER_HEADERS.includes(norm(cellText(c)))));
      tabs.push({ name: sheet.name, kind: hasOrderId ? "order_list" : "no_header",
        headerRow: null, rows: dataRows, blankAmount: 0, notes: [],
        vendorId: null, vendorName: null });
      if (!hasOrderId) noHeaderTabs.push({ name: sheet.name, rows: dataRows });
      continue;
    }

    const notes = balanceNotes(sheet.rows);
    for (const n of notes) allNotes.push({ tab: sheet.name, note: n });

    const vendor = byName.get(vendorKey(sheet.name)) ?? null;
    if (!vendor) unresolvedTabs.push(sheet.name);

    let rowCount = 0;
    let blank = 0;
    const headerCells = (sheet.rows[header.row] ?? []).map((c) => cellText(c).trim());

    for (let r = header.row + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const orderId = cellText(row[header.order]).trim();
      if (!orderId) continue;
      rowCount++;

      const amount = header.amount === null ? null : num(row[header.amount]);
      if (amount === null) { blank++; skippedBlankAmount++; continue; }

      const paidIso = header.date === null ? null : cellDate(row[header.date]);
      const paidOn = paidIso ? istDate(paidIso) : null;
      if (paidOn) {
        const m = paidOn.slice(0, 7);
        monthCounts[m] = (monthCounts[m] ?? 0) + 1;
      }

      if (!seenIn.has(orderId)) seenIn.set(orderId, new Set());
      seenIn.get(orderId)!.add(sheet.name);

      // The whole row is kept so a question about a payment can be answered
      // from Calman rather than by reopening the workbook.
      const raw: Record<string, string> = {};
      headerCells.forEach((h, i) => {
        if (!h) return;
        const v = cellText(row[i]).trim();
        if (v) raw[h] = v;
      });

      payments.push({
        order_id: orderId,
        vendor_tab_name: sheet.name,
        vendor_id: vendor?.id ?? null,
        method: header.method === null ? null : cellText(row[header.method]).trim() || null,
        amount,
        paid_on: paidOn,
        transaction_id: header.txn === null ? null : cellText(row[header.txn]).trim() || null,
        raw_row: raw,
      });
    }

    tabs.push({ name: sheet.name, kind: "payment", headerRow: header.row + 1,
      rows: rowCount, blankAmount: blank, notes,
      vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? null });
  }

  const duplicateOrderIds = [...seenIn.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([order_id, s]) => ({ order_id, tabs: [...s] }));

  const modalMonth =
    Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    payments, tabs, unresolvedTabs, noHeaderTabs,
    balanceNotes: allNotes, skippedBlankAmount, duplicateOrderIds,
    monthCounts, modalMonth,
  };
}
