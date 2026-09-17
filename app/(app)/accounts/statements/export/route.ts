import ExcelJS from "exceljs";

import { requireAccountsProfile } from "@/lib/auth";
import { ADJUSTMENT_REASON_LABELS } from "@/lib/accounts/adjustment-enums";
import { loadStatement, loadVendorMonths, type Statement } from "@/lib/accounts/statements";

/**
 * §50G.2. Statements as a workbook.
 *
 * One vendor, or every vendor with something in the month as one tab each plus
 * a Summary. A route rather than a server action because the answer is a file.
 */

const COLUMNS = [
  { header: "Order ID", key: "order_id", width: 14 },
  { header: "Order date", key: "order_date", width: 12 },
  { header: "Student", key: "student", width: 24 },
  { header: "Course", key: "course", width: 46 },
  { header: "Medium", key: "medium", width: 26 },
  { header: "List price", key: "list_price", width: 12 },
  { header: "Teachers price", key: "teachers_price", width: 14 },
  { header: "Base amount", key: "base_amount", width: 13 },
  { header: "Base source", key: "base_source", width: 14 },
  { header: "%", key: "pct", width: 7 },
  { header: "Remittance", key: "remittance", width: 13 },
  { header: "Payment mode", key: "payment_mode", width: 14 },
  { header: "Paid so far", key: "paid", width: 12 },
  { header: "Balance due", key: "balance", width: 12 },
  { header: "Remarks", key: "remarks", width: 34 },
];

/**
 * Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters.
 * Two vendors can also collapse onto the same trimmed name, so a duplicate
 * gets a numeric suffix rather than throwing.
 */
function tabName(name: string, taken: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Vendor").trim();
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

function writeStatement(ws: ExcelJS.Worksheet, s: Statement) {
  ws.addRow([s.vendor_name]).font = { bold: true, size: 13 };
  ws.addRow([`${s.institute ?? ""}`]);
  ws.addRow([`Month: ${s.month}`, `Payment mode: ${s.payment_mode}`,
             `Status: ${s.status}${s.version ? ` v${s.version}` : ""}`,
             `Generated: ${new Date().toISOString().slice(0, 10)}`]);
  if (s.wallet) {
    ws.addRow([`Wallet — opening ${s.wallet.opening}`, `top-ups ${s.wallet.top_ups}`,
               `deductions ${s.wallet.deductions}`, `closing ${s.wallet.closing}`]);
  }
  ws.addRow([]);

  const headerRow = ws.addRow(COLUMNS.map((c) => c.header));
  headerRow.font = { bold: true };
  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  for (const l of s.lines) {
    ws.addRow([
      l.order_id, l.order_date?.slice(0, 10) ?? "", l.student_name ?? "",
      l.course_title ?? "", l.course_medium ?? "", l.list_price, l.teachers_price,
      l.base_amount,
      l.base_amount !== null && l.teachers_price !== null && l.base_amount !== l.teachers_price
        ? l.base_source ?? "" : "",
      l.rate_pct, l.calculated_remittance, l.payment_mode ?? "", l.paid, l.balance_due,
      [l.remarks, l.no_remittance_reason ? `no remittance: ${l.no_remittance_reason}` : null]
        .filter(Boolean).join(" | "),
    ]);
  }

  for (const a of s.adjustments) {
    ws.addRow([
      "ADJUSTMENT", "", "",
      `${a.reason ? ADJUSTMENT_REASON_LABELS[a.reason] ?? a.reason : ""}` +
        (a.linked_order_id ? ` (${a.linked_order_id})` : ""),
      "", null, null, null, "", null, a.amount, "", null, null, a.note ?? "",
    ]);
  }

  ws.addRow([]);
  const total = ws.addRow(["TOTAL", "", "", "", "", null, null, null, "", null,
    s.total_remittance, "", s.total_paid, s.net_payable, ""]);
  total.font = { bold: true };
  ws.addRow(["Adjustments", "", "", "", "", null, null, null, "", null, s.total_adjustments]);
  ws.addRow(["Net payable", "", "", "", "", null, null, null, "", null, s.net_payable]).font =
    { bold: true };
}

export async function GET(request: Request) {
  await requireAccountsProfile();

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const vendorId = url.searchParams.get("vendor");
  const all = url.searchParams.get("all") === "1";
  if (!month) return new Response("Pick a month.", { status: 400 });

  const wb = new ExcelJS.Workbook();

  if (!all) {
    if (!vendorId) return new Response("Pick a vendor, or ask for all.", { status: 400 });
    const { statement, error } = await loadStatement(vendorId, month);
    if (error || !statement) return new Response(error ?? "Not found.", { status: 404 });
    writeStatement(wb.addWorksheet(tabName(statement.vendor_name, new Set())), statement);
    const buf = await wb.xlsx.writeBuffer();
    return file(buf, `statement-${statement.vendor_name.replace(/[^a-z0-9]+/gi, "-")}-${month}.xlsx`);
  }

  // Every vendor with a line or an adjustment this month.
  const { rows } = await loadVendorMonths(month);
  const wanted = rows.filter((r) => r.lines > 0 || r.adjustments !== 0);

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Vendor", key: "vendor", width: 32 },
    { header: "Lines", key: "lines", width: 8 },
    { header: "Remittance", key: "remittance", width: 14 },
    { header: "Paid", key: "paid", width: 14 },
    { header: "Adjustments", key: "adjustments", width: 13 },
    { header: "Net", key: "net", width: 14 },
    { header: "Statement", key: "status", width: 12 },
  ];
  summary.getRow(1).font = { bold: true };

  const taken = new Set<string>();
  for (const r of wanted) {
    const { statement } = await loadStatement(r.vendor_id, month);
    if (!statement) continue;
    summary.addRow({
      vendor: statement.vendor_name, lines: statement.lines.length,
      remittance: statement.total_remittance, paid: statement.total_paid,
      adjustments: statement.total_adjustments, net: statement.net_payable,
      status: statement.status,
    });
    writeStatement(wb.addWorksheet(tabName(statement.vendor_name, taken)), statement);
  }

  const totals = summary.addRow({
    vendor: "TOTAL",
    lines: wanted.reduce((a, r) => a + r.lines, 0),
    remittance: wanted.reduce((a, r) => a + r.remittance, 0),
    paid: wanted.reduce((a, r) => a + r.paid, 0),
    adjustments: wanted.reduce((a, r) => a + r.adjustments, 0),
    net: wanted.reduce((a, r) => a + r.diff, 0),
    status: "",
  });
  totals.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return file(buf, `statements-${month}.xlsx`);
}

function file(buf: ArrayBuffer, name: string) {
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
