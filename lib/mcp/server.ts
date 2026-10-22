import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PoolClient } from "pg";
import { z } from "zod";

import { asUser } from "@/lib/mcp/db";
import { CALMAN_GUIDE } from "@/lib/mcp/guide";

/**
 * §88. The Calman MCP server: the tools Claude gets, all running as the
 * signed-in manager through asUser(), so RLS and the audit log see them.
 *
 * One server per HTTP request (the transport is stateless), built around the
 * caller's id. Reads are READ ONLY transactions; the four writes are narrow,
 * validated, and mirror what the Assignment Desk and Settings → Offers do.
 */

export type Caller = { userId: string; role: string; name: string | null };

const MAX_ROWS = 1000;
const MAX_CHARS = 400_000;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
// A format check rather than z.uuid(), which in zod 4 also insists on RFC
// version bits and would refuse ids Postgres accepts.
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Expected a uuid");

type Content = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(value: unknown): Content {
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n… [output cut at ${MAX_CHARS} characters — aggregate in SQL or narrow the query]`;
  }
  return { content: [{ type: "text", text }] };
}

function fail(message: string): Content {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Postgres errors are the most useful thing to hand back: Claude fixes the SQL from them. */
async function guarded(fn: () => Promise<Content>): Promise<Content> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { message?: string; hint?: string; position?: string };
    const parts = [err.message ?? String(e)];
    if (err.hint) parts.push(`Hint: ${err.hint}`);
    if (err.position) parts.push(`At character ${err.position}`);
    return fail(parts.join("\n"));
  }
}

// ---------------------------------------------------------------------------
// run_sql's guard
// ---------------------------------------------------------------------------

/**
 * What run_sql accepts. The real boundary is the database — a READ ONLY
 * transaction, as `authenticated`, under RLS, from a login that can become no
 * other role — and the extended query protocol, which refuses more than one
 * statement. This only adds what those cannot see: a statement must be a
 * query, and it may not rewrite the request's own identity (set_config on
 * request.jwt.claims would let one manager read as another user).
 */
export function checkSql(raw: string): { sql: string; wrap: boolean } | { error: string } {
  const sql = raw.trim().replace(/;\s*$/, "").trim();
  if (!sql) return { error: "Empty query." };
  if (sql.length > 20_000) return { error: "Query is too long." };
  const lowered = sql.toLowerCase();
  const first = lowered.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "").match(/^[a-z]+/)?.[0];
  if (!first || !["select", "with", "explain", "table", "values", "show"].includes(first)) {
    return { error: "Only read queries are allowed (SELECT, WITH, EXPLAIN, TABLE, VALUES, SHOW)." };
  }
  if (/set_config|\bu&["']|\bset\s+(local\s+|session\s+)?(role|session)\b|reset\s+role/.test(lowered)) {
    return { error: "Queries may not change the session's role or settings." };
  }
  return { sql, wrap: ["select", "with", "table", "values"].includes(first) };
}

async function runSql(db: PoolClient, raw: string, limit: number) {
  const checked = checkSql(raw);
  if ("error" in checked) throw new Error(checked.error);
  const cap = Math.min(Math.max(1, limit), MAX_ROWS);
  // The newline before the parenthesis matters: a query ending in a -- comment
  // would otherwise comment the wrapper's closing bracket out.
  const text = checked.wrap
    ? `select * from (\n${checked.sql}\n) as _q limit ${cap + 1}`
    : checked.sql;
  const res = await db.query({ text, values: [], rowMode: "array" });
  const columns = res.fields.map((f) => f.name);
  const truncated = res.rows.length > cap;
  const rows = (truncated ? res.rows.slice(0, cap) : res.rows) as unknown[][];
  return { columns, rows, row_count: rows.length, truncated };
}

// ---------------------------------------------------------------------------
// Shared SQL
// ---------------------------------------------------------------------------

/** The Analytics page's definition of a lead (app.analytics_leads), as a CTE. */
const LEADS_CTE = `
  leads as (
    select e.*,
           (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date as lead_day
      from public.enquiries e
     where e.type = 'purchase'
       and e.archived_at is null
       and not (e.status = 'closed' and e.close_reason in ('handed_to_support', 'superseded'))
       and (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date between $1 and $2
  )`;

const GROUPS = {
  source: { level: "lead", key: "coalesce(s.name, '(none)')", join: "left join public.sources s on s.id = l.source_id" },
  term: { level: "lead", key: "coalesce(t.name, '(none)')", join: "left join public.terms t on t.id = l.term_id" },
  importance: { level: "lead", key: "coalesce(l.importance::text, '(none)')", join: "" },
  call_type: { level: "lead", key: "l.call_type", join: "" },
  day: { level: "lead", key: "l.lead_day::text", join: "" },
  week: { level: "lead", key: "date_trunc('week', l.lead_day)::date::text", join: "" },
  month: { level: "lead", key: "to_char(l.lead_day, 'YYYY-MM')", join: "" },
  teacher: { level: "item", key: "coalesce(tc.name, '(no detail)')", join: "left join public.teachers tc on tc.id = i.teacher_id" },
  institute: {
    level: "item",
    key: "coalesce(ins.name, '(no detail)')",
    join: "left join public.teachers tc on tc.id = i.teacher_id left join public.institutes ins on ins.id = tc.institute_id",
  },
  course: { level: "item", key: "coalesce(c.name, '(no detail)')", join: "left join public.courses c on c.id = i.course_id" },
  subject: {
    level: "item",
    key: "coalesce(c.name || ' · ' || sb.name, c.name, '(no detail)')",
    join: "left join public.courses c on c.id = i.course_id left join public.subjects sb on sb.id = i.subject_id",
  },
  content: { level: "item", key: "coalesce(ct.name, '(no detail)')", join: "left join public.contents ct on ct.id = i.content_id" },
} as const;

type GroupKey = keyof typeof GROUPS;

function leadSummarySql(group: GroupKey): string {
  const g = GROUPS[group];
  if (g.level === "lead") {
    return `with ${LEADS_CTE},
      won_amount as (
        select enquiry_id, sum(amount) as amt from public.enquiry_items where status = 'won' group by 1)
      select ${g.key} as "group",
             count(*)::int as leads,
             count(*) filter (where l.status = 'won')::int as purchased,
             count(*) filter (where l.status = 'lost' and l.lost_reason = 'competitor')::int as lost_competitor,
             count(*) filter (where l.status = 'lost' and l.lost_reason is distinct from 'competitor')::int as lost_other,
             count(*) filter (where l.status = 'closed')::int as closed_wrong_number,
             count(*) filter (where l.status in ('open', 'working'))::int as still_open,
             round(100.0 * count(*) filter (where l.status = 'won') / nullif(count(*), 0), 1) as conversion_pct,
             coalesce(sum(w.amt), 0) as revenue_recorded
        from leads l
        left join won_amount w on w.enquiry_id = l.id
        ${g.join}
       group by 1
       order by 2 desc, 1`;
  }
  return `with ${LEADS_CTE}
    select ${g.key} as "group",
           count(distinct l.id)::int as leads,
           count(distinct l.id) filter (where i.status = 'won')::int as purchased,
           count(distinct l.id) filter (where i.status = 'competitor' or (l.status = 'lost' and l.lost_reason = 'competitor'))::int as lost_competitor,
           count(distinct l.id) filter (where l.status = 'lost' and l.lost_reason is distinct from 'competitor')::int as lost_other,
           count(distinct l.id) filter (where l.status in ('open', 'working'))::int as still_open,
           round(100.0 * count(distinct l.id) filter (where i.status = 'won') / nullif(count(distinct l.id), 0), 1) as conversion_pct,
           coalesce(sum(i.amount) filter (where i.status = 'won'), 0) as revenue_recorded
      from leads l
      left join public.enquiry_items i on i.enquiry_id = l.id
      ${g.join}
     group by 1
     order by 2 desc, 1`;
}

function normaliseMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export function buildServer(caller: Caller): McpServer {
  const server = new McpServer(
    { name: "calman", title: "Calman", version: "1.0.0" },
    {
      instructions: `${CALMAN_GUIDE}\n\nYou are connected as ${caller.name ?? "a Calman user"} (${caller.role}).`,
    },
  );
  const read = <T>(fn: (db: PoolClient) => Promise<T>) => asUser(caller.userId, "read", fn);
  const write = <T>(fn: (db: PoolClient) => Promise<T>) => asUser(caller.userId, "write", fn);

  server.registerTool(
    "describe_data",
    {
      title: "Describe Calman's data",
      description:
        "Explains Calman's data model and counting rules, and lists every table/view you can read with its columns, plus enum values and master lists (sources, terms, contents, courses). Call this first before writing SQL.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guarded(async () => {
        const schema = await read(async (db) => {
          const cols = await db.query(
            `select c.table_schema || '.' || c.table_name as t,
                    string_agg(c.column_name || ' ' ||
                      case when c.data_type = 'USER-DEFINED' then c.udt_name
                           when c.data_type = 'ARRAY' then c.udt_name
                           else c.data_type end, ', ' order by c.ordinal_position) as cols
               from information_schema.columns c
              where c.table_schema in ('public', 'support', 'accounts')
                and has_table_privilege(quote_ident(c.table_schema) || '.' || quote_ident(c.table_name), 'select')
              group by 1 order by 1`,
          );
          const enums = await db.query(
            `select t.typname as e, string_agg(v.enumlabel, ', ' order by v.enumsortorder) as vals
               from pg_type t join pg_enum v on v.enumtypid = t.oid
               join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'
              group by 1 order by 1`,
          );
          const masters = await db.query(
            `select 'sources' as list, string_agg(name, ', ' order by name) as vals from public.sources where is_active
             union all select 'terms', string_agg(name, ', ' order by sort_order) from public.terms where is_active
             union all select 'contents', string_agg(name, ', ' order by priority) from public.contents where is_active
             union all select 'courses', string_agg(name, ', ' order by sort_order) from public.courses where is_active
             union all select 'counsellors', string_agg(full_name || ' (' || role || ')', ', ' order by full_name)
                         from public.profiles where is_active`,
          );
          return [
            "## Tables and views you can read",
            ...cols.rows.map((r) => `- ${r.t}: ${r.cols}`),
            "",
            "## Enums",
            ...enums.rows.map((r) => `- ${r.e}: ${r.vals}`),
            "",
            "## Active master lists (use run_sql for ids)",
            ...masters.rows.map((r) => `- ${r.list}: ${r.vals ?? "(none)"}`),
          ].join("\n");
        });
        return ok(`${CALMAN_GUIDE}\n\n${schema}`);
      }),
  );

  server.registerTool(
    "run_sql",
    {
      title: "Run a read-only SQL query",
      description:
        "Runs one read-only PostgreSQL query against Calman, as you (row-level security applies). SELECT / WITH / EXPLAIN / TABLE / VALUES / SHOW only; 20 s timeout; up to 1,000 rows (truncated: true when there were more). Timestamps are UTC — convert to Asia/Kolkata for daily figures. Prefer aggregating in SQL. Call describe_data first if you have not.",
      inputSchema: {
        sql: z.string().describe("A single PostgreSQL query."),
        max_rows: z.number().int().min(1).max(MAX_ROWS).optional().describe("Row cap, default 200."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ sql, max_rows }) => guarded(async () => ok(await read((db) => runSql(db, sql, max_rows ?? 200)))),
  );

  server.registerTool(
    "lead_summary",
    {
      title: "Lead funnel summary",
      description:
        "Purchase-lead funnel for a date range (by the day each lead arrived, IST), grouped by one dimension: leads, purchased, lost to competitor, lost other, closed (wrong number), still open, conversion %, and revenue recorded in Calman. Item-level groupings (teacher, institute, course, subject, content) count a lead once under each of its line items, so their rows can add up to more than the total. Uses the same lead definition as Calman's Analytics page.",
      inputSchema: {
        from: DATE.describe("First arrival day, inclusive (YYYY-MM-DD)"),
        to: DATE.describe("Last arrival day, inclusive (YYYY-MM-DD)"),
        group_by: z
          .enum(Object.keys(GROUPS) as [GroupKey, ...GroupKey[]])
          .describe("Dimension to group by"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ from, to, group_by }) =>
      guarded(async () => {
        if (to < from) return fail("`to` is before `from`.");
        const res = await read((db) => db.query(leadSummarySql(group_by), [from, to]));
        return ok({ from, to, group_by, rows: res.rows });
      }),
  );

  server.registerTool(
    "won_sales",
    {
      title: "Sales closed in Calman",
      description:
        "Every line item marked purchased (won) in a date range (IST day of won_at), with the Shopify order id, amount, teacher, institute, course, subject, content, lead source, term, and the counsellor credited. Use order_id to join with Shopify orders. Set include_contacts to add student name and mobile.",
      inputSchema: {
        from: DATE,
        to: DATE,
        include_contacts: z.boolean().optional().describe("Add student name and mobile (default false)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ from, to, include_contacts }) =>
      guarded(async () => {
        if (to < from) return fail("`to` is before `from`.");
        const contacts = include_contacts ? `st.name as student_name, st.mobile,` : "";
        const res = await read((db) =>
          db.query(
            `select (i.won_at at time zone 'Asia/Kolkata')::date as won_day,
                    i.order_id, i.amount, e.id as enquiry_id, ${contacts}
                    tc.name as teacher, ins.name as institute, c.name as course, sb.name as subject,
                    ct.name as content, s.name as source, t.name as term,
                    (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date as lead_day,
                    pc.counsellor
               from public.enquiry_items i
               join public.enquiries e on e.id = i.enquiry_id
               join public.students st on st.id = e.student_id
               left join public.teachers tc on tc.id = i.teacher_id
               left join public.institutes ins on ins.id = tc.institute_id
               left join public.courses c on c.id = i.course_id
               left join public.subjects sb on sb.id = i.subject_id
               left join public.contents ct on ct.id = i.content_id
               left join public.sources s on s.id = e.source_id
               left join public.terms t on t.id = e.term_id
               left join lateral (
                 select p.full_name as counsellor
                   from public.calls cl
                   join public.profiles p on p.id = coalesce(cl.credited_to, cl.called_by)
                  where cl.enquiry_id = e.id and cl.outcome = 'purchased'
                  order by abs(extract(epoch from cl.called_at - i.won_at)) limit 1
               ) pc on true
              where i.status = 'won'
                and e.archived_at is null
                and (i.won_at at time zone 'Asia/Kolkata')::date between $1 and $2
              order by i.won_at
              limit 3001`,
            [from, to],
          ),
        );
        const truncated = res.rows.length > 3000;
        return ok({ from, to, row_count: Math.min(res.rows.length, 3000), truncated, rows: res.rows.slice(0, 3000) });
      }),
  );

  server.registerTool(
    "get_student",
    {
      title: "Look up a student by mobile",
      description:
        "Everything Calman holds on one phone number: the student, every enquiry (source, term, status, importance), its line items (teacher/course/subject/content, outcome, order id, amount), every call with the counsellor's note, WhatsApp sends and current assignments.",
      inputSchema: { mobile: z.string().describe("10-digit Indian mobile; +91, spaces and dashes are ignored") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ mobile }) =>
      guarded(async () => {
        const m = normaliseMobile(mobile);
        if (!m) return fail("That is not a valid 10-digit Indian mobile number.");
        const data = await read(async (db) => {
          const st = await db.query(`select id, mobile, name, created_at from public.students where mobile = $1`, [m]);
          if (!st.rows.length) return null;
          const sid = st.rows[0].id;
          const enquiries = await db.query(
            `select e.id, e.type, e.status, e.lost_reason, e.close_reason, e.importance, e.lead_verification,
                    s.name as source, t.name as term, e.product_text, e.call_type, e.follow_up_slots_used,
                    e.next_follow_up_date, e.arrived_at, e.created_at, e.closed_at, e.re_enquired_at,
                    e.archived_at, e.order_id as ticket_order_id,
                    (select json_agg(json_build_object('teacher', tc.name, 'course', c.name, 'subject', sb.name,
                              'content', ct.name, 'status', i.status, 'order_id', i.order_id, 'amount', i.amount,
                              'won_at', i.won_at) order by i.created_at)
                       from public.enquiry_items i
                       left join public.teachers tc on tc.id = i.teacher_id
                       left join public.courses c on c.id = i.course_id
                       left join public.subjects sb on sb.id = i.subject_id
                       left join public.contents ct on ct.id = i.content_id
                      where i.enquiry_id = e.id) as items,
                    (select json_agg(json_build_object('at', so.occurred_at, 'source', s2.name, 'via', so.added_via)
                              order by so.occurred_at)
                       from public.enquiry_sources so left join public.sources s2 on s2.id = so.source_id
                      where so.enquiry_id = e.id) as arrivals
               from public.enquiries e
               left join public.sources s on s.id = e.source_id
               left join public.terms t on t.id = e.term_id
              where e.student_id = $1
              order by e.created_at`,
            [sid],
          );
          const calls = await db.query(
            `select cl.enquiry_id, cl.called_at, p.full_name as counsellor, cl.outcome, cl.discussion,
                    cl.next_follow_up_date, cl.order_id, cl.is_offer_call, cl.assignment_bucket
               from public.calls cl
               join public.enquiries e on e.id = cl.enquiry_id
               left join public.profiles p on p.id = cl.called_by
              where e.student_id = $1 order by cl.called_at`,
            [sid],
          );
          const whatsapp = await db.query(
            `select w.enquiry_id, w.sent_at, p.full_name as sent_by, w.message_text
               from public.whatsapp_sends w join public.enquiries e on e.id = w.enquiry_id
               left join public.profiles p on p.id = w.sent_by
              where e.student_id = $1 order by w.sent_at`,
            [sid],
          );
          const assignments = await db.query(
            `select a.enquiry_id, a.date, p.full_name as counsellor, a.bucket, a.label
               from public.assignments a join public.enquiries e on e.id = a.enquiry_id
               left join public.profiles p on p.id = a.counsellor_id
              where e.student_id = $1 and a.date >= (now() at time zone 'Asia/Kolkata')::date - 7
              order by a.date`,
            [sid],
          );
          return {
            student: st.rows[0],
            enquiries: enquiries.rows,
            calls: calls.rows,
            whatsapp_sends: whatsapp.rows,
            recent_assignments: assignments.rows,
          };
        });
        return data ? ok(data) : ok(`No student with mobile ${m} in Calman.`);
      }),
  );

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  const ids = z.array(UUID).max(200).optional();

  server.registerTool(
    "create_offer",
    {
      title: "Create an offer",
      description:
        "Creates an offer, like Settings → Offers. Leads with an open line item matching EVERY target list you give (teachers, institutes, courses, subjects, contents — leave a list out to not filter on it) surface to counsellors as Offer calls from end_date − reminder_days to end_date. Look up ids with run_sql first. Created INACTIVE by default so a person can review it in Calman; pass active: true only if the user explicitly asked for it to go live. Confirm the details with the user before calling.",
      inputSchema: {
        name: z.string().min(1).max(120),
        start_date: DATE,
        end_date: DATE,
        reminder_days: z.number().int().min(0).max(365).optional().describe("Days before end_date that calls start; default 0 (last day only)"),
        lookback_days: z.number().int().min(0).max(3650).optional().describe("Only leads that arrived within this many days before start_date; omit for all"),
        teacher_ids: ids,
        institute_ids: ids,
        course_ids: ids,
        subject_ids: ids,
        content_ids: ids,
        active: z.boolean().optional().describe("Default false"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      guarded(async () => {
        if (a.end_date < a.start_date) return fail("end_date is before start_date.");
        const targets = {
          offer_teachers: ["teacher_id", a.teacher_ids],
          offer_institutes: ["institute_id", a.institute_ids],
          offer_courses: ["course_id", a.course_ids],
          offer_subjects: ["subject_id", a.subject_ids],
          offer_contents: ["content_id", a.content_ids],
        } as const;
        if (Object.values(targets).every(([, v]) => !v?.length)) {
          return fail("Give at least one target list; an offer with none would match every open lead.");
        }
        const result = await write(async (db) => {
          const { rows } = await db.query(
            `insert into public.offers (name, start_date, end_date, reminder_days, lookback_days, is_active, created_by)
             values ($1, $2, $3, $4, $5, $6, $7) returning id`,
            [a.name.trim(), a.start_date, a.end_date, a.reminder_days ?? 0, a.lookback_days ?? null, a.active ?? false, caller.userId],
          );
          const id = rows[0].id as string;
          for (const [table, [col, values]] of Object.entries(targets)) {
            const list = [...new Set(values ?? [])];
            if (!list.length) continue;
            await db.query(
              `insert into public.${table} (offer_id, ${col}) select $1, unnest($2::uuid[])`,
              [id, list],
            );
          }
          const count = await db.query(
            `select public.offer_match_count($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::smallint, $7::date) as n`,
            [
              a.teacher_ids ?? [], a.institute_ids ?? [], a.course_ids ?? [], a.subject_ids ?? [], a.content_ids ?? [],
              a.lookback_days ?? null, a.start_date,
            ],
          );
          return { id, matches_open_leads_now: count.rows[0]?.n ?? null };
        });
        return ok({
          created: true,
          offer_id: result.id,
          active: a.active ?? false,
          matches_open_leads_now: result.matches_open_leads_now,
          note: a.active ? "The offer is live." : "Created inactive — switch it on in Calman → Settings → Offers, or with set_offer_active.",
        });
      }),
  );

  server.registerTool(
    "set_offer_active",
    {
      title: "Switch an offer on or off",
      description: "Activates or deactivates an existing offer (offers are never deleted). Confirm with the user first.",
      inputSchema: { offer_id: UUID, active: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ offer_id, active }) =>
      guarded(async () => {
        const res = await write((db) =>
          db.query(`update public.offers set is_active = $2 where id = $1 returning name, start_date, end_date`, [offer_id, active]),
        );
        if (!res.rowCount) return fail("No offer with that id.");
        return ok({ offer: res.rows[0], active });
      }),
  );

  server.registerTool(
    "assign_enquiries",
    {
      title: "Assign leads to a counsellor",
      description:
        "Puts open enquiries on a counsellor's My Day for a date as a named Customised (campaign) list — what the Assignment Desk's campaign mode does. An enquiry already assigned to someone for that date moves to this counsellor. Closed, won, lost or archived enquiries are skipped and reported. Max 500 per call. Confirm the list, counsellor and date with the user first.",
      inputSchema: {
        enquiry_ids: z.array(z.number().int().positive()).min(1).max(500),
        counsellor_id: UUID.describe("profiles.id of an active counsellor or manager"),
        date: DATE.describe("Day the calls should be made (today or later)"),
        label: z.string().min(1).max(80).describe("Name of the list as the counsellor will see it, e.g. 'Bhanwar Borana FT – offer reminder'"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      guarded(async () => {
        if (a.date < todayIst()) return fail("The date is in the past.");
        const result = await write(async (db) => {
          const who = await db.query(
            `select full_name, role from public.profiles where id = $1 and is_active and role in ('counsellor', 'manager', 'super_admin')`,
            [a.counsellor_id],
          );
          if (!who.rowCount) throw new Error("That counsellor id is not an active counsellor or manager.");
          const eligible = await db.query<{ id: string; prior: string | null }>(
            `select e.id, (select p.full_name from public.assignments x join public.profiles p on p.id = x.counsellor_id
                             where x.enquiry_id = e.id and x.date = $2) as prior
               from public.enquiries e
              where e.id = any($1::bigint[]) and e.archived_at is null and e.status in ('open', 'working')`,
            [a.enquiry_ids, a.date],
          );
          const ok_ids = eligible.rows.map((r) => Number(r.id));
          if (ok_ids.length) {
            await db.query(
              `insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by, assigned_at, label)
               select unnest($1::bigint[]), $2, $3, 'campaign', $4, now(), $5
               on conflict (enquiry_id, date) do update
                 set counsellor_id = excluded.counsellor_id, bucket = excluded.bucket,
                     assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at, label = excluded.label`,
              [ok_ids, a.date, a.counsellor_id, caller.userId, a.label.trim()],
            );
          }
          const okSet = new Set(ok_ids);
          return {
            counsellor: who.rows[0].full_name,
            assigned: ok_ids.length,
            moved_from_other_counsellors: eligible.rows.filter((r) => r.prior && r.prior !== who.rows[0].full_name).length,
            skipped_not_open: a.enquiry_ids.filter((id) => !okSet.has(id)),
          };
        });
        return ok({ date: a.date, label: a.label, ...result });
      }),
  );

  server.registerTool(
    "unassign_enquiries",
    {
      title: "Remove leads from a day's assignments",
      description: "Takes enquiries off whoever has them for a date (today or later only — past days feed the reports). Confirm with the user first.",
      inputSchema: {
        enquiry_ids: z.array(z.number().int().positive()).min(1).max(500),
        date: DATE,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ enquiry_ids, date }) =>
      guarded(async () => {
        if (date < todayIst()) return fail("Past days' assignments are part of the reports and cannot be removed.");
        const res = await write((db) =>
          db.query(`delete from public.assignments where date = $1 and enquiry_id = any($2::bigint[])`, [date, enquiry_ids]),
        );
        return ok({ date, removed: res.rowCount ?? 0 });
      }),
  );

  return server;
}
