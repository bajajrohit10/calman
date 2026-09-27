"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { FacetSelect, Labelled } from "@/components/filter-fields";
import { MultiSelect } from "@/components/multi-select";
import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import type { FacetMap } from "@/lib/facet-shape";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMobile } from "@/lib/mobile";
import { ISSUE_OPTIONS } from "@/lib/support/normalise";

import { newSupportTicket } from "./actions";
import {
  ISSUE_FILTER_OPTIONS,
  STATUS_LABELS,
  SUPPORT_SOURCES,
  SUPPORT_TABS,
  UNASSIGNED,
  type SupportTab,
} from "./filters";

export type TicketRow = {
  id: number;
  raised_at: string;
  age_days: number;
  student_name: string | null;
  mobile: string | null;
  mobile_raw: string | null;
  order_id: string | null;
  order_id_raw: string | null;
  order_id_work: string | null;
  institute_name: string | null;
  teacher_name: string | null;
  issues_work: string[];
  issue_other_work: string | null;
  status: keyof typeof STATUS_LABELS;
  follow_up_date: string | null;
  overdue: boolean;
  assigned_to_name: string | null;
  assigned_to: string | null;
  escalated_to_name: string | null;
  last_touched_at: string;
  source: string;
  child_count: number;
  total_count: number;
};

type Master = { id: string; name: string };

/** §58.4. The tone a status carries wherever it is shown. */
export function statusTone(status: string): "info" | "accent" | "warn" | "ok" | "neutral" {
  if (status === "new") return "info";
  if (status === "working") return "accent";
  if (status === "escalated") return "warn";
  if (status === "future") return "neutral";
  return "ok";
}

