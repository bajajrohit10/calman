"use client";

import Link from "next/link";

import { StudentLink } from "@/components/student-link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loadPanelEnquiry, type PanelPayload } from "@/components/call-log/actions";
import { useConfirmLeave } from "@/components/unsaved-guard";
import { CallLogPanel, type PanelMasters } from "@/components/call-log/panel";
import { ExportButton } from "@/components/export-button";
import {
  CommonFilterFields,
  Labelled,
  type FilterMasters,
} from "@/components/filter-fields";
import {
  Badge,
  Button,
  ErrorNote,
  ImportanceMark,
  Input,
  Select,
  cx,
} from "@/components/ui";
import {
  CLOSE_REASON_LABELS,
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_TYPE_LABELS,
  LOST_REASON_LABELS,
  OUTCOME_SHORT,
  statusTone,
} from "@/lib/enquiry-labels";
import type { EnquiryRow } from "@/lib/enquiries";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";

/** Sortable columns, and the label each header shows. */
const SORTABLE = [
  { key: "created_at", label: "Created" },
  { key: "student_name", label: "Student" },
  { key: "mobile", label: "Mobile" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "importance", label: "Imp" },
  { key: "next_follow_up_date", label: "Follow-up" },
  { key: "last_call_at", label: "Last call" },
  { key: "slots", label: "Slots" },
] as const;

/**
 * §5.6. Every enquiry, sortable and paged on the server, filtered through the
 * same query-string keys the Assignment Desk uses. Clicking an open row opens
 * the call panel in a drawer, so the table is a place to work from and not
 * only to read.
 */
