"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { Badge, Button, ErrorNote, Select, cx } from "@/components/ui";
import type { Importance, LeadVerification } from "@/lib/enquiry-labels";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";

import {
  commitChunk,
  createBatch,
  loadMapping,
  lookupNumbers,
  saveMapping,
  type CommitCounts,
  type CommitRow,
  type NumberStatus,
  type RowDecision,
} from "./actions";

type Master = { id: string; name: string };

export type ImportMasters = { sources: Master[]; terms: Master[] };

/** Our fields, in the order the mapping screen lists them. Only mobile matters. */
const FIELDS = [
  { key: "mobile", label: "Mobile number", required: true },
  { key: "name", label: "Name", required: false },
  { key: "source", label: "Source", required: false },
  { key: "product_text", label: "Product text", required: false },
  { key: "term", label: "Term", required: false },
  { key: "importance", label: "Importance", required: false },
  { key: "lead_verification", label: "Lead verification", required: false },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

type ParsedRow = { rowNumber: number; raw: Record<string, string> };

type ReviewRow = {
  rowNumber: number;
  raw: Record<string, string>;
  mobile: string | null;
  invalidReason: string | null;
  duplicateOf: number | null;
  status: NumberStatus | null;
  decision: RowDecision;
  name: string | null;
  sourceId: string | null;
  productText: string | null;
  termId: string | null;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  /**
   * Values the file supplied that matched nothing. Silently dropping these is
   * the failure that hides: a file naming a retired term imports every row
   * with no term and nobody notices until the reports look wrong.
   */
  unmatched: { field: string; value: string }[];
};

type Stage = "upload" | "mapping" | "review" | "committing" | "done";

const CHUNK = 200;
const LOOKUP_CHUNK = 500;

/** Loose matching, because a file says "CA Final" where we store an id. */
function matchMaster(list: Master[], value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  return list.find((m) => m.name.trim().toLowerCase() === v)?.id ?? null;
}

/**
 * Resolve a value and report it when it does not land. An empty cell is not a
 * problem — the field is optional; a *populated* cell that matches nothing is,
 * because the row will import as though the column had been blank.
 */
function resolve<T>(
  field: string,
  raw: string | undefined,
  parse: (v: string) => T | null,
): { value: T | null; unmatched: { field: string; value: string } | null } {
  const v = (raw ?? "").trim();
  if (!v) return { value: null, unmatched: null };
  const value = parse(v);
  return { value, unmatched: value === null ? { field, value: v } : null };
}

function parseImportance(value: string | undefined): Importance | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const first = v[0];
  if (["a", "b", "c", "d"].includes(first)) return first as Importance;
  return null;
}

function parseLeadVerification(value: string | undefined): LeadVerification | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("with proof") || v === "yes_with_proof") return "yes_with_proof";
  if (v.includes("without proof") || v === "yes_without_proof") return "yes_without_proof";
  if (v.startsWith("n")) return "no";
  if (v.startsWith("y")) return "yes_without_proof";
  return null;
}

