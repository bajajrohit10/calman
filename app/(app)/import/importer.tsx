"use client";

import { parseArrivedAt } from "@/lib/arrived-at";
import {
  looksLikeShopify,
  planShopifyImport,
  type Candidate,
  type ShopifyPlan,
} from "@/lib/shopify-checkouts";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { Badge, Button, ErrorNote, Select, cx } from "@/components/ui";
import {
  CASE_TITLES,
  caseOf,
  describeNumber,
} from "@/lib/duplicate-rules";
import type { Importance, LeadVerification } from "@/lib/enquiry-labels";

import { isValidMobile, normaliseMobile } from "@/lib/mobile";

import {
  commitChunk,
  createBatch,
  holdCheckouts,
  loadMapping,
  lookupNumbers,
  saveMapping,
  seenCheckoutRefs,
  type CommitCounts,
  type CommitRow,
  type NumberStatus,
  type RowDecision,
} from "./actions";
import { ConfirmDismiss } from "../quick-add/grid";
import { SAMPLE_HEADERS, SampleFileButton } from "./sample";

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
  // §48.2. Optional, and when absent the enquiry keeps arrived_at null and
  // falls back to created_at — which is the honest reading of a file that
  // never said when its leads came in.
  { key: "arrived_at", label: "Arrived / Created time", required: false },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

/** The field each SAMPLE_HEADERS entry maps to, by position. */
const SAMPLE_FIELD_ORDER: FieldKey[] = [
  "mobile",
  "name",
  "source",
  "product_text",
  "term",
  "importance",
];

type ParsedRow = { rowNumber: number; raw: Record<string, string> };