export function SupportBoard({
  rows,
  total,
  error,
  tab,
  counts,
  page,
  pageSize,
  search,
  issues,
  assignedTo,
  sources,
  selected,
  facets,
  facetError,
  masters,
  staff,
}: {
  rows: TicketRow[];
  total: number;
  error: string | null;
  tab: SupportTab;
  counts: Record<string, number>;
  page: number;
  pageSize: number;
  search: string;
  issues: string[];
  assignedTo: string[];
  sources: string[];
  selected: Record<string, string>;
  facets?: FacetMap;
  facetError?: string | null;
  masters: { institutes: Master[]; teachers: Master[] };
  staff: Master[];
}) {
  const [adding, setAdding] = useState(false);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function withParam(patch: Record<string, string>) {
    const params = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    return `?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-line-2">
          {SUPPORT_TABS.map((t) => {
            const on = tab === t.id;
            const params = new URLSearchParams(search);
            params.set("tab", t.id);
            params.delete("page");
            return (
              <Link
                key={t.id}
                href={`/support?${params.toString()}`}
                prefetch={false}
                aria-current={on ? "page" : undefined}
                className={
                  on
                    ? "bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-ink"
                    : "bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:bg-surface-2"
                }
              >
                {t.label}
                <span className="ml-1.5 tabular-nums opacity-80">{counts[t.id] ?? 0}</span>
              </Link>
            );
          })}
        </div>
        <span className="ml-auto">
          <Button type="button" size="sm" variant="primary" onClick={() => setAdding(true)}>
            New ticket
          </Button>
        </span>
      </div>

      {adding ? (
        <NewTicketForm
          onClose={() => setAdding(false)}
          instituteCount={masters.institutes.length}
        />
      ) : null}

      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        {/* The tab is part of the filter, so applying one must not drop it. */}
        <input type="hidden" name="tab" value={tab} />
        <div className="flex flex-wrap gap-2 p-2.5">
          <Labelled label="Search" wide>
            <Input
              name="q"
              defaultValue={selected.q}
              placeholder="Mobile, order id or name"
            />
          </Labelled>

          <Labelled label="Institute">
            <FacetSelect
              name="institute"
              facet="institute"
              options={masters.institutes}
              value={selected.institute}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Teacher">
            <FacetSelect
              name="teacher"
              facet="teacher"
              options={masters.teachers}
              value={selected.teacher}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Issue">
            <MultiSelect
              name="issue"
              facet="issue"
              options={ISSUE_FILTER_OPTIONS}
              values={issues}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Assigned to">
            <MultiSelect
              name="assignedTo"
              facet="assigned_to"
              options={[{ id: UNASSIGNED, name: "Nobody" }, ...staff]}
              values={assignedTo}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Source">
            <MultiSelect
              name="source"
              facet="source"
              options={SUPPORT_SOURCES.map((s) => ({ id: s.id, name: s.name }))}
              values={sources}
              facets={facets}
            />
          </Labelled>

          <Labelled label="Follow-up between" wide>
            <div className="flex items-center gap-1.5">
              <Input type="date" name="followFrom" defaultValue={selected.followFrom} />
              <span className="text-[12px] text-ink-3">→</span>
              <Input type="date" name="followTo" defaultValue={selected.followTo} />
            </div>
          </Labelled>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-sunk px-2.5 py-2.5">
          <Button type="submit" variant="primary" size="sm">
            Apply filters
          </Button>
          <Link
            href={`/support?tab=${tab}`}
            prefetch={false}
            className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            Clear
          </Link>
          <span className="text-[12px] text-ink-3">{total} tickets</span>
        </div>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {facetError ? (
        <p className="text-[12px] text-warn" role="status">
          {facetError}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[1180px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-1.5 py-[7px]">#</th>
              <th className="px-1.5 py-[7px]">Raised</th>
              <th className="px-1.5 py-[7px]">Age</th>
              <th className="px-1.5 py-[7px]">Student</th>
              <th className="px-1.5 py-[7px]">Order id</th>
              <th className="px-1.5 py-[7px]">Institute / teacher</th>
              <th className="px-1.5 py-[7px]">Issues</th>
              <th className="px-1.5 py-[7px]">Status</th>
              <th className="px-1.5 py-[7px]">Follow-up</th>
              <th className="px-1.5 py-[7px]">Assigned</th>
              <th className="px-1.5 py-[7px]">Touched</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const order = r.order_id_work ?? r.order_id;
              const rawDiffers = Boolean(r.order_id_raw && r.order_id_raw !== order);
              return (
                <tr key={r.id} className="border-b border-line last:border-b-0">
                  <td className="px-1.5 py-[5px] tabular-nums">
                    <Link
                      href={`/support/${r.id}`}
                      prefetch={false}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {r.id}
                    </Link>
                    {r.child_count > 0 ? (
                      <span className="ml-1.5" title={`${r.child_count} merged duplicate(s)`}>
                        <Badge tone="neutral">+{r.child_count}</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-[5px] text-ink-3">
                    {formatDate(r.raised_at)}
                  </td>
                  <td className="px-1.5 py-[5px] tabular-nums">
                    {/* §58.4. Red past three calendar days, and only while it is
                        still somebody's problem — a resolved ticket's age is
                        history, not a warning. */}
                    {r.age_days > 3 && r.status !== "resolved" ? (
                      <Badge tone="danger">{r.age_days}d</Badge>
                    ) : (
                      <span className="text-ink-3">{r.age_days}d</span>
                    )}
                  </td>
                  <td className="px-1.5 py-[5px]">
                    <span className="text-ink">{r.student_name || "No name"}</span>
                    {r.mobile ? (
                      <span className="ml-1.5 tabular-nums text-ink-3">
                        {formatMobile(r.mobile)}
                      </span>
                    ) : (
                      <span className="ml-1.5 text-ink-3" title={r.mobile_raw ?? ""}>
                        {r.mobile_raw ? `${r.mobile_raw} (unusable)` : "no number"}
                      </span>
                    )}
                  </td>
                  <td className="px-1.5 py-[5px] tabular-nums text-ink-2">
                    {order ? (
                      <span title={rawDiffers ? `As submitted: ${r.order_id_raw}` : undefined}>
                        {order}
                        {rawDiffers ? <span className="ml-1 text-ink-3">*</span> : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-1.5 py-[5px] text-ink-2">
                    {r.institute_name ?? r.teacher_name ?? (
                      <span className="text-warn">not matched</span>
                    )}
                  </td>
                  <td className="max-w-[240px] px-1.5 py-[5px] text-ink-3">
                    <span className="block truncate" title={r.issues_work.join(", ")}>
                      {r.issues_work.length ? r.issues_work.join(", ") : "—"}
                    </span>
                    {r.issue_other_work ? (
                      <span className="block truncate text-[11px]" title={r.issue_other_work}>
                        {r.issue_other_work}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1.5 py-[5px]">
                    <Badge dot tone={statusTone(r.status)}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                    {r.status === "escalated" && r.escalated_to_name ? (
                      <span className="block text-[11px] text-ink-3">
                        → {r.escalated_to_name}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-[5px] tabular-nums">
                    {r.follow_up_date ? (
                      <span className={r.overdue ? "text-danger" : "text-ink-2"}>
                        {formatDate(r.follow_up_date)}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-1.5 py-[5px] text-ink-2">
                    {r.assigned_to_name ?? <span className="text-ink-3">nobody</span>}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-[5px] text-[11px] text-ink-3">
                    {formatDateTime(r.last_touched_at)}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className={cx("px-3 py-8 text-center text-ink-3")}>
                  No tickets with these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div className="flex items-center gap-3 text-[12.5px] text-ink-2">
          {page > 1 ? (
            <Link href={withParam({ page: String(page - 1) })} prefetch={false} className="hover:underline">
              ← Previous
            </Link>
          ) : null}
          <span className="text-ink-3">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={withParam({ page: String(page + 1) })} prefetch={false} className="hover:underline">
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * §58.3d. A ticket typed in by the team.
 *
 * The same fields the form asks for and the same create path behind it, merge
 * probe included — so a phone call about an order that already has a ticket
 * lands on that ticket rather than starting a second thread.
 */
function NewTicketForm({
  onClose,
  instituteCount,
}: {
  onClose: () => void;
  instituteCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error: string | null; ok?: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const lock = useRef(false);

  function submit(form: HTMLFormElement) {
    // §51.2's rule: a ref lock, because useTransition's pending flag is a
    // render behind and a second click lands before it flips.
    if (lock.current) return;
    lock.current = true;
    const data = new FormData(form);
    setResult(null);
    start(async () => {
      const res = await newSupportTicket({
        source: String(data.get("source") ?? "manual") as "mail" | "whatsapp" | "calling_team" | "manual",
        studentName: String(data.get("studentName") ?? ""),
        mobile: String(data.get("mobile") ?? ""),
        orderId: String(data.get("orderId") ?? ""),
        issues: picked,
        issueOther: String(data.get("issueOther") ?? ""),
        description: String(data.get("description") ?? ""),
        faculty: String(data.get("faculty") ?? ""),
      });
      setResult(res);
      lock.current = false;
      if (!res.error) {
        form.reset();
        setPicked([]);
        router.refresh();
        if (res.ticketId) router.push(`/support/${res.ticketId}`);
      }
    });
  }

  return (
    <form
      data-testid="new-ticket-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="rounded-lg border border-accent/40 bg-accent-soft/20 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">New ticket</span>
        <span className="text-[11.5px] text-ink-3">
          Goes through the same checks as the form, duplicates included.
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[12px] text-ink-3 underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Labelled label="Source">
          <Select name="source" defaultValue="calling_team">
            {SUPPORT_SOURCES.filter((s) => s.id !== "form" && s.id !== "counselling").map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Labelled>
        <Labelled label="Student name">
          <Input name="studentName" placeholder="As they gave it" />
        </Labelled>
        <Labelled label="Mobile">
          <Input name="mobile" aria-label="New ticket mobile" placeholder="10 digits" />
        </Labelled>
        <Labelled label="Order id">
          <Input name="orderId" aria-label="New ticket order id" placeholder="ZI…" />
        </Labelled>
        <Labelled label="Faculty / institute" wide>
          <Input
            name="faculty"
            placeholder={`Matched against ${instituteCount} institutes and the teachers`}
          />
        </Labelled>
        <Labelled label="Other issue text" wide>
          <Input name="issueOther" placeholder="If it is not one of the five" />
        </Labelled>
        <Labelled label="Description" wide>
          <Input name="description" placeholder="What the student said" />
        </Labelled>
      </div>

      <fieldset className="mt-2">
        <legend className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
          Issues
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ISSUE_OPTIONS.map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={picked.includes(o)}
                onChange={() =>
                  setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))
                }
              />
              {o}
            </label>
          ))}
        </div>
      </fieldset>

      {result?.error ? <ErrorNote>{result.error}</ErrorNote> : null}
      {result?.ok ? (
        <p className="mt-2 text-[12.5px] text-ok" role="status">
          {result.ok}
        </p>
      ) : null}

      <div className="mt-2.5">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}
