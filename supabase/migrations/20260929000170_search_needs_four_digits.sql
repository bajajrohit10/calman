-- §61.4 follow-up. The queue's free-text search matched far too much.
--
-- Found while testing the export: searching "ZTEST-61" returned real tickets
-- 74, 76 and 99 alongside the seven test rows. The reason is the mobile branch —
--
--   t.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
--
-- which strips every non-digit from the query and matches the remains anywhere
-- in the number. "ZTEST-61" becomes "61", so it matched every mobile containing
-- those two digits. Harmless-looking on a screen, not harmless on an export the
-- team will act on: the file claimed to be one filter's worth of tickets and was
-- not.
--
-- The digits branch now needs at least four of them, which is the shortest
-- fragment of a phone number anybody actually searches by, and is far longer
-- than the incidental digits in a name or a label. The other branches are
-- unchanged, so "ZI61601" still finds its order and a name still finds its
-- student.
--
-- Extracted into one function while fixing it, because the clause was written
-- out twice — in queue() and in queue_facets() — and a search that means two
-- different things in the list and the counts is what trips the _total guard.

create or replace function support.matches_search(
  t        support.tickets,
  p_search text
)
returns boolean
language sql
immutable
set search_path to ''
as $fn$
  select
    p_search is null or btrim(p_search) = ''
    or (length(regexp_replace(p_search, '\D', '', 'g')) >= 4
        and t.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%')
    or t.mobile_raw ilike '%' || p_search || '%'
    or coalesce(t.order_id_work, t.order_id) ilike '%' || p_search || '%'
    or t.order_id_raw ilike '%' || p_search || '%'
    or t.student_name ilike '%' || p_search || '%';
$fn$;

grant execute on function support.matches_search(support.tickets, text)
  to authenticated, service_role;

drop function if exists support.queue(
  text, text[], uuid, uuid, text[], date, date, text[], text[], text, integer,
  integer, text[], date, date);

create function support.queue(
  p_tab             text    default 'open',
  p_statuses        text[]  default null,
  p_institute_id    uuid    default null,
  p_teacher_id      uuid    default null,
  p_issues          text[]  default null,
  p_follow_from     date    default null,
  p_follow_to       date    default null,
  p_assigned_to     text[]  default null,
  p_sources         text[]  default null,
  p_search          text    default null,
  p_limit           integer default 50,
  p_offset          integer default 0,
  /** §61.2: 'team' and/or 'institute'; only meaningful on the Escalated tab. */
  p_escalation_kinds text[] default null,
  /** §61.3: raised-date window, for the reports' click-through. */
  p_raised_from     date    default null,
  p_raised_to       date    default null
)
returns table (
  id bigint, raised_at timestamptz, age_days integer,
  student_name text, mobile text, mobile_raw text,
  order_id text, order_id_raw text, order_id_work text,
  institute_name text, teacher_name text,
  issues_work text[], issue_other_work text,
  status support.ticket_status, follow_up_date date, overdue boolean,
  assigned_to_name text, assigned_to uuid,
  escalated_to_name text,
  escalation_kind text, escalated_label text,
  last_touched_at timestamptz, source support.ticket_source,
  child_count integer,
  total_count bigint
)
language sql
stable
set search_path to ''
as $function$
with base as (
  select
    t.id, t.raised_at, support.age_days(t.raised_at) as age_days,
    t.student_name, t.mobile, t.mobile_raw,
    t.order_id, t.order_id_raw, t.order_id_work,
    i.name as institute_name, tc.name as teacher_name,
    t.issues_work, t.issue_other_work,
    t.status, t.follow_up_date,
    (t.follow_up_date is not null
       and t.follow_up_date < app.ist_today()
       and t.status <> 'resolved')                as overdue,
    ap.full_name as assigned_to_name, t.assigned_to,
    ep.full_name as escalated_to_name,
    t.escalation_kind,
    -- §61.2. Who the ticket is with, in one column, so the row does not have to
    -- branch on the kind to print an arrow.
    case t.escalation_kind
      when 'team'      then ep.full_name
      when 'institute' then i.name
    end                                           as escalated_label,
    t.last_touched_at, t.source,
    (select count(*)::integer from support.tickets c where c.parent_ticket_id = t.id)
      as child_count
  from support.tickets t
  left join public.institutes i on i.id = t.institute_id
  left join public.teachers   tc on tc.id = t.teacher_id
  left join public.profiles   ap on ap.id = t.assigned_to
  left join public.profiles   ep on ep.id = t.escalated_to
  where t.parent_ticket_id is null
    and case coalesce(p_tab, 'open')
          when 'all'      then true
          when 'resolved' then t.status = 'resolved'
          when 'open'     then t.status <> 'resolved'
          else t.status::text = p_tab
        end
    and (p_statuses is null or cardinality(p_statuses) = 0
         or t.status::text = any (p_statuses))
    and (p_escalation_kinds is null or cardinality(p_escalation_kinds) = 0
         or t.escalation_kind = any (p_escalation_kinds))
    and (p_institute_id is null or t.institute_id = p_institute_id)
    and (p_teacher_id is null or t.teacher_id = p_teacher_id)
    and (p_issues is null or cardinality(p_issues) = 0
         or t.issues_work && p_issues)
    and (p_follow_from is null or t.follow_up_date >= p_follow_from)
    and (p_follow_to is null or t.follow_up_date <= p_follow_to)
    -- §61.3. Raised, in IST calendar days — the form's timestamp, not when the
    -- webhook happened to deliver it.
    and (p_raised_from is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date >= p_raised_from)
    and (p_raised_to is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date <= p_raised_to)
    and (p_assigned_to is null or cardinality(p_assigned_to) = 0
         or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
         or (t.assigned_to is null and 'nobody' = any (p_assigned_to)))
    and (p_sources is null or cardinality(p_sources) = 0
         or t.source::text = any (p_sources))
    and support.matches_search(t, p_search)
)
select b.*, count(*) over () as total_count
from base b
order by b.overdue desc,
         b.follow_up_date asc nulls last,
         b.raised_at asc,
         b.id asc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

grant execute on function support.queue(
  text, text[], uuid, uuid, text[], date, date, text[], text[], text, integer,
  integer, text[], date, date
) to authenticated, service_role;

drop function if exists support.queue_facets(
  text, uuid, uuid, text[], date, date, text[], text[], text, text[], date, date);

create function support.queue_facets(
  p_tab             text    default 'open',
  p_institute_id    uuid    default null,
  p_teacher_id      uuid    default null,
  p_issues          text[]  default null,
  p_follow_from     date    default null,
  p_follow_to       date    default null,
  p_assigned_to     text[]  default null,
  p_sources         text[]  default null,
  p_search          text    default null,
  p_escalation_kinds text[] default null,
  p_raised_from     date    default null,
  p_raised_to       date    default null
)
returns table (facet text, value_id text, numbers integer, items integer)
language sql
stable
set search_path to ''
as $function$
with cand as materialized (
  select
    t.id, t.institute_id, t.teacher_id, t.issues_work, t.assigned_to, t.source,
    t.escalation_kind,
    (p_institute_id is null or t.institute_id = p_institute_id) as m_institute,
    (p_teacher_id is null or t.teacher_id = p_teacher_id)       as m_teacher,
    (p_issues is null or cardinality(p_issues) = 0
       or t.issues_work && p_issues)                            as m_issue,
    (p_assigned_to is null or cardinality(p_assigned_to) = 0
       or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
       or (t.assigned_to is null and 'nobody' = any (p_assigned_to))) as m_assigned,
    (p_sources is null or cardinality(p_sources) = 0
       or t.source::text = any (p_sources))                     as m_source,
    (p_escalation_kinds is null or cardinality(p_escalation_kinds) = 0
       or t.escalation_kind = any (p_escalation_kinds))          as m_kind
  from support.tickets t
  where t.parent_ticket_id is null
    and case coalesce(p_tab, 'open')
          when 'all'      then true
          when 'resolved' then t.status = 'resolved'
          when 'open'     then t.status <> 'resolved'
          else t.status::text = p_tab
        end
    and (p_follow_from is null or t.follow_up_date >= p_follow_from)
    and (p_follow_to is null or t.follow_up_date <= p_follow_to)
    and (p_raised_from is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date >= p_raised_from)
    and (p_raised_to is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date <= p_raised_to)
    and support.matches_search(t, p_search)
)
select 'institute', c.institute_id::text, count(*)::integer, 0
  from cand c
 where c.m_teacher and c.m_issue and c.m_assigned and c.m_source and c.m_kind
   and c.institute_id is not null
 group by 2
union all
select 'teacher', c.teacher_id::text, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_issue and c.m_assigned and c.m_source and c.m_kind
   and c.teacher_id is not null
 group by 2
union all
select 'issue', x.issue, count(distinct c.id)::integer, count(*)::integer
  from cand c
  cross join lateral unnest(c.issues_work) as x(issue)
 where c.m_institute and c.m_teacher and c.m_assigned and c.m_source and c.m_kind
 group by 2
union all
select 'assigned_to', coalesce(c.assigned_to::text, 'nobody'), count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_source and c.m_kind
 group by 2
union all
select 'source', c.source::text, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned and c.m_kind
 group by 2
union all
select 'escalation_kind', c.escalation_kind, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned and c.m_source
   and c.escalation_kind is not null
 group by 2
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned and c.m_source
   and c.m_kind;
$function$;

grant execute on function support.queue_facets(
  text, uuid, uuid, text[], date, date, text[], text[], text, text[], date, date
) to authenticated, service_role;

notify pgrst, 'reload schema';
