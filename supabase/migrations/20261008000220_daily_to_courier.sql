-- §77.2. The per-day table gains a "To courier" column.
--
-- DROP first: a new column in a `returns table` changes the return type.
drop function if exists support.report_daily(date, date, uuid, uuid, text[]);

CREATE OR REPLACE FUNCTION support.report_daily(p_from date, p_to date, p_institute_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_assigned_to text[] DEFAULT NULL::text[])
 RETURNS TABLE(day date, raised integer, resolved integer, escalated_team integer, escalated_institute integer, set_future integer, to_courier integer, handed_over integer, open_at_eod integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
           -- §77.2. Sent to our courier. Counted apart from the escalations
           -- because nobody was asked to act — the team is waiting.
           when e.kind = 'status_change' and e.detail ->> 'new' = 'courier'
             then 'to_courier'
           -- §65.3. Its own kind, so it is never counted as an escalation. A
           -- hand-over sets the status to 'new', which the escalation tests
           -- above would miss anyway — this makes the column possible, not just
           -- the exclusion safe.
           when e.kind = 'handover' then 'handed_over'
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
  (select count(*)::integer from moved m where m.day = d.day and m.what = 'to_courier'),
  (select count(*)::integer from moved m where m.day = d.day and m.what = 'handed_over'),
  (select count(*)::integer
     from closed_by c
    where c.day = d.day
      and coalesce(c.was_resolved, false) = false
      and not exists (
        select 1 from scoped s2
         where s2.id = c.id and s2.merged_on is not null and s2.merged_on <= d.day))
  from days d
 order by d.day;
$function$
;

grant execute on function support.report_daily(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
