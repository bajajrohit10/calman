import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { showsSupport } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { parseSupportParams } from "../filters";

/**
 * §61.4. The queue as a CSV, under exactly the filters on screen.
 *
 * Server-side, and every matching row rather than the page: the whole reason to
 * export is to work on the set the filters describe, and a file holding the
 * first fifty of two hundred is a file that quietly lies.
 *
 * A route handler rather than a server action returning a string, so the browser
 * streams it to disk with its own download UI and nothing has to be held in a
 * client-side blob.
 */

export const dynamic = "force-dynamic";

/** How many rows one export will fetch, in pages, before it gives up. */
const PAGE = 1000;
const MAX_ROWS = 20000;

type Row = Record<string, unknown>;

/**
 * One CSV field.
 *
 * Quoted whenever it could otherwise break the row, and a doubled quote inside.
 * A leading =, +, - or @ is prefixed with a tab: Excel and Sheets treat those as
 * formulas, and a student who typed "=1+1" into the form should not become an
 * executable cell in somebody's spreadsheet.
 */
function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const COLUMNS: { header: string; pick: (r: Row) => unknown }[] = [
  { header: "Ticket", pick: (r) => r.id },
  { header: "Status", pick: (r) => r.status },
  { header: "Raised", pick: (r) => istDate(r.raised_at) },
  { header: "Age (days)", pick: (r) => r.age_days },
  { header: "Student name", pick: (r) => r.student_name },
  { header: "Mobile", pick: (r) => r.mobile },
  { header: "Order id", pick: (r) => r.order_id_work ?? r.order_id },
  { header: "Institute", pick: (r) => r.institute_name },
  { header: "Teacher", pick: (r) => r.teacher_name },
  { header: "Issues", pick: (r) => r.issues_work },
  { header: "Issue other", pick: (r) => r.issue_other_work },
  { header: "Source", pick: (r) => r.source },
  { header: "Assigned to", pick: (r) => r.assigned_to_name },
  { header: "Escalated kind", pick: (r) => r.escalation_kind },
  { header: "Escalated to", pick: (r) => r.escalated_label },
  { header: "Follow-up date", pick: (r) => r.follow_up_date },
  { header: "Resolved at", pick: (r) => istDateTime(r.resolved_at) },
  { header: "Resolved by", pick: (r) => r.resolved_by_name },
  { header: "Last action date", pick: (r) => istDateTime(r.last_touched_at) },
  { header: "Action details (latest note)", pick: (r) => r.latest_note },
  { header: "Form row ref", pick: (r) => r.form_row_ref },
  // §61.4. As submitted, appended after the working values so the first columns
  // are the ones the team reads and the originals are still in the file.
  { header: "Raw: mobile", pick: (r) => r.mobile_raw },
  { header: "Raw: order id", pick: (r) => r.order_id_raw },
  { header: "Raw: issues", pick: (r) => r.issues_raw },
  { header: "Raw: faculty/institute", pick: (r) => r.faculty_raw },
  { header: "Raw: description", pick: (r) => r.description },
  { header: "Raw: attachments", pick: (r) => r.attachment_urls },
];

/** IST calendar date, because every date the team reads is an IST one. */
function istDate(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(+d)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function istDateTime(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(+d)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export async function GET(request: Request) {
  const viewer = await requireUser();
  if (!viewer.profile || !showsSupport(viewer.profile.role)) notFound();

  const url = new URL(request.url);
  const { tab, filters } = parseSupportParams((k) => url.searchParams.get(k));

  const supabase = await createClient();
  const db = supabase.schema("support");

  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await db.rpc("queue", {
      ...filters,
      p_limit: PAGE,
      p_offset: offset,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) {
      return new Response(`Could not build the export: ${error.message}`, { status: 500 });
    }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // The queue function answers the list's own questions; the export needs a few
  // more columns than a screen has room for. One extra read keyed on the ids
  // already fetched, rather than widening the queue for every page view.
  const ids = rows.map((r) => Number(r.id));
  const extra = new Map<number, Row>();
  const notes = new Map<number, string>();

  const resolverNames = new Map<string, string>();

  if (ids.length) {
    // No embedded profiles here. The client is bound to the support schema and
    // profiles lives in public, so a PostgREST embed across the two resolves to
    // nothing — silently, which is how "Resolved by" shipped empty in testing
    // while the reports showed the same person correctly. Two plain reads
    // instead, and the error is no longer discarded.
    const { data: detail, error: detailError } = await db
      .from("tickets")
      .select(
        `id, mobile_raw, order_id_raw, issues_raw, faculty_raw, description,
         attachment_urls, form_row_ref, resolved_at, resolved_by`,
      )
      .in("id", ids);
    if (detailError) {
      return new Response(`Could not build the export: ${detailError.message}`, { status: 500 });
    }
    for (const d of (detail ?? []) as unknown as Row[]) {
      extra.set(Number(d.id), d);
    }

    const resolverIds = [
      ...new Set(
        [...extra.values()]
          .map((d) => (d.resolved_by ? String(d.resolved_by) : null))
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (resolverIds.length) {
      const { data: people, error: peopleError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", resolverIds);
      if (peopleError) {
        return new Response(`Could not build the export: ${peopleError.message}`, { status: 500 });
      }
      for (const p of people ?? []) resolverNames.set(p.id, p.full_name ?? "");
    }

    // The latest note per ticket. Fetched newest-first and kept on first sight,
    // which is the latest by definition.
    const { data: noteRows, error: noteError } = await db
      .from("events")
      .select("ticket_id, detail, at")
      .in("ticket_id", ids)
      .eq("kind", "note")
      .order("at", { ascending: false })
      .order("id", { ascending: false });
    if (noteError) {
      return new Response(`Could not build the export: ${noteError.message}`, { status: 500 });
    }
    for (const n of (noteRows ?? []) as unknown as {
      ticket_id: number;
      detail: { text?: string };
    }[]) {
      if (!notes.has(n.ticket_id) && n.detail?.text) notes.set(n.ticket_id, n.detail.text);
    }
  }

  const merged = rows.map((r) => {
    const id = Number(r.id);
    const d = extra.get(id) ?? {};
    return {
      ...r,
      ...d,
      resolved_by_name: d.resolved_by ? (resolverNames.get(String(d.resolved_by)) ?? null) : null,
      latest_note: notes.get(id) ?? null,
    };
  });

  const lines = [
    COLUMNS.map((c) => field(c.header)).join(","),
    ...merged.map((r) => COLUMNS.map((c) => field(c.pick(r))).join(",")),
  ];

  // CRLF and a BOM: Excel on Windows reads a bare LF file as one long row and
  // mangles anything non-ASCII without the mark. Everything else ignores both.
  const csv = `﻿${lines.join("\r\n")}\r\n`;

  const stamp = istDate(new Date().toISOString());
  const suffix = tab === "all" ? "all" : tab;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="calman-support-${suffix}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
