import ExcelJS from "exceljs";

import { requireAccountsProfile } from "@/lib/auth";
import { loadBatches } from "@/lib/accounts/sales";
import {
  RESULT_LABELS, loadPaymentBatches, loadReconciliation, type ReconResult,
} from "@/lib/accounts/reconcile";

/**
 * §50F.3. Export the current filter.
 *
 * A route rather than a server action because the answer is a file, and the
 * filter is already in the URL — so the export is the same query the screen
 * just ran, and cannot drift from what the person is looking at.
 */
export async function GET(request: Request) {
  await requireAccountsProfile();

  const url = new URL(request.url);
  const batches = await loadBatches();
  const batchId = url.searchParams.get("batch") || batches[0]?.id;
  const batch = batches.find((b) => b.id === batchId) ?? batches[0];
  if (!batch) return new Response("No sales batch to export.", { status: 404 });

  const month = String(batch.month).slice(0, 7);
  const payBatch = (await loadPaymentBatches())
    .find((p) => String(p.month).slice(0, 7) === month) ?? null;

  const { rows, error } = await loadReconciliation(batch.id, payBatch?.id ?? null);
  if (error) return new Response(error, { status: 500 });

  const vendor = url.searchParams.get("vendor") ?? "";
  const result = url.searchParams.get("result") ?? "";
  const filtered = rows.filter((r) =>
    (!vendor || r.vendor_name === vendor) && (!result || r.result === result));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Reconcile ${month}`);
  ws.columns = [
    { header: "Order ID", key: "order_id", width: 14 },
    { header: "Vendor", key: "vendor", width: 26 },
    { header: "Course", key: "course", width: 46 },
    { header: "Status", key: "status", width: 11 },
    { header: "Base", key: "base", width: 12 },
    { header: "Base source", key: "base_source", width: 14 },
    { header: "%", key: "pct", width: 8 },
    { header: "Rate source", key: "rate_source", width: 13 },
    { header: "Calculated", key: "calculated", width: 13 },
    { header: "Paid", key: "paid", width: 13 },
    { header: "Diff", key: "diff", width: 12 },
    { header: "Method", key: "methods", width: 18 },
    { header: "Paid on", key: "paid_on", width: 12 },
    { header: "Result", key: "result", width: 16 },
    { header: "Implied price", key: "implied", width: 14 },
    { header: "Reviewed", key: "reviewed", width: 10 },
    { header: "Review note", key: "review_note", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of filtered) {
    ws.addRow({
      order_id: r.order_id,
      vendor: r.vendor_name ?? "",
      course: r.course_head ?? "",
      status: r.status ?? "",
      base: r.base_amount ?? null,
      base_source: r.base_source ?? "",
      pct: r.rate_pct ?? null,
      rate_source: r.rate_source ?? "",
      calculated: r.calculated,
      paid: r.paid,
      diff: r.diff,
      methods: r.methods.join(", "),
      paid_on: r.paid_on ?? "",
      result: RESULT_LABELS[r.result as ReconResult],
      implied: r.implied_price ?? null,
      reviewed: r.reviewed ? "yes" : "",
      review_note: r.review_note ?? "",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const name = `reconcile-${month}${vendor ? `-${vendor.replace(/[^a-z0-9]+/gi, "-")}` : ""}${result ? `-${result}` : ""}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
