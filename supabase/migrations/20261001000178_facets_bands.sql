-- §63.2. The facet counts learn the ageing band and the due filter.
--
-- The list already knows them (migration 177). If the counts do not, a report
-- click-through narrows one and not the other, facetsAgreeWithList sees a
-- mismatch and hides the entire filter bar — the same failure Brief 61 had when
-- tab=open silently fell back to New.

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
  p_raised_to       date    default null,
  p_age_band        text    default null,
  p_due             text    default null
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
    -- §63.2. Same two predicates as the list. Without them a report linking
    -- through with an ageing band narrows the list and not the counts, the
    -- _total guard disagrees, and the whole filter bar hides itself — which is
    -- exactly what happened in Brief 61 when tab=open was not understood.
    and (p_age_band is null or case p_age_band
           when '0-3'     then support.age_days(t.raised_at) between 0 and 3
           when '4-5'     then support.age_days(t.raised_at) between 4 and 5
           when '6-10'    then support.age_days(t.raised_at) between 6 and 10
           when 'over-10' then support.age_days(t.raised_at) > 10
           when 'over-3'  then support.age_days(t.raised_at) > 3
           else true
         end)
    and (p_due is null or case p_due
           when 'overdue' then t.follow_up_date is not null
                               and t.follow_up_date < app.ist_today()
           when 'today'   then t.follow_up_date = app.ist_today()
           when 'future'  then t.follow_up_date > app.ist_today()
           when 'none'    then t.follow_up_date is null
           else true
         end)
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
  text, uuid, uuid, text[], date, date, text[], text[], text, text[], date, date,
  text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
