"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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

const OUTCOME_LABELS: Record<string, string> = {
  imported: "Imported",
  re_enquired: "Re-enquired",
  dismissed: "Dismissed — called today",
  duplicate_updated: "Updated existing (before §10.1)",
  duplicate_new_enquiry: "New enquiry, previous superseded",
  skipped: "Skipped",
};

const TONES: Record<string, "ok" | "info" | "accent" | "warn"> = {
  imported: "ok",
  re_enquired: "info",
  dismissed: "warn",
  duplicate_updated: "info",
  duplicate_new_enquiry: "accent",
  skipped: "warn",
};

export function BatchReport({
  rows,
  counts,
  note,
}: {
  rows: ReportRow[];
  counts: Record<string, number>;
  note?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [onlySkipped, setOnlySkipped] = useState(false);

  const visible = onlySkipped ? rows.filter((r) => r.outcome === "skipped") : rows;

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
        {Object.entries(OUTCOME_LABELS).map(([key, label]) => (
          <Badge key={key} tone={TONES[key]}>
            {label}: {counts[key] ?? 0}
          </Badge>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={onlySkipped}
            onChange={(e) => setOnlySkipped(e.target.checked)}
          />
          Only skipped rows
        </label>
      </div>

      {note ? <ErrorNote>{note}</ErrorNote> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
              <th className="px-3 py-2">Row</th>
              <th className="px-2 py-2">Mobile</th>
              <th className="px-2 py-2">Outcome</th>
              <th className="px-2 py-2">Reason</th>
              <th className="px-2 py-2">Enquiry</th>
              <th className="px-3 py-2 text-right">Resolve</th>
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
                <td className="px-3 py-1.5 tabular-nums text-ink-3">{r.row_number}</td>
                <td className="px-2 py-1.5 tabular-nums text-ink">
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
                <td className="px-2 py-1.5">
                  <Badge tone={TONES[r.outcome] ?? "neutral"}>
                    {OUTCOME_LABELS[r.outcome] ?? r.outcome}
                  </Badge>
                </td>
                <td className="max-w-[320px] px-2 py-1.5 text-ink-3">
                  {r.skip_reason ?? "—"}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-ink-3">
                  {r.enquiry_id ? `#${r.enquiry_id}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-right">
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
