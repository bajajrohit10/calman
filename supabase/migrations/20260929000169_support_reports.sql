-- §61.3. The Support reports.
--
-- Its own functions, deliberately not reusing anything the counselling reports
-- do: those read public.enquiries and carry its follow-up-slot rules, and
-- borrowing them would tie this module's numbers to a pipeline it has nothing
-- to do with. Six small functions sharing one filter shape instead.
--
-- Three rules hold across all of them:
--
--   * "Raised" is raised_at — the form's own timestamp — not created_at, which
--     is when the webhook happened to deliver the row. A file replayed a day
--     late must not make every ticket in it look a day newer.
--   * Every date is an IST calendar date. Ages are day differences, so a ticket
--     raised at 23:50 and read at 00:10 is one day old, not one hour.
--   * Merged children are excluded everywhere. A duplicate is not a second
--     complaint, and counting it twice would overstate every figure on the page.

-- The filter set every report below takes. Kept as a comment rather than a
-- composite type: PostgREST cannot pass one of those from the client.
--
--   p_from, p_to        raised-date window, inclusive, IST
--   p_institute_id      one institute
--   p_teacher_id        one teacher
--   p_assigned_to       profile ids, plus the literal 'nobody'

-- The scope test, in one place, so six reports cannot come to disagree about
-- what "this month, this institute" means.
create or replace function support.in_report_scope(
  t              support.tickets,
  p_from         date,
  p_to           date,
  p_institute_id uuid,
  p_teacher_id   uuid,
  p_assigned_to  text[]
)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select
    (p_from is null or (t.raised_at at time zone 'Asia/Kolkata')::date >= p_from)
    and (p_to is null or (t.raised_at at time zone 'Asia/Kolkata')::date <= p_to)
    and (p_institute_id is null or t.institute_id = p_institute_id)
    and (p_teacher_id is null or t.teacher_id = p_teacher_id)
    and (p_assigned_to is null or cardinality(p_assigned_to) = 0
         or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
         or (t.assigned_to is null and 'nobody' = any (p_assigned_to)));
$function$;

