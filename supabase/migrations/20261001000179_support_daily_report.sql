-- §63.2. The daily table, the as-on-today snapshot, and new ageing bands.

-- ---------------------------------------------------------------------------
-- 1. Ageing bands: 0–3 / 4–5 / 6–10 / over 10.
-- ---------------------------------------------------------------------------
--
-- Replaces 0–3 / 4–7 / 8+. Every ticket falls in exactly one band; 'over-3' is
-- a roll-up shown beside them, not a sixth band, so the four still sum to the
-- open total.
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
  from (values ('0-3'), ('4-5'), ('6-10'), ('over-10')) as b(bucket)
  left join open o
    on b.bucket = case
                    when o.age <= 3  then '0-3'
                    when o.age <= 5  then '4-5'
                    when o.age <= 10 then '6-10'
                    else 'over-10'
                  end
 group by b.bucket
union all
-- The roll-up the team actually chases. Deliberately overlaps the bands above.
select 'over-3', count(*)::integer from open o where o.age > 3;
$function$;

grant execute on function support.report_ageing(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Open by follow-up date, as on today.
-- ---------------------------------------------------------------------------
create or replace function support.report_open_by_due(
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
  select t.follow_up_date as d
    from support.tickets t
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
)
select b.bucket, count(o.d) filter (where b.bucket <> 'none')::integer
         + case when b.bucket = 'none'
                then (select count(*)::integer from open where d is null) else 0 end
  from (values ('overdue'), ('today'), ('future'), ('none')) as b(bucket)
  left join open o
    on o.d is not null
   and b.bucket = case
                    when o.d < app.ist_today() then 'overdue'
                    when o.d = app.ist_today() then 'today'
                    else 'future'
                  end
 group by b.bucket;
$function$;

grant execute on function support.report_open_by_due(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The daily table.
-- ---------------------------------------------------------------------------
--
-- One row per calendar day in the range, in IST. The activity columns are
-- counted from support.events by the day the event happened, distinct per
-- ticket — a ticket escalated twice on a Tuesday is one escalation on Tuesday,
-- because the question is "how much moved that day", not "how many clicks".
--
-- Escalations are read from the status_change event's detail rather than from
-- the ticket's current state: the point of a daily table is what happened then,
-- and the ticket has since moved on.
--
-- "Open at end of day" is a different kind of question — a position, not an
-- activity — so it is computed per day from the tickets themselves: raised on or
-- before that day, and neither resolved nor merged by the end of it. Resolution
-- is read from the event log, not from resolved_at, so a ticket resolved on the
-- Monday and reopened on the Wednesday is correctly shown as closed on Tuesday.
create or replace function support.report_daily(
  p_from         date,
  p_to           date,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (
  day date, raised integer, resolved integer,
  escalated_team integer, escalated_institute integer,
  set_future integer, open_at_eod integer
)
language sql
stable
set search_path to ''
as $function$
with days as (
  select d::date as day
    from generate_series(p_from, p_to, interval '1 day') d
),
-- Every ticket in scope, once, with the two dates the position column needs.
scoped as (
  select t.id,
         (t.raised_at at time zone 'Asia/Kolkata')::date as raised_on,
         (t.merged_at at time zone 'Asia/Kolkata')::date as merged_on
    from support.tickets t
   where support.in_report_scope(t, null, null, p_institute_id, p_teacher_id, p_assigned_to)
),
-- The events that make up the activity columns, already reduced to one row per
-- ticket per day per kind of movement.
moved as (
  select distinct
         (e.at at time zone 'Asia/Kolkata')::date as day,
         e.ticket_id,
         case
           when e.kind = 'resolved' then 'resolved'
           when e.kind = 'status_change' and e.detail ->> 'new' = 'escalated'
             then 'escalated_' || coalesce(e.detail ->> 'escalation_kind', 'team')
           when e.kind = 'status_change' and e.detail ->> 'new' = 'future'
             then 'set_future'
         end as what
    from support.events e
    join scoped s on s.id = e.ticket_id
   where (e.at at time zone 'Asia/Kolkata')::date between p_from and p_to
),
-- Resolved as at the end of each day: the latest resolved/reopened event on or
-- before that day, and whether it was a resolution.
closed_by as (
  select d.day, s.id,
         (select e.kind = 'resolved'
            from support.events e
           where e.ticket_id = s.id
             and e.kind in ('resolved', 'reopened')
             and (e.at at time zone 'Asia/Kolkata')::date <= d.day
           order by e.at desc, e.id desc
           limit 1) as was_resolved
    from days d
    join scoped s on s.raised_on <= d.day
)
select
  d.day,
  (select count(*)::integer from scoped s where s.raised_on = d.day),
  (select count(*)::integer from moved m where m.day = d.day and m.what = 'resolved'),
  (select count(*)::integer from moved m where m.day = d.day and m.what = 'escalated_team'),
  (select count(*)::integer from moved m where m.day = d.day and m.what = 'escalated_institute'),
  (select count(*)::integer from moved m where m.day = d.day and m.what = 'set_future'),
  (select count(*)::integer
     from closed_by c
    where c.day = d.day
      and coalesce(c.was_resolved, false) = false
      and not exists (
        select 1 from scoped s2
         where s2.id = c.id and s2.merged_on is not null and s2.merged_on <= d.day))
  from days d
 order by d.day;
$function$;

grant execute on function support.report_daily(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
