-- §75.1. The institute and teacher facets count a ticket once per name it carries.
--
-- CREATE OR REPLACE: the signature and returned columns are unchanged.

CREATE OR REPLACE FUNCTION support.queue_facets(p_tab text DEFAULT 'open'::text, p_institute_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_issues text[] DEFAULT NULL::text[], p_follow_from date DEFAULT NULL::date, p_follow_to date DEFAULT NULL::date, p_assigned_to text[] DEFAULT NULL::text[], p_sources text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_escalation_kinds text[] DEFAULT NULL::text[], p_raised_from date DEFAULT NULL::date, p_raised_to date DEFAULT NULL::date, p_age_band text DEFAULT NULL::text, p_due text DEFAULT NULL::text)
 RETURNS TABLE(facet text, value_id text, numbers integer, items integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with cand as materialized (
  select
    t.id, t.institute_ids, t.teacher_ids, t.issues_work, t.assigned_to, t.source,
    t.escalation_kind,
    -- §75.1. Any element the ticket carries.
    (p_institute_id is null or p_institute_id = any (t.institute_ids)) as m_institute,
    (p_teacher_id is null or p_teacher_id = any (t.teacher_ids))       as m_teacher,
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
    and support.tab_matches(t, p_tab)
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
-- §75.1. Counted once per institute the ticket carries, not once per ticket.
-- A ticket spanning two houses is a ticket for each of them, and a facet that
-- counted it once would send whoever clicked the smaller number to a list with
-- more rows in it than the chip promised.
select 'institute', x.institute_id::text, count(*)::integer, 0
  from cand c
  cross join lateral unnest(c.institute_ids) as x(institute_id)
 where c.m_teacher and c.m_issue and c.m_assigned and c.m_source and c.m_kind
 group by 2
union all
select 'teacher', x.teacher_id::text, count(*)::integer, 0
  from cand c
  cross join lateral unnest(c.teacher_ids) as x(teacher_id)
 where c.m_institute and c.m_issue and c.m_assigned and c.m_source and c.m_kind
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
$function$
;

notify pgrst, 'reload schema';
