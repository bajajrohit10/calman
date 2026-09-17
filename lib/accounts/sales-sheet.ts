/**
 * §50E.2. Reading a monthly sales workbook.
 *
 * One module for both halves of the import, because a preview that is produced
 * differently from the commit is a preview of nothing. The page parses once,
 * shows the result, and sends the same rows to the server action.
 *
 * Everything here is decided from the sheet alone plus the vendor master.
 * Rates, duplicates against earlier months and the arithmetic belong to
 * accounts.commit_sales_batch, which can see the rest of the database.
 */

import { classify } from "@/lib/accounts/classify";
import { normaliseKey } from "@/lib/accounts/normalise-key";
import {
  ZEROINFY_KOLKATA_SHEET_NAME,
  ZEROINFY_KOLKATA_FALLBACK_NOTE,
  resolveCenterArm,
} from "@/lib/accounts/center-arms";

/** The headers the importer requires. Missing any is a loud failure. */
export const REQUIRED_HEADERS = [
  "Student Name", "Contact", "State", "Course Name", "Faculty Name",
  "List Price", "Course Medium", "Payment Option", "Date Enrolled",
  "Order Number", "Teachers Price", "Actual Received", "Accounting Vendor",
  "Remarks",
] as const;

export const CONVERSION_HEADERS = [
  "Payment Date", "Order ID", "Difference Amount", "Payment Mode",
  "Reason for Conversion",
] as const;

/** Sheet values that mean "not a sale", never imported. */
export const MARKER_VENDORS = ["order conversion", "comission"] as const;
/** Sheet values that mean the order was cancelled. */
export const CANCELLED_VENDORS = ["cancelled"] as const;
export const DEFERRED_PREFIX = "transferred to sep";

export type SheetCell = unknown;

export type ParsedLine = {
  order_id: string;
  order_number: string | null;
  order_date: string | null;
  student_name: string | null;
  contact: string | null;
  state: string | null;
  course_title: string | null;
  course_medium: string | null;
  faculty_name: string | null;
  list_price: string | null;
  teachers_price: string;
  actual_received: string | null;
  payment_option: string | null;
  remarks: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  level: string | null;
  product_type: string | null;
  is_combo: boolean;
  has_books_addon: boolean;
  combo_key: string | null;
  product_key: string | null;
  status: "draft" | "cancelled" | "deferred";
  no_remittance_reason: string | null;
  /** Diagnostics for the preview; not sent to the database. */
  _sheetVendor: string;
  _row: number;
};

export type ParsedConversion = {
  order_number: string;
  payment_date: string | null;
  difference_amount: string | null;
  payment_mode: string | null;
  reason: string | null;
};

export type ParseResult = {
  lines: ParsedLine[];
  conversions: ParsedConversion[];
  missingHeaders: string[];
  /** Marker rows dropped, counted by the sheet value that identified them. */
  droppedMarkers: Record<string, number>;
  /** Marker rows that shared an order with a real row. */
  pairedMarkers: Record<string, number>;
  centerArmSplit: Record<string, number>;
  monthCounts: Record<string, number>;
  modalMonth: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const vendorKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A cell as text.
 *
 * Excel hands back five different shapes for what a person sees as one value:
 * a primitive, a Date, a formula with a cached result, rich text, and an error
 * object for #N/A. The Warehouse column in the August sheet is full of the
 * last kind, and stringifying one produces "[object Object]" in a price field,
 * so errors become empty rather than text.
 */
export function cellText(v: SheetCell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.error !== undefined) return "";
    if (o.result !== undefined) return o.result instanceof Date
      ? (o.result as Date).toISOString() : String(o.result);
    if (o.text !== undefined) return String(o.text);
    if (Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((t) => t.text).join("");
    }
    return "";
  }
  return String(v);
}

/**
 * A cell as an ISO instant.
 *
 * Excel dates arrive as Date objects already in UTC. Text dates arrive as the
 * operator typed them, which in this sheet is day-first — "14-08-2026" is the
 * fourteenth of August, and reading it the American way would move a line into
 * a month it does not belong to and rate it against the wrong grid.
 */
