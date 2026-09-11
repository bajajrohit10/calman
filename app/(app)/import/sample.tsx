"use client";

import { useState, useTransition } from "react";

import { Button, ErrorNote } from "@/components/ui";
import { IMPORTANCE_LABELS } from "@/lib/enquiry-labels";

import type { ImportMasters } from "./importer";

/**
 * The columns the sample ships with, in this order.
 *
 * This is also the header set the mapping screen recognises by name, so a file
 * built from the sample arrives fully mapped. Lead verification is deliberately
 * absent: it is the one field nobody has in a lead sheet, and a column of
 * blanks in the sample would invite people to invent values for it.
 */
export const SAMPLE_HEADERS = [
  "Mobile",
  "Name",
  "Source",
  "Product text",
  "Term",
  "Importance",
] as const;

const EXAMPLE_ROW = [
  "9876543210",
  "Example Student",
  "", // filled from the first live source below
  "DT Full Course by Bhanwar Borana",
  "", // filled from the first live term below
  "B",
];

/**
 * Download a starter workbook (§5.7).
 *
 * People were building their own sheets and then spending the mapping screen
 * guessing which of their columns was which. The sample answers that before
 * the upload rather than after it, and the second sheet answers the question
 * the mapping screen cannot: not "which column is Source" but "what may the
 * Source column say".
 *
 * Built in the browser from the master lists the page already holds, like the
 * exports — so the valid values are whatever Settings says today, not whatever
 * they were when somebody last wrote a template.
 */
export function SampleFileButton({ masters }: { masters: ImportMasters }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      try {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        wb.creator = "Calman";
        wb.created = new Date();

        /* ---------------------------- sheet 1 ---------------------------- */
        // First sheet, because the importer reads worksheets[0].
        const leads = wb.addWorksheet("Leads");
        leads.addRow([...SAMPLE_HEADERS]);
        const example = [...EXAMPLE_ROW];
        example[2] = masters.sources[0]?.name ?? "";
        example[4] = masters.terms[0]?.name ?? "";
        leads.addRow(example);

        leads.getRow(1).font = { bold: true };
        leads.columns = [
          { width: 14 },
          { width: 22 },
          { width: 18 },
          { width: 38 },
          { width: 12 },
          { width: 12 },
        ];
        // Numbers are text: a 10-digit mobile in a numeric cell loses its
        // leading digit group to scientific notation the moment Excel widens it.
        leads.getColumn(1).numFmt = "@";

        /* ---------------------------- sheet 2 ---------------------------- */
        const help = wb.addWorksheet("Instructions");
        const section = (title: string) => {
          const row = help.addRow([title]);
          row.font = { bold: true };
          return row;
        };
        const blank = () => help.addRow([]);

        section("How to use this file");
        help.addRow(["Put one lead per row on the Leads sheet, then upload it on Import."]);
        help.addRow(["Delete the example row before uploading."]);
        help.addRow([
          "Column order does not matter — the mapping screen matches by heading, " +
            "and these headings are recognised automatically.",
        ]);
        blank();

        section("Columns");
        const colHead = help.addRow(["Column", "Required", "What it holds"]);
        colHead.font = { bold: true };
        help.addRow(["Mobile", "Yes", "The only required column. 10 digits; +91, spaces and dashes are stripped."]);
        help.addRow(["Name", "No", "The student's name, if you have it."]);
        help.addRow(["Source", "No", "Where the lead came from. Must be one of the names listed below."]);
        help.addRow(["Product text", "No", "The product as the lead described it. Free text — anything goes."]);
        help.addRow(["Term", "No", "The attempt they are sitting. Must be one of the labels listed below."]);
        help.addRow(["Importance", "No", "A, B, C or D. See below."]);
        help.addRow([
          "",
          "",
          "A row whose Source or Term does not match is imported with that field " +
            "blank, and the review screen lists it as unmatched before anything is written.",
        ]);
        blank();

        section(`Valid Source names (${masters.sources.length})`);
        if (masters.sources.length) {
          for (const s of masters.sources) help.addRow([s.name]);
        } else {
          help.addRow(["No active sources — ask an admin to add them in Settings."]);
        }
        blank();

        section(`Valid Term labels (${masters.terms.length})`);
        if (masters.terms.length) {
          for (const t of masters.terms) help.addRow([t.name]);
        } else {
          help.addRow(["No active terms — ask an admin to add them in Settings."]);
        }
        blank();

        section("Importance codes");
        const impHead = help.addRow(["Code", "Meaning"]);
        impHead.font = { bold: true };
        for (const [code, label] of Object.entries(IMPORTANCE_LABELS)) {
          // The stored labels carry the code already ("A — Yes + PLI"); the
          // sheet has a column for it, so strip the prefix rather than repeat it.
          help.addRow([code.toUpperCase(), label.replace(/^[A-D]\s*—\s*/i, "")]);
        }

        help.columns = [{ width: 22 }, { width: 12 }, { width: 78 }];

        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "calman-import-sample.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoked on the next tick: Safari needs the URL to survive the click.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" disabled={pending} onClick={run}>
        {pending ? "Building…" : "Download sample file"}
      </Button>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </>
  );
}
