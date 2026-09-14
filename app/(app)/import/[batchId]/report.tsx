"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Badge, Button, ErrorNote, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

import { resolveImportRow } from "../actions";

export type ReportRow = {
  id: number;
  row_number: number;
  normalised_mobile: string | null;
  outcome: string;
  skip_reason: string | null;
  enquiry_id: number | null;
  resolved_at: string | null;
  raw: Record<string, string>;
};

/**
 * Brief 31 item 3: the report says what the review table said.
 *
 * A row's outcome is stored as a mechanism — "re_enquired" — and the review
 * table spoke in situations: "Already in New Calls", "Already in follow-up
 * list". Somebody checking afterwards whether the import did what the screen
 * promised had to translate between the two vocabularies, which is exactly
 * where a discrepancy hides. So the report is labelled in the same five terms.
 *
 * Re-enquiry splits in two because §10.1 does: a lead that had never been
 * called stays where it is, and one that had been called comes back to the
 * pool. Which happened is already recorded in the row's own account of itself,
 * written by the function that did it — so the label is read from that rather
 * than guessed from the outcome alone.
 */
export type ReportCase =
  | "new_enquiry"
  | "in_pool"
  | "in_follow_up"
  | "dismissed"
  | "superseded"
  | "skipped";

const CASE_LABELS: Record<ReportCase, string> = {
  new_enquiry: "New number / Closed call → new enquiry",
  in_pool: "Already in New Calls → source updated",
  in_follow_up: "Already in follow-up list → back into New Calls",
  dismissed: "Call done today → dismissed",
  superseded: "New enquiry, previous superseded",
  skipped: "Skipped",
};

const CASE_TONES: Record<ReportCase, "ok" | "info" | "accent" | "warn" | "neutral"> = {
  new_enquiry: "ok",
  in_pool: "info",
  in_follow_up: "info",
  dismissed: "warn",
  superseded: "accent",
  skipped: "warn",
};

/**
 * Which of the six a stored row was.
 *
 * "Returned to New Calls." is the sentence import_re_enquire returns when it
 * cleared the follow-up, and it is stored verbatim on the row, so this reads
 * the record rather than re-deriving a decision that was made at commit time.
 */
export function caseOfRow(row: { outcome: string; skip_reason: string | null }): ReportCase {
  switch (row.outcome) {
    case "imported":
      return "new_enquiry";
    case "duplicate_new_enquiry":
      return "superseded";
    case "dismissed":
      return "dismissed";
    case "re_enquired":
    case "duplicate_updated":
      return row.skip_reason?.startsWith("Returned to New Calls")
        ? "in_follow_up"
        : "in_pool";
    default:
      return "skipped";
  }
}

export function BatchReport({
  rows,
  counts,
  note,
  warnings,
}: {
  rows: ReportRow[];
  counts: Record<string, number>;
  note?: string | null;
  /** Recoverable problems during the commit; the import still finished. */
  warnings?: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [onlySkipped, setOnlySkipped] = useState(false);

  const visible = onlySkipped ? rows.filter((r) => r.outcome === "skipped") : rows;

  /**
   * The five-way counts.
   *
   * Derived from the rows rather than from the outcome counts the page
   * computed, because two of the six cases share one outcome and only the row
   * knows which it was. The page's exact counts still back the total: when the
   * listing is truncated the note above says so.
   */
  const caseCounts = useMemo(() => {
    const out: Record<ReportCase, number> = {
      new_enquiry: 0,
      in_pool: 0,
      in_follow_up: 0,
      dismissed: 0,
      superseded: 0,
      skipped: 0,
    };
    for (const r of rows) out[caseOfRow(r)] += 1;
    return out;
  }, [rows]);

  const totalRows = Object.values(counts).reduce((n, v) => n + v, 0);

  function act(rowId: number, action: "import" | "handled") {
    setError(null);
    start(async () => {
      const res = await resolveImportRow(rowId, action);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(CASE_LABELS) as ReportCase[]).map((key) => (
          <Badge key={key} tone={CASE_TONES[key]}>
            {CASE_LABELS[key]}: {caseCounts[key]}
          </Badge>
        ))}
        {/* The database's own count, beside labels derived from the listing.
            On a batch big enough to truncate the listing the two disagree,
            and the note below says why — which is the point of showing both. */}
        <Badge tone="neutral">Rows: {totalRows}</Badge>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={onlySkipped}
            onChange={(e) => setOnlySkipped(e.target.checked)}
          />
          Only skipped rows
        </label>
      </div>

      {/* The import finished; these are things that went wrong on the way and
          recovered. Shown here rather than only in the server log, because the
          person who needs to know is the one who ran the import. */}
      {warnings?.length ? (
        <div className="rounded-md border border-warn/50 bg-warn-soft/40 px-3 py-2.5">
          <p className="text-[12px] font-medium text-ink">
            {warnings.length === 1 ? "One warning" : `${warnings.length} warnings`}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-[12px] text-ink-2">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {note ? <ErrorNote>{note}</ErrorNote> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-3 py-[7px]">Row</th>
              <th className="px-2 py-[7px]">Mobile</th>
              <th className="px-2 py-[7px]">Outcome</th>
              <th className="px-2 py-[7px]">What happened</th>
              <th className="px-2 py-[7px]">Enquiry</th>
              <th className="px-3 py-[7px] text-right">Resolve</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className={cx(
                  "border-b border-line last:border-b-0",
                  r.resolved_at && "bg-sunk/30",
                )}
              >
                <td className="px-3 py-[5px] tabular-nums text-ink-3">{r.row_number}</td>
                <td className="px-2 py-[5px] tabular-nums text-ink">
                  {r.normalised_mobile ? (
                    <Link
                      href={`/students/${r.normalised_mobile}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.normalised_mobile}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-[5px]">
                  <Badge tone={CASE_TONES[caseOfRow(r)]}>
                    {CASE_LABELS[caseOfRow(r)]}
                  </Badge>
                </td>
                <td className="max-w-[320px] px-2 py-[5px] text-ink-3">
                  {r.skip_reason ?? "—"}
                </td>
                <td className="px-2 py-[5px] tabular-nums text-ink-3">
                  {r.enquiry_id ? `#${r.enquiry_id}` : "—"}
                </td>
                <td className="px-3 py-[5px] text-right">
                  {r.outcome === "skipped" && !r.resolved_at ? (
                    <span className="flex justify-end gap-1.5">
                      {r.normalised_mobile ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => act(r.id, "import")}
                        >
                          Import now
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => act(r.id, "handled")}
                      >
                        Mark handled
                      </Button>
                    </span>
                  ) : r.resolved_at ? (
                    <span className="text-[11.5px] text-ink-3">
                      resolved {formatDateTime(r.resolved_at)}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-3">
                  Nothing to show.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