export function cellDate(v: SheetCell): string | null {
  if (v instanceof Date) return v.toISOString();
  const raw = cellText(v).trim();
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    // Recorded at midnight IST, which is 18:30 UTC the day before.
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    dt.setUTCMinutes(dt.getUTCMinutes() - 330);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const num = (v: SheetCell): string | null => {
  const t = cellText(v).trim().replace(/,/g, "");
  if (!t) return null;
  return Number.isNaN(Number(t)) ? null : t;
};

/** IST calendar date of an instant, as YYYY-MM-DD. */
export function istDate(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(d.getUTCMinutes() + 330);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** IST calendar month of an instant, as YYYY-MM. */
export function istMonth(iso: string): string {
  return istDate(iso).slice(0, 7);
}

/** order_id minus a trailing A/B/C, so the lines of one order group together. */
export function orderNumberOf(orderId: string): string {
  return orderId.replace(/[A-Za-z]$/, "");
}

type VendorLookup = { id: string; name: string };

export function parseSalesSheet(
  rows: SheetCell[][],
  conversionRows: SheetCell[][],
  vendors: VendorLookup[],
  aliases: { vendor_id: string; alias: string }[],
): ParseResult {
  const header = (rows[0] ?? []).map((c) => cellText(c).replace(/\s+/g, " ").trim());
  const at = new Map<string, number>();
  header.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });

  const missingHeaders = REQUIRED_HEADERS.filter((h) => !at.has(h));
  if (missingHeaders.length) {
    return {
      lines: [], conversions: [], missingHeaders, droppedMarkers: {},
      pairedMarkers: {}, centerArmSplit: {}, monthCounts: {}, modalMonth: null,
    };
  }

  const byName = new Map<string, VendorLookup>();
  for (const v of vendors) byName.set(vendorKey(v.name), v);
  for (const a of aliases) {
    const v = vendors.find((x) => x.id === a.vendor_id);
    if (v && !byName.has(vendorKey(a.alias))) byName.set(vendorKey(a.alias), v);
  }

  const col = (r: SheetCell[], h: string) => r[at.get(h)!];

  // Pass one: read every row, remembering which are markers.
  type Raw = {
    i: number; orderId: string; sheetVendor: string; teachersPrice: number;
    row: SheetCell[]; marker: string | null;
  };
  const raws: Raw[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const orderId = cellText(col(r, "Order Number")).trim();
    const student = cellText(col(r, "Student Name")).trim();
    if (!orderId && !student) continue;

    const sheetVendor = cellText(col(r, "Accounting Vendor")).trim();
    const n = norm(sheetVendor);
    const tp = Number(num(col(r, "Teachers Price")) ?? 0);
    const marker =
      MARKER_VENDORS.includes(n as (typeof MARKER_VENDORS)[number]) ? n
      : (CANCELLED_VENDORS.includes(n as (typeof CANCELLED_VENDORS)[number]) && tp === 0) ? n
      : null;
    raws.push({ i: i + 1, orderId, sheetVendor, teachersPrice: tp, row: r, marker });
  }

  // §50E.1(1). A marker row that shares its order with a real row is a note on
  // that row, not a line of its own: dropping it the other way round would
  // keep a zero and lose the sale.
  const realByOrder = new Map<string, number>();
  for (const x of raws) if (!x.marker) realByOrder.set(x.orderId, (realByOrder.get(x.orderId) ?? 0) + 1);

  const droppedMarkers: Record<string, number> = {};
  const pairedMarkers: Record<string, number> = {};
  const noteFor = new Map<string, string[]>();
  const keep: Raw[] = [];

  for (const x of raws) {
    const isMarkerVendor = MARKER_VENDORS.includes(norm(x.sheetVendor) as (typeof MARKER_VENDORS)[number]);
    // Order Conversion and Comission are never sales lines, paired or not.
    if (isMarkerVendor) {
      droppedMarkers[x.sheetVendor] = (droppedMarkers[x.sheetVendor] ?? 0) + 1;
      if (realByOrder.get(x.orderId)) {
        pairedMarkers[x.sheetVendor] = (pairedMarkers[x.sheetVendor] ?? 0) + 1;
        const list = noteFor.get(x.orderId) ?? [];
        list.push(x.sheetVendor);
        noteFor.set(x.orderId, list);
      }
      continue;
    }
    // A cancelled marker drops only when the order also has a real row.
    if (x.marker && realByOrder.get(x.orderId)) {
      droppedMarkers[x.sheetVendor] = (droppedMarkers[x.sheetVendor] ?? 0) + 1;
      pairedMarkers[x.sheetVendor] = (pairedMarkers[x.sheetVendor] ?? 0) + 1;
      const list = noteFor.get(x.orderId) ?? [];
      list.push(x.sheetVendor);
      noteFor.set(x.orderId, list);
      continue;
    }
    keep.push(x);
  }

  const centerArmSplit: Record<string, number> = {};
  const monthCounts: Record<string, number> = {};
  const lines: ParsedLine[] = [];

  for (const x of keep) {
    const r = x.row;
    const sheetVendor = x.sheetVendor;
    const n = norm(sheetVendor);
    const courseTitle = cellText(col(r, "Course Name")).trim();
    const facultyName = cellText(col(r, "Faculty Name")).trim();

    let status: ParsedLine["status"] = "draft";
    let reason: string | null = null;
    let vendorName: string | null = sheetVendor;
    const extraNotes: string[] = [...(noteFor.get(x.orderId) ?? [])
      .map((v) => `sheet also carried a ${v} marker for this order`)];

    if (n.startsWith(DEFERRED_PREFIX)) {
      status = "deferred";
      vendorName = facultyName || null;
    } else if (CANCELLED_VENDORS.includes(n as (typeof CANCELLED_VENDORS)[number])) {
      // §50E.1. An unpaired cancelled row is a real cancellation; its vendor
      // comes from Faculty Name, and if that resolves to nobody it stays null
      // rather than inventing a vendor.
      status = "cancelled";
      reason = "cancelled";
      vendorName = facultyName || null;
    } else if (/-\s*cancelled$/i.test(sheetVendor)) {
      // §50E.1(3). "BB Virtuals - Cancelled" is that vendor, cancelled.
      status = "cancelled";
      reason = "cancelled";
      vendorName = sheetVendor.replace(/\s*-\s*cancelled$/i, "").trim();
    } else if (vendorKey(sheetVendor) === vendorKey(ZEROINFY_KOLKATA_SHEET_NAME)) {
      const arm = resolveCenterArm(courseTitle);
      vendorName = arm.vendor;
      if (arm.guessed) extraNotes.push(ZEROINFY_KOLKATA_FALLBACK_NOTE);
      centerArmSplit[arm.vendor + (arm.guessed ? " (guessed)" : "")] =
        (centerArmSplit[arm.vendor + (arm.guessed ? " (guessed)" : "")] ?? 0) + 1;
    }

    const vendor = vendorName ? byName.get(vendorKey(vendorName)) : undefined;
    const courseMedium = cellText(col(r, "Course Medium")).trim();
    const cls = classify(courseTitle, courseMedium);
    const orderDate = cellDate(col(r, "Date Enrolled"));
    if (orderDate) {
      const m = istMonth(orderDate);
      monthCounts[m] = (monthCounts[m] ?? 0) + 1;
    }

    const sheetRemarks = cellText(col(r, "Remarks")).trim();
    const remarks = [sheetRemarks, ...extraNotes].filter(Boolean).join(" | ") || null;

    lines.push({
      order_id: x.orderId,
      order_number: orderNumberOf(x.orderId),
      order_date: orderDate,
      student_name: cellText(col(r, "Student Name")).trim() || null,
      contact: cellText(col(r, "Contact")).trim() || null,
      state: cellText(col(r, "State")).trim() || null,
      course_title: courseTitle || null,
      course_medium: courseMedium || null,
      faculty_name: facultyName || null,
      list_price: num(col(r, "List Price")),
      teachers_price: num(col(r, "Teachers Price")) ?? "0",
      actual_received: num(col(r, "Actual Received")),
      payment_option: cellText(col(r, "Payment Option")).trim() || null,
      remarks,
      vendor_id: vendor?.id ?? null,
      vendor_name: vendor?.name ?? vendorName,
      level: cls.level,
      product_type: cls.product_type,
      is_combo: cls.is_combo,
      has_books_addon: cls.has_books_addon,
      combo_key: normaliseKey(courseTitle),
      product_key: normaliseKey(courseTitle),
      status,
      no_remittance_reason: reason,
      _sheetVendor: sheetVendor,
      _row: x.i,
    });
  }

  const modalMonth =
    Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Conversions.
  const cHeader = (conversionRows[0] ?? []).map((c) => cellText(c).replace(/\s+/g, " ").trim());
  const cAt = new Map<string, number>();
  cHeader.forEach((h, i) => { if (h && !cAt.has(h)) cAt.set(h, i); });
  const conversions: ParsedConversion[] = [];
  if (cAt.has("Order ID")) {
    const seen = new Set<string>();
    for (let i = 1; i < conversionRows.length; i++) {
      const r = conversionRows[i];
      if (!r) continue;
      const id = cellText(r[cAt.get("Order ID")!]).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const pd = cAt.has("Payment Date") ? cellDate(r[cAt.get("Payment Date")!]) : null;
      conversions.push({
        order_number: id,
        payment_date: pd ? istDate(pd) : null,
        difference_amount: cAt.has("Difference Amount") ? num(r[cAt.get("Difference Amount")!]) : null,
        payment_mode: cAt.has("Payment Mode") ? cellText(r[cAt.get("Payment Mode")!]).trim() || null : null,
        reason: cAt.has("Reason for Conversion") ? cellText(r[cAt.get("Reason for Conversion")!]).trim() || null : null,
      });
    }
  }

  return {
    lines, conversions, missingHeaders: [], droppedMarkers, pairedMarkers,
    centerArmSplit, monthCounts, modalMonth,
  };
}
