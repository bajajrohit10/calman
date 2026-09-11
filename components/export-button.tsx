"use client";

import { useState, useTransition } from "react";

import { Button, ErrorNote, Select } from "@/components/ui";
import { exportCurrentView } from "@/lib/export-actions";

type Source =
  | { source: "enquiries" }
  | { source: "desk" }
  | { source: "myday"; date: string; counsellorId: string | null }
  | { source: "report"; from: string; to: string; counsellorId: string | null }
  | { source: "stage"; from: string; to: string; counsellorId: string | null };

/**
 * Builds the file in the browser.
 *
 * The server hands back rows; the sheet is assembled here. That keeps a
 * multi-megabyte spreadsheet out of the serverless response, and papaparse and
 * exceljs load only when someone actually clicks Export — they are a few
 * hundred kilobytes that no other screen should pay for.
 */
export function ExportButton(props: Source & { className?: string }) {
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick: Safari needs the URL to survive the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function run() {
    setError(null);
    start(async () => {
      const payload =
        props.source === "myday"
          ? { source: "myday" as const, date: props.date, counsellorId: props.counsellorId }
          : props.source === "report" || props.source === "stage"
            ? {
                source: props.source,
                from: props.from,
                to: props.to,
                counsellorId: props.counsellorId,
              }
            : props.source === "desk"
              ? { source: "desk" as const, search: window.location.search }
              : { source: "enquiries" as const, search: window.location.search };

      const res = await exportCurrentView(payload);
      if (res.error || !res.rows || !res.columns) {
        setError(res.error ?? "Could not build the export.");
        return;
      }

      const header = res.columns.map((c) => c.label);
      const body = res.rows.map((row) =>
        res.columns!.map((c) => {
          const v = (row as Record<string, unknown>)[c.key];
          return v === null || v === undefined ? "" : String(v);
        }),
      );

      if (format === "csv") {
        const Papa = (await import("papaparse")).default;
        const csv = Papa.unparse([header, ...body]);
        // BOM so Excel opens UTF-8 names (and ₹) correctly rather than as mojibake.
        download(
          new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" }),
          `${res.filename}.csv`,
        );
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Enquiries");
        ws.addRow(header);
        ws.getRow(1).font = { bold: true };
        for (const r of body) ws.addRow(r);
        ws.columns.forEach((col, i) => {
          col.width = Math.min(40, Math.max(12, header[i].length + 4));
        });
        const buffer = await wb.xlsx.writeBuffer();
        download(
          new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          `${res.filename}.xlsx`,
        );
      }
    });
  }

  return (
    <div className={props.className}>
      <div className="flex items-center gap-1.5">
        <Select
          aria-label="Export format"
          className="w-[86px]"
          value={format}
          onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}
        >
          <option value="csv">CSV</option>
          <option value="xlsx">XLSX</option>
        </Select>
        {/* Explicitly type="button": this sits inside the filter <form> on both
            the desk and the Enquiries table, and would otherwise submit it. */}
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={run}>
          {pending ? "Preparing…" : "Export"}
        </Button>
      </div>
      {error ? (
        <div className="mt-1.5">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </div>
  );
}
