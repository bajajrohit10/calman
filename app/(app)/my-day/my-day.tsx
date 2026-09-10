"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { loadPanelEnquiry, type PanelPayload } from "@/components/call-log/actions";
import { ExportButton } from "@/components/export-button";
import { CallLogPanel, type PanelMasters } from "@/components/call-log/panel";
import { Badge, Button, ErrorNote, Select, cx } from "@/components/ui";
import { BUCKET_LABELS, type AssignmentBucket } from "@/lib/enquiry-labels";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import type { RecommendedRow } from "@/lib/recommended";

import { dismissOverdue } from "../assign/actions";

/** §6 order, reused for grouping the day. */
const BUCKET_ORDER: AssignmentBucket[] = [
  "follow_up",
  "offer",
  "fresh",
  "campaign",
  "call_back",
];

export function MyDay({
  rows,
  error,
  date,
  isAdmin,
  counsellorId,
  roster,
  overdue,
  overdueDismissed,
  masters,
}: {
  rows: RecommendedRow[];
  error: string | null;
  date: string;
  isAdmin: boolean;
  counsellorId: string;
  roster: { id: string; name: string }[];
  overdue: RecommendedRow[];
  overdueDismissed: boolean;
  masters: PanelMasters;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<PanelPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // One button per row, in render order, so focus can move to the next row
  // after a call is logged without the list having to be re-queried first.
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const openIndex = useRef<number>(-1);

  const groups = BUCKET_ORDER.map((bucket) => ({
    bucket,
    rows: rows.filter((r) => r.bucket === bucket),
  })).filter((g) => g.rows.length > 0);

  // Flat index across groups — the visual order of the buttons.
  let cursor = 0;
  const indexOf = new Map<number, number>();
  for (const g of groups) for (const r of g.rows) indexOf.set(r.enquiry_id, cursor++);

  function openRow(row: RecommendedRow) {
    setLoadError(null);
    openIndex.current = indexOf.get(row.enquiry_id) ?? -1;
    start(async () => {
      const res = await loadPanelEnquiry(row.enquiry_id);
      if (res.error || !res.enquiry) {
        setLoadError(res.error ?? "Could not open that enquiry.");
        return;
      }
      setOpen(res.enquiry);
    });
  }

  function afterSave() {
    const next = openIndex.current + 1;
    setOpen(null);
    router.refresh();
    // The refreshed list may be shorter (a won or lost enquiry drops out), so
    // fall back to whatever now sits at that position, then to the last row.
    window.setTimeout(() => {
      const list = buttons.current.filter(Boolean);
      (list[next] ?? list[list.length - 1])?.focus();
    }, 120);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form method="GET" className="flex items-center gap-2">
          <label className="text-[12.5px] text-ink-2">
            Date{" "}
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[13px]"
            />
          </label>
          {isAdmin ? (
            <label className="text-[12.5px] text-ink-2">
              Counsellor{" "}
              <Select
                name="counsellor"
                defaultValue={counsellorId}
                className="inline-block w-[190px]"
              >
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button type="submit" size="sm" variant="secondary">
            Show
          </Button>
        </form>
        <span className="text-[12.5px] text-ink-3">
          {rows.length} assigned for {formatDate(date)}
        </span>
        <ExportButton source="myday" date={date} counsellorId={counsellorId} className="ml-auto" />
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.bucket}>
              <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {BUCKET_LABELS[group.bucket]} ({group.rows.length})
              </h2>
              <ul className="overflow-hidden rounded-lg border border-line bg-surface">
                {group.rows.map((r) => (
                  <li
                    key={r.enquiry_id}
                    className={cx(
                      "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0",
                      open?.id === r.enquiry_id && "bg-accent-soft/40",
                    )}
                  >
                    <Link
                      href={`/students/${r.mobile}`}
                      className="text-[13px] font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {r.student_name || "No name"}
                    </Link>
                    <span className="text-[12.5px] tabular-nums text-ink-2">
                      {formatMobile(r.mobile)}
                    </span>
                    {r.importance ? (
                      <Badge tone="neutral">{r.importance.toUpperCase()}</Badge>
                    ) : null}
                    {r.is_overdue ? <Badge tone="danger">Overdue</Badge> : null}
                    <span className="text-[12px] text-ink-3">
                      {r.teacher_names?.join(", ") || "no interests yet"}
                    </span>
                    <span
                      className={cx(
                        "text-[12px] tabular-nums",
                        r.is_overdue ? "text-danger" : "text-ink-3",
                      )}
                    >
                      {r.next_follow_up_date ? formatDate(r.next_follow_up_date) : "—"}
                    </span>
                    <span className="text-[12px] tabular-nums text-ink-3">
                      {r.follow_up_slots_used}/3
                    </span>
                    <span className="ml-auto">
                      <Button
                        ref={(el) => {
                          buttons.current[indexOf.get(r.enquiry_id) ?? 0] = el;
                        }}
                        size="sm"
                        variant="primary"
                        disabled={pending}
                        onClick={() => openRow(r)}
                      >
                        Log call
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-2 px-4 py-8 text-center text-[13px] text-ink-3">
              Nothing assigned for {formatDate(date)}.
            </p>
          ) : null}

          {isAdmin ? (
            <OverdueReport
              rows={overdue}
              date={date}
              dismissed={overdueDismissed}
              onDismissed={() => router.refresh()}
            />
          ) : null}
        </div>

        {/* Side drawer: the list stays put behind it (§5.4). */}
        {open ? (
          <aside className="w-full shrink-0 lg:w-[520px]">
            <div className="sticky top-4">
              <CallLogPanel
                enquiry={open}
                masters={masters}
                onSaved={afterSave}
                onCancel={() => setOpen(null)}
              />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function OverdueReport({
  rows,
  date,
  dismissed,
  onDismissed,
}: {
  rows: RecommendedRow[];
  date: string;
  dismissed: boolean;
  onDismissed: () => void;
}) {
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  if (!rows.length) return null;

  return (
    <section className="rounded-lg border border-warn/40 bg-warn-soft/30">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold text-ink">
          Overdue follow-ups ({rows.length})
        </h2>
        <span className="text-[11.5px] text-ink-3">
          Past their date and not called since. They still roll forward.
        </span>
        {dismissed ? (
          <Badge tone="neutral">Dismissed for {formatDate(date)}</Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await dismissOverdue(date);
                setResult(res);
                if (!res.error) onDismissed();
              })
            }
          >
            Dismiss
          </Button>
        )}
      </header>
      <ul className="px-3 py-2 text-[12.5px]">
        {rows.map((r) => (
          <li key={r.enquiry_id} className="flex flex-wrap items-center gap-2 py-0.5">
            <Link
              href={`/students/${r.mobile}`}
              className="text-ink underline-offset-2 hover:underline"
            >
              {r.student_name || "No name"}
            </Link>
            <span className="tabular-nums text-ink-3">{formatMobile(r.mobile)}</span>
            <span className="text-danger">due {formatDate(r.next_follow_up_date)}</span>
            <span className="text-ink-3">{r.assigned_to_name ?? "unassigned"}</span>
          </li>
        ))}
      </ul>
      {result?.error ? (
        <div className="px-3 pb-2">
          <ErrorNote>{result.error}</ErrorNote>
        </div>
      ) : null}
    </section>
  );
}