grant execute on function support.in_report_scope(
  support.tickets, date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Open tickets by status, with the escalations split.
-- ---------------------------------------------------------------------------
create or replace function support.report_open_by_status(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (bucket text, n integer)
language sql
stable
set search_path to ''
as $function$
with open as (
  select t.status, t.escalation_kind
    from support.tickets t
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
)
-- Every bucket on every render, zeros included: a status that vanishes when it
-- empties reads as a bug, and the reader cannot tell "none" from "not measured".
select b.bucket, count(o.status)::integer
  from (values ('new'), ('working'), ('escalated_team'), ('escalated_institute'), ('future'))
         as b(bucket)
  left join open o
    on b.bucket = case
                    when o.status = 'escalated'
                      then 'escalated_' || coalesce(o.escalation_kind, 'team')
                    else o.status::text
                  end
 group by b.bucket;
$function$;

grant execute on function support.report_open_by_status(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Open by institute, and open by issue. Busiest first.
-- ---------------------------------------------------------------------------
create or replace function support.report_open_by_institute(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (institute_id uuid, institute_name text, n integer)
language sql
stable
set search_path to ''
as $function$
  select t.institute_id,
         -- A ticket whose faculty text matched nothing is a real and useful
         -- row here: it is the queue of things nobody has filed yet.
         coalesce(i.name, 'Not matched') as institute_name,
         count(*)::integer
    from support.tickets t
    left join public.institutes i on i.id = t.institute_id
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
   group by 1, 2
   order by 3 desc, 2;
$function$;

grant execute on function support.report_open_by_institute(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

create or replace function support.report_open_by_issue(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (issue text, n integer)
language sql
stable
set search_path to ''
as $function$
with open as (
  select t.id, t.issues_work, t.issue_other_work
    from support.tickets t
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
)
-- One ticket can carry several issues, so the counts here sum to more than the
-- ticket count — as they should, since the question is "how much of each kind
-- of problem is open".
select x.issue, count(distinct o.id)::integer
  from open o
  cross join lateral unnest(o.issues_work) as x(issue)
 group by 1
union all
-- Tickets whose only issue is free text would otherwise be invisible, and 11%
-- of the historic feed is exactly that.
select 'Other (free text)', count(*)::integer
  from open o
 where cardinality(o.issues_work) = 0 and o.issue_other_work is not null
having count(*) > 0
 order by 2 desc, 1;
$function$;

grant execute on function support.report_open_by_issue(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Ageing of open tickets: 0–3 / 4–7 / 8+ days since raised.
-- ---------------------------------------------------------------------------
--
-- Boundaries are inclusive on both sides and match the queue's red badge, which
-- turns on ABOVE three days — so exactly 3 is the last day of the first bucket
-- and 4 is the first of the second.
create or replace function support.report_ageing(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (bucket text, n integer)
language sql
stable
set search_path to ''
as $function$
with open as (
  select support.age_days(t.raised_at) as age
    from support.tickets t
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
)
select b.bucket, count(o.age)::integer
  from (values ('0-3'), ('4-7'), ('8+')) as b(bucket)
  left join open o
    on b.bucket = case
                    when o.age <= 3 then '0-3'
                    when o.age <= 7 then '4-7'
                    else '8+'
                  end
 group by b.bucket;
$function$;

grant execute on function support.report_ageing(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Resolved per person per day.
-- ---------------------------------------------------------------------------
--
-- "Person" is who saved the Resolved action — tickets.resolved_by, which
-- save_ticket_action stamps from auth.uid() at the moment the outcome became
-- resolved. Not the assignee: the question this answers is who closed it.
--
-- Scoped by resolved_at rather than raised_at, because a report of work done in
-- a range means work done in that range, whenever the ticket arrived. The other
-- filters still read raised-date scope for institute and teacher, which they get
-- from the ticket itself.
create or replace function support.report_resolved_per_person(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (person_id uuid, person_name text, day date, n integer)
language sql
stable
set search_path to ''
as $function$
  select t.resolved_by,
         coalesce(p.full_name, '(unknown)'),
         (t.resolved_at at time zone 'Asia/Kolkata')::date,
         count(*)::integer
    from support.tickets t
    left join public.profiles p on p.id = t.resolved_by
   where t.parent_ticket_id is null
     and t.status = 'resolved'
     and t.resolved_at is not null
     and (p_from is null or (t.resolved_at at time zone 'Asia/Kolkata')::date >= p_from)
     and (p_to is null or (t.resolved_at at time zone 'Asia/Kolkata')::date <= p_to)
     and (p_institute_id is null or t.institute_id = p_institute_id)
     and (p_teacher_id is null or t.teacher_id = p_teacher_id)
     and (p_assigned_to is null or cardinality(p_assigned_to) = 0
          or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
          or (t.assigned_to is null and 'nobody' = any (p_assigned_to)))
   group by 1, 2, 3
   order by 2, 3;
$function$;

grant execute on function support.report_resolved_per_person(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Average days to resolve, overall and per institute.
-- ---------------------------------------------------------------------------
--
-- raised_at → resolved_at, in IST calendar days, for tickets resolved in the
-- range. The count travels with every average because an average of one is not
-- a measurement, and a page of bare averages invites exactly that mistake.
create or replace function support.report_time_to_resolve(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (
  scope text, institute_id uuid, institute_name text,
  tickets integer, avg_days numeric, median_days numeric,
  min_days integer, max_days integer
)
language sql
stable
set search_path to ''
as $function$
with done as (
  select t.institute_id,
         i.name as institute_name,
         ((t.resolved_at at time zone 'Asia/Kolkata')::date
          - (t.raised_at at time zone 'Asia/Kolkata')::date) as days
    from support.tickets t
    left join public.institutes i on i.id = t.institute_id
   where t.parent_ticket_id is null
     and t.status = 'resolved'
     and t.resolved_at is not null
     and (p_from is null or (t.resolved_at at time zone 'Asia/Kolkata')::date >= p_from)
     and (p_to is null or (t.resolved_at at time zone 'Asia/Kolkata')::date <= p_to)
     and (p_institute_id is null or t.institute_id = p_institute_id)
     and (p_teacher_id is null or t.teacher_id = p_teacher_id)
     and (p_assigned_to is null or cardinality(p_assigned_to) = 0
          or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
          or (t.assigned_to is null and 'nobody' = any (p_assigned_to)))
)
select 'overall', null::uuid, null::text,
       count(*)::integer,
       round(avg(days)::numeric, 1),
       -- The median as well as the mean: one ticket that sat for three months
       -- drags an average of twenty a long way, and the team would rather know
       -- both than argue about which is fair.
       round(percentile_cont(0.5) within group (order by days)::numeric, 1),
       min(days)::integer, max(days)::integer
  from done
 having count(*) > 0
union all
select 'institute', d.institute_id, coalesce(d.institute_name, 'Not matched'),
       count(*)::integer,
       round(avg(days)::numeric, 1),
       round(percentile_cont(0.5) within group (order by days)::numeric, 1),
       min(days)::integer, max(days)::integer
  from done d
 group by d.institute_id, d.institute_name
 order by 1 desc, 4 desc, 3;
$function$;

grant execute on function support.report_time_to_resolve(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Escalated to Institute, still open, oldest first.
-- ---------------------------------------------------------------------------
--
-- The list this whole brief is really for: tickets sitting with an institute
-- that nobody has chased. No date-range filter on purpose — an escalation that
-- has been outstanding since before the window is exactly the one worth seeing.
create or replace function support.report_institute_escalations(
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (
  id bigint, institute_id uuid, institute_name text,
  student_name text, mobile text, order_id text,
  raised_at timestamptz, age_days integer,
  follow_up_date date, overdue boolean,
  assigned_to_name text
)
language sql
stable
set search_path to ''
as $function$
  select t.id, t.institute_id, i.name,
         t.student_name, t.mobile, coalesce(t.order_id_work, t.order_id),
         t.raised_at, support.age_days(t.raised_at),
         t.follow_up_date,
         (t.follow_up_date is not null and t.follow_up_date < app.ist_today()),
         p.full_name
    from support.tickets t
    left join public.institutes i on i.id = t.institute_id
    left join public.profiles p on p.id = t.assigned_to
   where t.parent_ticket_id is null
     and t.status = 'escalated'
     and t.escalation_kind = 'institute'
     and (p_institute_id is null or t.institute_id = p_institute_id)
     and (p_teacher_id is null or t.teacher_id = p_teacher_id)
     and (p_assigned_to is null or cardinality(p_assigned_to) = 0
          or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
          or (t.assigned_to is null and 'nobody' = any (p_assigned_to)))
   order by t.raised_at asc, t.id asc;
$function$;

grant execute on function support.report_institute_escalations(
  uuid, uuid, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