export function Importer({ masters }: { masters: ImportMasters }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string | null>>({
    mobile: null,
    name: null,
    source: null,
    product_text: null,
    term: null,
    importance: null,
    lead_verification: null,
  });
  const [rememberedMapping, setRememberedMapping] = useState(false);
  const [review, setReview] = useState<ReviewRow[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [counts, setCounts] = useState<CommitCounts | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ----------------------------- 1. parse ------------------------------- */

  async function onFile(file: File) {
    setError(null);
    setBusy("Reading the file…");
    setFilename(file.name);
    try {
      let rows: Record<string, string>[] = [];
      let cols: string[] = [];

      if (/\.csv$/i.test(file.name)) {
        const Papa = (await import("papaparse")).default;
        const text = await file.text();
        const out = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
        });
        rows = out.data;
        cols = out.meta.fields ?? [];
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.worksheets[0];
        if (!ws) throw new Error("That workbook has no sheets.");
        const headerRow = ws.getRow(1);
        cols = (headerRow.values as unknown[])
          .slice(1)
          .map((v) => String(v ?? "").trim());
        ws.eachRow((row, i) => {
          if (i === 1) return;
          const values = (row.values as unknown[]).slice(1);
          const obj: Record<string, string> = {};
          cols.forEach((c, idx) => {
            const v = values[idx];
            obj[c] =
              v && typeof v === "object" && "text" in (v as object)
                ? String((v as { text: unknown }).text ?? "")
                : String(v ?? "");
          });
          rows.push(obj);
        });
      }

      cols = cols.filter(Boolean);
      if (!cols.length) throw new Error("No header row found.");

      setHeaders(cols);
      setParsed(rows.map((raw, i) => ({ rowNumber: i + 2, raw })));

      // Guess by name, then let a remembered mapping override the guess.
      const guess = { ...mapping };
      for (const f of FIELDS) {
        const hit = cols.find((c) => {
          const n = c.toLowerCase();
          if (f.key === "mobile") return /mobile|phone|number|contact/.test(n);
          if (f.key === "product_text") return /product|item|course name|title/.test(n);
          if (f.key === "lead_verification") return /verif|proof/.test(n);
          return n.includes(f.key.replace("_", " ")) || n === f.key;
        });
        guess[f.key] = hit ?? null;
      }
      const remembered = await loadMapping(cols);
      if (remembered.mapping) {
        for (const f of FIELDS) {
          const v = remembered.mapping[f.key];
          if (v && cols.includes(v)) guess[f.key] = v;
        }
        setRememberedMapping(true);
      }
      setMapping(guess);
      setStage("mapping");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /* --------------------- 2. normalise, dedupe, look up ------------------ */

  async function buildReview() {
    setError(null);
    const mobileCol = mapping.mobile;
    if (!mobileCol) {
      setError("Map a column to the mobile number — it is the only required field.");
      return;
    }

    setBusy("Checking numbers against Calman…");
    try {
      const seen = new Map<string, number>();
      const draft: ReviewRow[] = parsed.map((p) => {
        const cell = (col: string | null) => (col ? p.raw[col] : undefined);
        const source = resolve("source", cell(mapping.source), (v) =>
          matchMaster(masters.sources, v),
        );
        const term = resolve("term", cell(mapping.term), (v) =>
          matchMaster(masters.terms, v),
        );
        const importance = resolve("importance", cell(mapping.importance), parseImportance);
        const lead = resolve(
          "lead verification",
          cell(mapping.lead_verification),
          parseLeadVerification,
        );

        const rawMobile = p.raw[mobileCol] ?? "";
        const mobile = normaliseMobile(rawMobile);
        const valid = isValidMobile(mobile);
        const dup = valid ? seen.get(mobile) : undefined;
        if (valid && dup === undefined) seen.set(mobile, p.rowNumber);

        return {
          rowNumber: p.rowNumber,
          raw: p.raw,
          mobile: valid ? mobile : null,
          invalidReason: valid
            ? null
            : rawMobile.trim() === ""
              ? "No number in this row"
              : `Not a valid Indian mobile number: "${rawMobile.trim()}"`,
          duplicateOf: dup ?? null,
          status: null,
          decision: "skip",
          name: mapping.name ? (p.raw[mapping.name] ?? "").trim() || null : null,
          sourceId: source.value,
          productText: mapping.product_text
            ? (p.raw[mapping.product_text] ?? "").trim() || null
            : null,
          termId: term.value,
          importance: importance.value,
          leadVerification: lead.value,
          unmatched: [source, term, importance, lead]
            .map((r) => r.unmatched)
            .filter((u): u is { field: string; value: string } => u !== null),
        };
      });

      const unique = [...seen.keys()];
      const statuses = new Map<string, NumberStatus>();
      for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
        const slice = unique.slice(i, i + LOOKUP_CHUNK);
        const res = await lookupNumbers(slice);
        if (res.error) throw new Error(res.error);
        for (const s of res.statuses ?? []) statuses.set(s.mobile, s);
        setBusy(`Checking numbers against Calman… ${Math.min(i + LOOKUP_CHUNK, unique.length)}/${unique.length}`);
      }

      for (const row of draft) {
        if (!row.mobile) {
          row.decision = "skip";
          continue;
        }
        if (row.duplicateOf !== null) {
          row.decision = "skip";
          row.invalidReason = `Duplicate of row ${row.duplicateOf} in this file`;
          continue;
        }
        row.status = statuses.get(row.mobile) ?? null;
        row.decision =
          row.status?.state === "open"
            ? "update"
            : row.status?.state === "wrong_number"
              ? "ignore"
              : "import";
      }

      setReview(draft);
      setStage("review");
      if (mapping.mobile) await saveMapping(headers, mapping);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /* ----------------------------- 3. commit ------------------------------ */

  async function commit() {
    setError(null);
    setStage("committing");
    const actionable = review;
    setProgress({ done: 0, total: actionable.length });

    try {
      const batch = await createBatch(filename, parsed.length);
      if (batch.error || !batch.batchId) throw new Error(batch.error ?? "Could not start the batch.");
      setBatchId(batch.batchId);

      const totals: CommitCounts = {
        imported: 0,
        duplicate_updated: 0,
        duplicate_new_enquiry: 0,
        skipped: 0,
      };

      for (let i = 0; i < actionable.length; i += CHUNK) {
        const slice: CommitRow[] = actionable.slice(i, i + CHUNK).map((r) => ({
          rowNumber: r.rowNumber,
          raw: r.raw,
          mobile: r.mobile,
          decision: r.decision,
          skipReason: r.invalidReason,
          name: r.name,
          sourceId: r.sourceId,
          productText: r.productText,
          termId: r.termId,
          importance: r.importance,
          leadVerification: r.leadVerification,
          existingStudentId: r.status?.studentId ?? null,
          existingEnquiryId: r.status?.openEnquiryId ?? null,
        }));

        const res = await commitChunk(batch.batchId, slice);
        if (res.error) throw new Error(res.error);
        for (const k of Object.keys(totals) as (keyof CommitCounts)[]) {
          totals[k] += res.counts?.[k] ?? 0;
        }
        setProgress({ done: Math.min(i + CHUNK, actionable.length), total: actionable.length });
      }

      setCounts(totals);
      setStage("done");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setStage("review");
    }
  }

  /* ------------------------------ grouping ------------------------------ */

  const groups = useMemo(() => {
    const g = {
      invalid: [] as ReviewRow[],
      duplicate: [] as ReviewRow[],
      new: [] as ReviewRow[],
      open: [] as ReviewRow[],
      wrong_number: [] as ReviewRow[],
      resolved: [] as ReviewRow[],
    };
    for (const r of review) {
      if (!r.mobile) g.invalid.push(r);
      else if (r.duplicateOf !== null) g.duplicate.push(r);
      else if (r.status?.state === "open") g.open.push(r);
      else if (r.status?.state === "wrong_number") g.wrong_number.push(r);
      else if (r.status?.state === "resolved") g.resolved.push(r);
      else g.new.push(r);
    }
    return g;
  }, [review]);

  /** §5.7: an unrecognised value must not slip past unremarked. */
  const unmatchedSummary = useMemo(() => {
    const rows = review.filter((r) => r.unmatched.length > 0);
    const fields = new Map<string, number>();
    for (const r of rows) {
      for (const u of r.unmatched) fields.set(u.field, (fields.get(u.field) ?? 0) + 1);
    }
    return {
      rows: rows.length,
      fields: [...fields].map(([f, n]) => `${f} ×${n}`),
    };
  }, [review]);

  function setDecisionFor(rowNumbers: Set<number>, decision: RowDecision) {
    setReview((rows) =>
      rows.map((r) => (rowNumbers.has(r.rowNumber) ? { ...r, decision } : r)),
    );
  }

  /* ------------------------------- render ------------------------------- */

  if (stage === "done") {
    return (
      <div className="rounded-lg border border-ok/40 bg-ok-soft/30 px-4 py-4">
        <h2 className="text-[14px] font-semibold text-ink">Import finished</h2>
        <ul className="mt-2 text-[13px] text-ink-2">
          <li>New enquiries: {counts?.imported ?? 0}</li>
          <li>Existing enquiries updated: {counts?.duplicate_updated ?? 0}</li>
          <li>Replaced (previous closed as superseded): {counts?.duplicate_new_enquiry ?? 0}</li>
          <li>Skipped: {counts?.skipped ?? 0}</li>
        </ul>
        <div className="mt-3 flex gap-2">
          {batchId ? (
            <Link href={`/import/${batchId}`}>
              <Button size="sm" variant="primary">
                Open the import report
              </Button>
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStage("upload");
              setReview([]);
              setParsed([]);
              setCounts(null);
              setBatchId(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
          >
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {busy ? <p className="text-[12.5px] text-ink-2">{busy}</p> : null}

      {stage === "upload" ? (
        <div className="rounded-lg border border-dashed border-line-2 bg-surface px-5 py-8">
          <h2 className="text-[14px] font-semibold text-ink">Choose a file</h2>
          <p className="mt-1 text-[12.5px] text-ink-2">
            CSV or XLSX. The file is read in your browser — only the numbers are sent
            for checking, so a large sheet is no slower to start.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx"
            className="mt-3 text-[13px]"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </div>
      ) : null}

      {stage === "mapping" ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-ink">Map the columns</h2>
            <Badge tone="neutral">{parsed.length} rows</Badge>
            <Badge tone="neutral">{filename}</Badge>
            {rememberedMapping ? (
              <Badge tone="ok">Remembered from last time</Badge>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  {f.label}
                  {f.required ? " *" : ""}
                </span>
                <Select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))
                  }
                >
                  <option value="">— not in this file —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" disabled={!!busy} onClick={buildReview}>
              Check against Calman
            </Button>
            <Button variant="ghost" onClick={() => setStage("upload")}>
              Back
            </Button>
            <span className="text-[11.5px] text-ink-3">
              This mapping is remembered for files with these headers.
            </span>
          </div>
        </div>
      ) : null}

      {stage === "committing" ? (
        <div className="rounded-lg border border-line bg-surface px-4 py-4">
          <p className="text-[13px] text-ink">
            Importing… {progress.done} of {progress.total}
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-sunk">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="mt-2 text-[11.5px] text-ink-3">
            Sent in batches of {CHUNK}. If this is interrupted, re-running the same file
            resumes rather than duplicating.
          </p>
        </div>
      ) : null}

      {stage === "review" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">Review</h2>
            <span className="text-[12.5px] text-ink-2">
              {review.length} rows from {filename}
            </span>
            {unmatchedSummary.rows > 0 ? (
              <span className="flex items-center gap-1.5 rounded-md border border-warn/40 bg-warn-soft/50 px-2 py-1 text-[12px] text-warn">
                <strong>{unmatchedSummary.rows}</strong>
                {unmatchedSummary.rows === 1 ? " row has" : " rows have"} a value that
                matches no master list ({unmatchedSummary.fields.join(", ")}). Those
                fields will import blank.
              </span>
            ) : null}
            <Button
              className="ml-auto"
              variant="primary"
              onClick={commit}
              disabled={!!busy}
            >
              Commit the import
            </Button>
            <Button variant="ghost" onClick={() => setStage("mapping")}>
              Back to mapping
            </Button>
          </div>

          <Group
            title="New numbers"
            tone="ok"
            rows={groups.new}
            options={["import", "ignore"]}
            onBulk={setDecisionFor}
            onSet={setDecisionFor}
          />
          <Group
            title="Existing — open enquiry"
            tone="info"
            rows={groups.open}
            options={["update", "supersede", "ignore"]}
            onBulk={setDecisionFor}
            onSet={setDecisionFor}
          />
          <Group
            title="Existing — nothing open"
            tone="neutral"
            rows={groups.resolved}
            options={["import", "ignore"]}
            onBulk={setDecisionFor}
            onSet={setDecisionFor}
          />
          <Group
            title="Flagged — previously a wrong number"
            tone="danger"
            rows={groups.wrong_number}
            options={["import", "ignore"]}
            onBulk={setDecisionFor}
            onSet={setDecisionFor}
          />
          <Group
            title="Duplicates within this file"
            tone="warn"
            rows={groups.duplicate}
            options={[]}
            onBulk={setDecisionFor}
            onSet={setDecisionFor}
          />
          <Group
            title="Invalid numbers"
            tone="warn"
            rows={groups.invalid}
            options={[]}
            onBulk={setDecisionFor}
            onSet={setDecisionFor}
          />
        </div>
      ) : null}
    </div>
  );
}

const DECISION_LABELS: Record<RowDecision, string> = {
  import: "Import",
  update: "Update existing",
  supersede: "New enquiry (close old)",
  ignore: "Ignore",
  skip: "Skip",
};

function Group({
  title,
  tone,
  rows,
  options,
  onBulk,
  onSet,
}: {
  title: string;
  tone: "ok" | "info" | "danger" | "warn" | "neutral";
  rows: ReviewRow[];
  options: RowDecision[];
  onBulk: (rowNumbers: Set<number>, d: RowDecision) => void;
  onSet: (rowNumbers: Set<number>, d: RowDecision) => void;
}) {
  if (!rows.length) return null;
  const all = new Set(rows.map((r) => r.rowNumber));

  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Badge tone={tone}>{rows.length}</Badge>
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {options.length ? (
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-3">
            Apply to all:
            {options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onBulk(all, o)}
                className="rounded border border-line-2 bg-surface-2 px-1.5 py-0.5 text-ink-2 hover:text-ink"
              >
                {DECISION_LABELS[o]}
              </button>
            ))}
          </span>
        ) : null}
      </header>

      <div className="max-h-[320px] overflow-y-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNumber} className="border-b border-line last:border-b-0">
                <td className="w-12 px-3 py-1.5 tabular-nums text-ink-3">{r.rowNumber}</td>
                <td className="px-2 py-1.5 tabular-nums text-ink">
                  {r.mobile ?? "—"}
                  {r.status?.studentName ? (
                    <span className="ml-2 text-ink-3">{r.status.studentName}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-ink-3">
                  <span className="block">
                    {r.invalidReason ??
                      (r.status
                        ? `${r.status.enquiryCount} enquir${r.status.enquiryCount === 1 ? "y" : "ies"} on file`
                        : "not seen before")}
                  </span>
                  {r.unmatched.length ? (
                    <span className="mt-0.5 block text-[11.5px] text-warn">
                      not recognised:{" "}
                      {r.unmatched.map((u) => `${u.field} “${u.value}”`).join(", ")}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  {r.mobile && r.status?.studentId ? (
                    <Link
                      href={`/students/${r.mobile}`}
                      target="_blank"
                      className="text-ink-2 underline underline-offset-2 hover:text-ink"
                    >
                      history
                    </Link>
                  ) : null}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {options.length ? (
                    <Select
                      aria-label={`Decision for row ${r.rowNumber}`}
                      className={cx("w-[200px]")}
                      value={r.decision}
                      onChange={(e) =>
                        onSet(new Set([r.rowNumber]), e.target.value as RowDecision)
                      }
                    >
                      {options.map((o) => (
                        <option key={o} value={o}>
                          {DECISION_LABELS[o]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-[11.5px] text-ink-3">skipped</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