export function EnquiriesTable({
  rows,
  total,
  includeArchived,
  error,
  page,
  pageSize,
  sort,
  dir,
  search,
  counsellorName,
  roster,
  masters,
  multi,
  panelMasters,
  selected,
}: {
  rows: EnquiryRow[];
  total: number;
  includeArchived?: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  search: string;
  counsellorName: string | null;
  roster: { id: string; name: string }[];
  masters: FilterMasters;
  /** Teacher and Content are multi-select (§12.1). */
  multi?: Record<string, string[]>;
  panelMasters: PanelMasters;
  selected: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<PanelPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const confirmLeave = useConfirmLeave();
  const [pending, start] = useTransition();

  const pages = Math.max(1, Math.ceil(total / pageSize));

  function withParam(patch: Record<string, string>) {
    const params = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    return `?${params.toString()}`;
  }

  function closeOpen() {
    void confirmLeave().then((ok) => {
      if (ok) setOpen(null);
    });
  }

  async function openRow(row: EnquiryRow) {
    if (row.status !== "open") return;
    // §27.4. Swapping rows throws away whatever is typed in the panel just as
    // surely as navigating away does, so it asks the same question first.
    if (!(await confirmLeave())) return;
    setLoadError(null);
    start(async () => {
      const res = await loadPanelEnquiry(row.enquiry_id);
      if (res.error || !res.enquiry) {
        setLoadError(res.error ?? "Could not open that enquiry.");
        return;
      }
      setOpen(res.enquiry);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap gap-2 p-2.5">
          <Labelled label="Mobile" wide>
            <Input name="mobile" defaultValue={selected.mobile} placeholder="any part" />
          </Labelled>

          <CommonFilterFields
            masters={masters}
            selected={selected}
            multi={multi}
            roster={roster}
          />

          <Labelled label="Type">
            <Select name="type" defaultValue={selected.type}>
              <option value="">Any</option>
              <option value="purchase">Purchase</option>
              <option value="after_sale">After Sale</option>
            </Select>
          </Labelled>

          <Labelled label="Status">
            <Select name="status" defaultValue={selected.status}>
              <option value="">Any</option>
              {Object.entries(ENQUIRY_STATUS_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Labelled>

          <Labelled label="Lost reason">
            <Select name="lostReason" defaultValue={selected.lostReason}>
              <option value="">Any</option>
              {Object.entries(LOST_REASON_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Labelled>

          <Labelled label="Close reason">
            <Select name="closeReason" defaultValue={selected.closeReason}>
              <option value="">Any</option>
              {Object.entries(CLOSE_REASON_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Labelled>
        </div>

        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />

        <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-sunk px-2.5 py-2.5">
          <Button type="submit" variant="primary" size="sm">
            Apply filters
          </Button>
          {/* §9: the one list that can be asked to show archived rows. Every
              other surface reads live_enquiries and cannot. */}
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              name="archived"
              value="1"
              defaultChecked={includeArchived}
            />
            Include archived
          </label>
          <Link
            href="/enquiries"
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            Clear
          </Link>
          <span className="ml-auto text-[12px] text-ink-3">
            {total} enquir{total === 1 ? "y" : "ies"}
          </span>
          <ExportButton source="enquiries" />
        </div>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      {open ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={closeOpen}
            className="self-start text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
          >
            ← Back to the list
          </button>
          <CallLogPanel
            enquiry={open}
            masters={panelMasters}
            counsellorName={counsellorName}
            onSaved={() => {
              setOpen(null);
              router.refresh();
            }}
            onCancel={closeOpen}
          />
        </div>
      ) : null}

      <div className={cx("gap-3 xl:flex-row", open ? "hidden" : "flex flex-col")}>
        <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[1000px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                {SORTABLE.map((col) => {
                  const active = sort === col.key;
                  const nextDir = active && dir === "asc" ? "desc" : "asc";
                  return (
                    <th key={col.key} className="px-2 py-[7px]">
                      <Link
                        href={withParam({ sort: col.key, dir: nextDir, page: "" })}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {col.label}
                        {active ? <span>{dir === "asc" ? "▲" : "▼"}</span> : null}
                      </Link>
                    </th>
                  );
                })}
                <th className="px-2 py-[7px]">Teachers</th>
                <th className="px-2 py-[7px]">Last note</th>
                <th className="px-2 py-[7px]">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.enquiry_id}
                  onClick={() => openRow(r)}
                  className={cx(
                    "border-b border-line last:border-b-0",
                    r.status === "open" && "cursor-pointer hover:bg-sunk/40",
                    open?.id === r.enquiry_id && "bg-accent-soft/40",
                  )}
                >
                  <td className="px-2 py-[5px] whitespace-nowrap text-ink-3">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-2 py-[5px] text-ink">{r.student_name || "No name"}</td>
                  <td className="px-2 py-[5px]">
                    <StudentLink
                      mobile={r.mobile}
                      onClick={(e) => e.stopPropagation()}
                      className="tabular-nums text-ink-2 underline-offset-2 hover:underline"
                    >
                      {formatMobile(r.mobile)}
                    </StudentLink>
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">{ENQUIRY_TYPE_LABELS[r.type]}</td>
                  <td className="px-2 py-[5px]">
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge dot tone={statusTone(r.status)}>
                        {ENQUIRY_STATUS_LABELS[r.status]}
                      </Badge>
                      {r.lost_reason ? (
                        <span className="text-[11px] text-ink-3">
                          {LOST_REASON_LABELS[r.lost_reason]}
                        </span>
                      ) : null}
                      {r.close_reason ? (
                        <span className="text-[11px] text-ink-3">
                          {CLOSE_REASON_LABELS[r.close_reason]}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-2 py-[5px]">
                    {r.importance ? (
                      <ImportanceMark grade={r.importance} />
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-2 py-[5px] whitespace-nowrap tabular-nums text-ink-2">
                    {r.next_follow_up_date ? formatDate(r.next_follow_up_date) : "—"}
                  </td>
                  <td className="px-2 py-[5px] whitespace-nowrap text-ink-3">
                    {r.last_outcome ? (
                      <>
                        {OUTCOME_SHORT[r.last_outcome]}
                        <span className="ml-1">{formatDate(r.last_call_at)}</span>
                      </>
                    ) : (
                      "never"
                    )}
                  </td>
                  <td className="px-2 py-[5px] tabular-nums text-ink-3">
                    {r.follow_up_slots_used}/3
                  </td>
                  <td className="px-2 py-[5px] text-ink-2">{r.teacher_names ?? "—"}</td>
                  <td className="max-w-[260px] truncate px-2 py-[5px] text-ink-3">
                    {r.last_discussion ?? "—"}
                  </td>
                  <td className="px-2 py-[5px] text-ink-3">{r.assigned_to_name ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-ink-3">
                    No enquiries match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

      </div>

      {pages > 1 ? (
        <div className="flex items-center gap-3 text-[12.5px] text-ink-2">
          {page > 1 ? (
            <Link
              href={withParam({ page: String(page - 1) })}
              className="underline-offset-2 hover:underline"
            >
              ← Previous
            </Link>
          ) : null}
          <span className="text-ink-3">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link
              href={withParam({ page: String(page + 1) })}
              className="underline-offset-2 hover:underline"
            >
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}

      {pending ? <p className="text-[12px] text-ink-3">Opening…</p> : null}
      <p className="text-[11.5px] text-ink-3">
        Open a row to log a call, or follow the number for its full history.
      </p>
    </div>
  );
}
