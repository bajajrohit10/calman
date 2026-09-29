-- §75.1. The queue reads every institute and teacher a ticket carries.
--
-- The name columns were a join on the single id, so a ticket spanning two houses
-- printed one of them; the filters matched the first only, so filtering by the
-- second found nothing. Both now read the arrays, and the escalated label names
-- the institute the escalation actually went to rather than whichever happened
-- to be first.
--
-- CREATE OR REPLACE: the signature and the returned columns are unchanged — the
-- two name columns carry a joined list where they used to carry one name.

CREATE OR REPLACE FUNCTION support.queue(p_tab text DEFAULT 'open'::text, p_statuses text[] DEFAULT NULL::text[], p_institute_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_issues text[] DEFAULT NULL::text[], p_follow_from date DEFAULT NULL::date, p_follow_to date DEFAULT NULL::date, p_assigned_to text[] DEFAULT NULL::text[], p_sources text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_escalation_kinds text[] DEFAULT NULL::text[], p_raised_from date DEFAULT NULL::date, p_raised_to date DEFAULT NULL::date, p_age_band text DEFAULT NULL::text, p_due text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, raised_at timestamp with time zone, age_days integer, student_name text, mobile text, mobile_raw text, order_id text, order_id_raw text, order_id_work text, institute_name text, teacher_name text, issues_work text[], issue_other_work text, status support.ticket_status, follow_up_date date, overdue boolean, assigned_to_name text, assigned_to uuid, escalated_to_name text, escalation_kind text, escalated_label text, last_touched_at timestamp with time zone, source support.ticket_source, child_count integer, duplicate_of bigint, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with base as (
  select
    t.id, t.raised_at, support.age_days(t.raised_at) as age_days,
    t.student_name, t.mobile, t.mobile_raw,
    t.order_id, t.order_id_raw, t.order_id_work,
    -- §75.1. Every institute and teacher the ticket carries, in master order so
    -- the same ticket reads the same way twice. " | " is the join the export
    -- already uses, so a column and a spreadsheet cell agree.
    (select string_agg(i2.name, ' | ' order by i2.name)
       from public.institutes i2 where i2.id = any (t.institute_ids))  as institute_name,
    (select string_agg(tc2.name, ' | ' order by tc2.name)
       from public.teachers tc2 where tc2.id = any (t.teacher_ids))    as teacher_name,
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
      -- §75.1. The one it went to, where that was chosen; otherwise the only one
      -- it carries. Never a silent pick from several.
      when 'institute' then coalesce(
        (select i3.name from public.institutes i3 where i3.id = t.escalated_institute_id),
        (select i4.name from public.institutes i4
          where i4.id = any (t.institute_ids)
            and cardinality(t.institute_ids) = 1))
    end                                           as escalated_label,
    t.last_touched_at, t.source,
    (select count(*)::integer from support.tickets c where c.parent_ticket_id = t.id)
      as child_count,
    dup.other_ticket_id as duplicate_of
  from support.tickets t
  left join public.profiles   ap on ap.id = t.assigned_to
  left join public.profiles   ep on ep.id = t.escalated_to
  left join lateral support.duplicate_candidate_of(t.id) dup on true
  where t.parent_ticket_id is null
    and support.tab_matches(t, p_tab)
    and (p_statuses is null or cardinality(p_statuses) = 0
         or t.status::text = any (p_statuses))
    and (p_escalation_kinds is null or cardinality(p_escalation_kinds) = 0
         or t.escalation_kind = any (p_escalation_kinds))
    -- §75.1. Any element the ticket carries, so filtering by the second
    -- institute finds it just as the first does.
    and (p_institute_id is null or p_institute_id = any (t.institute_ids))
    and (p_teacher_id is null or p_teacher_id = any (t.teacher_ids))
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
    -- §63.2. The ageing bands the reports link through with. Inclusive both
    -- ends, and each ticket falls in exactly one — except 'over-3', which is the
    -- roll-up the report shows beside them.
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
select b.*, count(*) over () as total_count
from base b
order by b.overdue desc,
         b.follow_up_date asc nulls last,
         b.raised_at asc,
         b.id asc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$
;

notify pgrst, 'reload schema';
