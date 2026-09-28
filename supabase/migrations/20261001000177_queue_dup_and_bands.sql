-- §63.1 and §63.2. The queue carries the duplicate suggestion, and can be
-- filtered by ageing band and by when a ticket is due.
--
-- Dropped and recreated because both the signature and the return type change.

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
  p_raised_to       date    default null,
  /** §63.2: '0-3' | '4-5' | '6-10' | 'over-10' | 'over-3', from the reports. */
  p_age_band        text    default null,
  /** §63.2: 'overdue' | 'today' | 'future' | 'none', from the reports. */
  p_due             text    default null
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
  /** §63.1: the other half of a live duplicate suggestion, or null. */
  duplicate_of bigint,
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
      as child_count,
    dup.other_ticket_id as duplicate_of
  from support.tickets t
  left join public.institutes i on i.id = t.institute_id
  left join public.teachers   tc on tc.id = t.teacher_id
  left join public.profiles   ap on ap.id = t.assigned_to
  left join public.profiles   ep on ep.id = t.escalated_to
  left join lateral support.duplicate_candidate_of(t.id) dup on true
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
$function$;

grant execute on function support.queue(
  text, text[], uuid, uuid, text[], date, date, text[], text[], text, integer,
  integer, text[], date, date, text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