type ReviewRow = {
  rowNumber: number;
  raw: Record<string, string>;
  mobile: string | null;
  /** §55.2(c): the Shopify checkouts behind this row; empty on other files. */
  checkoutRefs?: string[];
  /** §55.2(a): "alt number 98…". */
  remarks?: string[];
  /** §55.2(d): the file's Vendor. */
  vendorHint?: string | null;
  invalidReason: string | null;
  duplicateOf: number | null;
  status: NumberStatus | null;
  decision: RowDecision;
  /**
   * Brief 31 case 5: somebody called this number today, and no rule can decide
   * what to do about that. The row carries a decision so the commit path has
   * something to act on, but it does not count as chosen until a person
   * chooses it, and nothing commits while any row is still waiting.
   */
  needsDecision: boolean;
  name: string | null;
  sourceId: string | null;
  productText: string | null;
  /** §48.2: parsed from the mapped column, null when absent or unreadable. */
  arrivedAt: string | null;
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
    arrived_at: null,
    term: null,
    importance: null,
    lead_verification: null,
  });
  const [rememberedMapping, setRememberedMapping] = useState(false);
  /**
   * §55.2. The Shopify plan, when the file is one.
   *
   * Held rather than recomputed: the review table is built from its
   * candidates, the preview counts come off it, and the held rows are written
   * at commit time — three readers of one grouping, which has to be the same
   * grouping in all three.
   */
  const [shopify, setShopify] = useState<ShopifyPlan | null>(null);
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
      const parsedRows = rows.map((raw, i) => ({ rowNumber: i + 2, raw }));
      setParsed(parsedRows);

      /**
       * §55.2. A Shopify abandoned-checkout export is not a list of people.
       *
       * It is a list of line items, which group into checkouts, which group
       * into people — and only the third of those is a lead. So it gets its
       * own pre-step, and the mapping stage is skipped entirely: there is
       * nothing to map, because the columns are known and the phone is three
       * of them tried in order.
       */
      if (looksLikeShopify(cols)) {
        setBusy("Grouping checkouts…");
        const refs = [
          ...new Set(
            parsedRows.map((r) =>
              (r.raw["Id"] ?? "").trim() ||
              (r.raw["Name"] ?? "").trim().replace(/^#/, "") ||
              `row-${r.rowNumber}`,
            ),
          ),
        ];
        const seen = await seenCheckoutRefs(refs);
        if (seen.error) throw new Error(seen.error);
        const plan = planShopifyImport(parsedRows, new Set(seen.seen ?? []));
        setShopify(plan);
        await buildShopifyReview(plan);
        return;
      }

      // Guess by name, then let a remembered mapping override the guess.
      //
      // The sample file's own headings are matched first and exactly. The
      // loose patterns below are what make a stranger's spreadsheet mostly
      // work, but "loose" cuts both ways — a sheet with both "Name" and
      // "Product name" is one `find` order away from mapping the wrong one —
      // and a file built from our own sample should never be at their mercy.
      const guess = { ...mapping };
      const exact = new Map<string, FieldKey>(
        SAMPLE_HEADERS.map((h, i) => [h.toLowerCase(), SAMPLE_FIELD_ORDER[i]]),
      );
      const claimed = new Set<string>();
      for (const c of cols) {
        const key = exact.get(c.trim().toLowerCase());
        if (key && !guess[key]) {
          guess[key] = c;
          claimed.add(c);
        }
      }

      for (const f of FIELDS) {
        if (guess[f.key]) continue;
        const hit = cols.find((c) => {
          if (claimed.has(c)) return false;
          const n = c.toLowerCase();
          if (f.key === "mobile") return /mobile|phone|number|contact/.test(n);
          if (f.key === "product_text") return /product|item|course name|title/.test(n);
          if (f.key === "lead_verification") return /verif|proof/.test(n);
          // Shopify calls it "Created at"; hand-kept sheets say "Date" or
          // "Arrived". "paid at"/"updated at" are deliberately not matched:
          // they are different instants and guessing one for the other would
          // be worse than leaving the column unmapped.
          if (f.key === "arrived_at")
            return /arriv|created at|created_at|entry time|date ?\/? ?time|^date$|timestamp/.test(n);
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

  /**
   * The five-case lookup, in chunks. Shared by both paths (§55.2): the Shopify
   * candidates go through exactly the rules a hand-kept spreadsheet does, and
   * a second copy of this switch is how the two would come to disagree.
   */
  async function lookupInChunks(mobiles: string[]) {
    const unique = [...new Set(mobiles.filter(Boolean))];
    const statuses = new Map<string, NumberStatus>();
    for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
      const slice = unique.slice(i, i + LOOKUP_CHUNK);
      const res = await lookupNumbers(slice);
      if (res.error) throw new Error(res.error);
      for (const s of res.statuses ?? []) statuses.set(s.mobile, s);
      setBusy(
        `Checking numbers against Calman… ${Math.min(i + LOOKUP_CHUNK, unique.length)}/${unique.length}`,
      );
    }
    return statuses;
  }

  /** §10.1's defaults. The review table still lets the user override any. */
  function applyStatus(row: ReviewRow, statuses: Map<string, NumberStatus>) {
    row.status = row.mobile ? (statuses.get(row.mobile) ?? null) : null;
    switch (row.status?.state) {
      // (b) open, never called: keep it, take the new source.
      case "open_uncalled":
      // (c) open, last called on an earlier day: same, and back to New Calls.
      //     Which of the two happens is decided by returnToNewCalls at commit
      //     time, from the state — not from the decision.
      case "open_called_earlier":
        row.decision = "re_enquire";
        break;
      // (d) already called today: no default at all (Brief 31). Dismiss loses
      //     a lead; adding it back sends a colleague to ring somebody who was
      //     rung an hour ago. A person decides.
      case "open_called_today":
        row.decision = "dismiss";
        row.needsDecision = true;
        break;
      // (a) a previous wrong number still imports.
      case "wrong_number":
        row.decision = "import";
        break;
      // (a) nothing open, or nothing at all.
      default:
        row.decision = "import";
    }
  }

  /* ------------------ 2a. Shopify: candidates -> review ------------------ */

  /**
   * §55.2. The candidates, looked up against Calman exactly like any other row.
   *
   * The in-file duplicate path is deliberately not reached here, and cannot
   * be: grouping has already made the mobiles distinct, so there is no second
   * row for a number to be "a duplicate of". Two carts by one person are one
   * candidate with both titles, not one row kept and one thrown away — which
   * is what the generic path still does, unchanged, for every other file.
   */
  async function buildShopifyReview(plan: ShopifyPlan) {
    setBusy("Checking numbers against Calman…");
    try {
      const acSource =
        masters.sources.find((s) => s.name.trim().toLowerCase() === "ac")?.id ?? null;

      const draft: ReviewRow[] = plan.candidates.map((c: Candidate, i) => ({
        rowNumber: i + 1,
        // What is stored on import_rows: the candidate as it was assembled,
        // which is the honest record of what was imported.
        raw: {
          Mobile: c.mobile,
          "Billing Name": c.name,
          Email: c.email,
          "Lineitem name": c.productText,
          "Created at": c.arrivedAtRaw,
          Vendor: c.vendorHint ?? "",
          "Checkout Id": c.refs.join(", "),
          ...(c.remarks.length ? { Remarks: c.remarks.join("; ") } : {}),
        },
        mobile: c.mobile,
        checkoutRefs: c.refs,
        remarks: c.remarks,
        vendorHint: c.vendorHint,
        invalidReason: null,
        duplicateOf: null,
        status: null,
        decision: "skip",
        needsDecision: false,
        name: c.name || null,
        sourceId: acSource,
        productText: c.productText || null,
        termId: null,
        importance: null,
        leadVerification: null,
        arrivedAt: parseArrivedAt(c.arrivedAtRaw),
        unmatched: [],
      }));

      const statuses = await lookupInChunks(draft.map((d) => d.mobile!));
      for (const row of draft) applyStatus(row, statuses);

      setReview(draft);
      setStage("review");
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
          needsDecision: false,
          name: mapping.name ? (p.raw[mapping.name] ?? "").trim() || null : null,
          sourceId: source.value,
          productText: mapping.product_text
            ? (p.raw[mapping.product_text] ?? "").trim() || null
            : null,
          termId: term.value,
          arrivedAt: mapping.arrived_at
            ? parseArrivedAt(p.raw[mapping.arrived_at])
            : null,
          importance: importance.value,
          leadVerification: lead.value,
          unmatched: [source, term, importance, lead]
            .map((r) => r.unmatched)
            .filter((u): u is { field: string; value: string } => u !== null),
        };
      });

      const statuses = await lookupInChunks([...seen.keys()]);

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
        applyStatus(row, statuses);
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

      // §55.3. The checkouts with no usable number are parked before anything
      // else is written, so a commit that fails halfway still leaves them
      // somewhere a person can find them.
      if (shopify?.held.length) {
        const held = await holdCheckouts(
          batch.batchId,
          shopify.held.map((h) => ({
            checkoutRef: h.ref,
            name: h.name,
            email: h.email,
            productText: h.productText,
            arrivedAt: parseArrivedAt(h.arrivedAtRaw),
            vendor: h.vendor,
            rawPhones: h.rawPhones,
          })),
        );
        if (held.error) throw new Error(held.error);
      }

      const totals: CommitCounts = {
        imported: 0,
        re_enquired: 0,
        duplicate_new_enquiry: 0,
        dismissed: 0,
        skipped: 0,
      };

      for (let i = 0; i < actionable.length; i += CHUNK) {
        const slice: CommitRow[] = actionable.slice(i, i + CHUNK).map((r) => ({
          rowNumber: r.rowNumber,
          raw: r.raw,
          mobile: r.mobile,
          decision: r.decision,
          // Rule (c) only: a lead that was never called has no follow-up date
          // to clear and is already in New Calls.
          // Any re-enquiry of a lead that has been called goes back in the
          // pool — rule (c), and rule (d) when the user overrides Dismiss with
          // "Add to New Calls anyway", which is what that option says it does.
          // Rule (b) is the exception: never called, so already in the pool and
          // there is nothing to return it from.
          returnToNewCalls: r.status?.state !== "open_uncalled",
          skipReason: r.invalidReason,
          name: r.name,
          sourceId: r.sourceId,
          productText: r.productText,
          arrivedAt: r.arrivedAt,
          termId: r.termId,
          importance: r.importance,
          leadVerification: r.leadVerification,
          existingStudentId: r.status?.studentId ?? null,
          existingEnquiryId: r.status?.openEnquiryId ?? null,
          checkoutRefs: r.checkoutRefs,
          remarks: r.remarks,
          vendorHint: r.vendorHint,
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

  /**
   * Brief 31: grouped by the five situations, and by nothing else. Won, lost
   * and "previously a wrong number" used to be three groups with three
   * headings; to somebody working a list they are one thing — a call that is
   * over — and the row's own sentence still says which.
   */
  const groups = useMemo(() => {
    const g = {
      invalid: [] as ReviewRow[],
      duplicate: [] as ReviewRow[],
      1: [] as ReviewRow[],
      2: [] as ReviewRow[],
      3: [] as ReviewRow[],
      4: [] as ReviewRow[],
      5: [] as ReviewRow[],
      // Import rows are always purchase-typed, so case 6 cannot arise here —
      // the key exists so the grouping is total rather than a cast.
      6: [] as ReviewRow[],
    };
    for (const r of review) {
      if (!r.mobile) g.invalid.push(r);
      else if (r.duplicateOf !== null) g.duplicate.push(r);
      else g[caseOf(r.status?.state ?? "new")].push(r);
    }
    return g;
  }, [review]);

  /** Case 5 rows nobody has answered yet. Nothing commits while any remain. */
  const undecided = useMemo(
    () => review.filter((r) => r.needsDecision),
    [review],
  );

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
      rows.map((r) =>
        // Choosing is what answers the question, whichever way it is answered.
        rowNumbers.has(r.rowNumber)
          ? { ...r, decision, needsDecision: false }
          : r,
      ),
    );
  }

  /* ------------------------------- render ------------------------------- */

  if (stage === "done") {
    return (
      <div className="rounded-lg border border-ok/40 bg-ok-soft/30 px-4 py-4">
        <h2 className="text-[14px] font-semibold text-ink">Import finished</h2>
        {/* Brief 31: the same five terms the review table used, so the
            finishing screen and the report read alike. */}
        <ul className="mt-2 text-[13px] text-ink-2">
          <li>New number / Closed call → new enquiry: {counts?.imported ?? 0}</li>
          <li>Already known → source updated: {counts?.re_enquired ?? 0}</li>
          <li>New enquiry, previous superseded: {counts?.duplicate_new_enquiry ?? 0}</li>
          <li>Call done today → dismissed: {counts?.dismissed ?? 0}</li>
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
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <SampleFileButton masters={masters} />
            <span className="text-[12px] text-ink-3">
              Starter workbook with the headings this screen recognises, and a
              second sheet listing the Source names, Term labels and Importance
              codes that are valid today.
            </span>
          </div>
        </div>
      ) : null}

      {stage === "mapping" ? (
        <div className="rounded-lg border border-line bg-surface shadow-card p-4">
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
                <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
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
        <div className="rounded-lg border border-line bg-surface shadow-card px-4 py-4">
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
          {/* §55.2. What the grouping did, before the five cases.
              A Shopify file arrives as line items and leaves as leads, and the
              three numbers between those two are the ones somebody checking
              the import actually wants: how many people, how many carts we had
              already seen, and how many nobody can ring. */}
          {shopify ? (
            <div
              data-testid="shopify-preview"
              className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-3"
            >
              <span className="text-[13px] font-semibold text-ink">
                Shopify abandoned checkouts
              </span>
              <Figure label="line items" value={parsed.length} />
              <Figure label="checkouts" value={shopify.checkoutCount} />
              <Figure label="candidates" value={shopify.candidates.length} testId="candidates" />
              <Figure
                label="already imported"
                value={shopify.skipped.length}
                testId="skipped"
              />
              <Figure
                label="no usable number"
                value={shopify.held.length}
                testId="held"
              />
              <span className="text-[11.5px] text-ink-2">
                Carts by one number are merged into one lead; the ones with no
                number go to the Missing number tab.
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface shadow-card px-4 py-3">
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
            {/* Brief 31: a case-5 row is a question, and the import does not
                proceed with a question outstanding. The count is beside the
                button rather than hidden in a tooltip, because a disabled
                button with no reason is the worst of both. */}
            {undecided.length ? (
              <span className="ml-auto rounded-md border border-warn/40 bg-warn-soft/50 px-2 py-1 text-[12px] font-medium text-warn">
                {undecided.length} row{undecided.length === 1 ? "" : "s"} need
                {undecided.length === 1 ? "s" : ""} a decision
              </span>
            ) : null}
            <Button
              className={undecided.length ? undefined : "ml-auto"}
              variant="primary"
              onClick={commit}
              disabled={!!busy || undecided.length > 0}
            >
              Commit the import
            </Button>
            <Button variant="ghost" onClick={() => setStage("mapping")}>
              Back to mapping
            </Button>
          </div>

          {/* Case 5 first, and on its own. It is the only block that has to
              be read: everything below it is already decided. */}
          <Group
            title={CASE_TITLES[5]}
            tone="warn"
            rows={groups[5]}
            options={["dismiss", "re_enquire"]}
            labels={{ re_enquire: "Add to New Calls anyway" }}
            confirmDismiss
            onSet={setDecisionFor}
          />
          <Group
            title={CASE_TITLES[1]}
            tone="ok"
            rows={groups[1]}
            options={["import", "ignore"]}
            onSet={setDecisionFor}
          />
          <Group
            title={CASE_TITLES[2]}
            tone="neutral"
            rows={groups[2]}
            options={["import", "ignore"]}
            onSet={setDecisionFor}
          />
          <Group
            title={CASE_TITLES[3]}
            tone="info"
            rows={groups[3]}
            options={["re_enquire", "supersede", "ignore"]}
            onSet={setDecisionFor}
          />
          <Group
            title={CASE_TITLES[4]}
            tone="info"
            rows={groups[4]}
            options={["re_enquire", "supersede", "ignore"]}
            onSet={setDecisionFor}
          />
          <Group
            title="Duplicates within this file"
            tone="warn"
            rows={groups.duplicate}
            options={[]}
            onSet={setDecisionFor}
          />
          <Group
            title="Invalid numbers"
            tone="warn"
            rows={groups.invalid}
            options={[]}
            onSet={setDecisionFor}
          />
        </div>
      ) : null}
    </div>
  );
}

const DECISION_LABELS: Record<RowDecision, string> = {
  import: "New enquiry",
  re_enquire: "Re-enquire",
  supersede: "New enquiry (close old)",
  dismiss: "Dismiss",
  ignore: "Ignore",
  skip: "Skip",
};

function Group({
  title,
  tone,
  rows,
  options,
  labels,
  confirmDismiss,
  onSet,
}: {
  title: string;
  tone: "ok" | "info" | "danger" | "warn" | "neutral";
  rows: ReviewRow[];
  options: RowDecision[];
  /** Per-group wording for a decision that reads differently here. */
  labels?: Partial<Record<RowDecision, string>>;
  /** Brief 31: throwing a lead away is asked twice, here as in Quick Add. */
  confirmDismiss?: boolean;
  /** One setter for both the per-row control and Apply to all. */
  onSet: (rowNumbers: Set<number>, d: RowDecision) => void;
}) {
  const [confirming, setConfirming] = useState<{
    rows: Set<number>;
    mobile: string;
  } | null>(null);

  if (!rows.length) return null;
  const all = new Set(rows.map((r) => r.rowNumber));

  /** Dismiss goes through the question; everything else goes straight. */
  const choose = (target: Set<number>, decision: RowDecision, mobile: string) => {
    if (confirmDismiss && decision === "dismiss") {
      setConfirming({ rows: target, mobile });
      return;
    }
    onSet(target, decision);
  };

  return (
    <section className="rounded-lg border border-line bg-surface shadow-card">
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
                onClick={() =>
                  choose(all, o, `${rows.length} number${rows.length === 1 ? "" : "s"}`)
                }
                className="rounded border border-line-2 bg-surface-2 px-1.5 py-0.5 text-ink-2 hover:text-ink"
              >
                {labels?.[o] ?? DECISION_LABELS[o]}
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
                <td className="w-12 px-3 py-[5px] tabular-nums text-ink-3">{r.rowNumber}</td>
                <td className="px-2 py-[5px] tabular-nums text-ink">
                  {r.mobile ?? "—"}
                  {r.status?.studentName ? (
                    <span className="ml-2 text-ink-3">{r.status.studentName}</span>
                  ) : null}
                </td>
                <td className="px-2 py-[5px] text-ink-3">
                  {/* Brief 31: the same sentence Quick Add shows for this
                      number, and under it what committing will do to it. The
                      select on the right can still override that; stating it
                      is what makes an override a decision rather than a
                      guess. */}
                  <span className="block text-ink-2">
                    {r.invalidReason ??
                      (r.status ? describeNumber(r.status).label : "New number")}
                  </span>
                  {r.status && !r.invalidReason ? (
                    <span className="mt-0.5 block text-[11.5px] text-ink-3">
                      {r.needsDecision
                        ? "Nothing until you choose"
                        : // Case 5 has no rule to fall back on — its own
                          // sentence says "nothing yet", which stops being
                          // true the moment somebody answers it. Everywhere
                          // else an untouched row shows the rule's own words,
                          // which say where this lead ends up rather than what
                          // the decision is called.
                          caseOf(r.status.state) !== 5 &&
                            r.decision === defaultDecisionFor(r.status.state)
                          ? describeNumber(r.status).action
                          : (ACTION_FOR[r.decision] ?? "")}
                    </span>
                  ) : null}
                  {r.unmatched.length ? (
                    <span className="mt-0.5 block text-[11.5px] text-warn">
                      not recognised:{" "}
                      {r.unmatched.map((u) => `${u.field} “${u.value}”`).join(", ")}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-[5px]">
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
                <td className="px-3 py-[5px] text-right">
                  {confirmDismiss ? (
                    // Two buttons, no default selected: a select with one
                    // option already showing is a decision somebody has to
                    // notice they did not make.
                    <span className="flex justify-end gap-1.5">
                      {options.map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() =>
                            choose(new Set([r.rowNumber]), o, r.mobile ?? "this number")
                          }
                          className={cx(
                            "rounded-full border px-2 py-[2px] text-[11px]",
                            !r.needsDecision && r.decision === o
                              ? "border-accent bg-accent-soft font-medium text-accent"
                              : "border-line-2 bg-surface text-ink-2 hover:border-ink-3",
                          )}
                        >
                          {labels?.[o] ?? DECISION_LABELS[o]}
                        </button>
                      ))}
                    </span>
                  ) : options.length ? (
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
                          {labels?.[o] ?? DECISION_LABELS[o]}
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

      {confirming ? (
        <ConfirmDismiss
          mobile={confirming.mobile}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            onSet(confirming.rows, "dismiss");
            setConfirming(null);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * What each decision will do, said in the row.
 *
 * The words are §10.1's, not the button's: "Re-enquire" names the mechanism,
 * and what the person wants to know is where the lead ends up.
 */
/** What the rules choose for a row, so an override can be told from a default. */
function defaultDecisionFor(state: NumberStatus["state"]): RowDecision {
  const which = caseOf(state);
  if (which === 3 || which === 4) return "re_enquire";
  if (which === 5) return "dismiss";
  return "import";
}

const ACTION_FOR: Partial<Record<RowDecision, string>> = {
  import: "New enquiry into New Calls",
  re_enquire: "Source updated and logged; back into New Calls if it had been called",
  supersede: "New enquiry; the previous one closed as superseded",
  dismiss: "Nothing — the call made today stands",
  ignore: "Nothing; this row is left out",
  skip: "Skipped",
};

/** One number in the Shopify preview strip (§55.2). */
function Figure({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <strong className="text-[15px] tabular-nums text-ink" data-testid={testId}>
        {value}
      </strong>
      <span className="text-[11.5px] text-ink-2">{label}</span>
    </span>
  );
}
