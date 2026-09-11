-- Brief 19: what the desk still needs handing out, and what it was handed out as.
--
-- 1. The assignment filter stops being a fact about the row and becomes a
--    question about the work. "Unassigned" was almost right and quietly wrong:
--    a lead assigned this morning and already called is not work in hand, it is
--    work finished, and it belongs back on the list a manager is working down.
--    So the states are Needs assignment / Pending / Done / Any, and a lead
--    leaves the default view the moment somebody is given it and comes back
--    only once they have logged the call.
--
-- 2. Campaign assignments get a label, so "Evening call backs" is a thing My
--    Day can group by rather than a filter the counsellor never sees.
--
-- 3. Importance becomes a multi-select everywhere it is offered — A alone is
--    the PLI question, but A and B together is the "who is worth an hour"
--    question, and the filter could not express it.

alter table public.assignments
  add column if not exists label text;

comment on column public.assignments.label is
  'What this campaign assignment was handed out as ("Evening call backs"). '
  'Null for the ordinary buckets, which are named by the bucket itself.';


-- ---- recommended_calls -------------------------------------------------
drop function if exists public.recommended_calls;
CREATE FUNCTION public.recommended_calls(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_assignment text DEFAULT NULL::text, p_last_called_by uuid[] DEFAULT NULL::uuid[], p_last_outcomes text[] DEFAULT NULL::text[], p_no_detail text[] DEFAULT NULL::text[])
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, is_overdue boolean, due_date date, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_id uuid, term_name text, source_id uuid, source_name text, product_text text, next_follow_up_date date, created_at timestamp with time zone, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, assigned_to uuid, assigned_to_name text, stage text, last_outcome call_outcome, last_called_by uuid, last_called_by_name text, assigned_at timestamp with time zone, assignment_label text, called_since boolean, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_no_detail, '{}'::text[]) as nd
),
base as (
  select
    e.id as enquiry_id,
    case
      when e.fresh_call_date is null then 'fresh'::public.assignment_bucket
      when lc.outcome = 'call_back' then 'call_back'::public.assignment_bucket
      else 'follow_up'::public.assignment_bucket
    end as bucket,
    case
      when e.next_follow_up_date is not null and e.next_follow_up_date < t.d
        then true else false
    end as is_overdue,
    case
      when e.fresh_call_date is null then t.d
      when e.next_follow_up_date is null then null
      else app.next_working_day(greatest(e.next_follow_up_date, t.d))
    end as due_date,
    e.student_id, e.type, e.status, e.importance, e.term_id, e.source_id,
    e.product_text, e.next_follow_up_date, e.created_at,
    e.follow_up_slots_used, e.top_content_priority,
    a.counsellor_id as assigned_to,
    a.assigned_at,
    a.label as assignment_label,
    coalesce(a.called_since, false) as called_since,
    lc.outcome as last_outcome,
    lc.called_by as last_called_by,
    app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome) as stage,
    t.d as target_date
  from public.live_enquiries e
  cross join target t
  -- One indexed lookup each, not a correlated subquery per output column.
  left join lateral (
    select a2.counsellor_id, a2.assigned_at, a2.label,
           exists (
             select 1 from public.calls c3
              where c3.enquiry_id = e.id
                and c3.call_date = t.d
                and c3.called_at > a2.assigned_at
           ) as called_since
      from public.assignments a2
     where a2.enquiry_id = e.id and a2.date = t.d
     limit 1
  ) a on true
  left join lateral (
    select c2.outcome, c2.called_by
      from public.calls c2
     where c2.enquiry_id = e.id
     order by c2.call_date desc, c2.called_at desc, c2.id desc
     limit 1
  ) lc on true
  where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
    and e.status = coalesce(p_status, 'open'::public.enquiry_status)
    and (e.created_at at time zone 'Asia/Kolkata')::date <= t.d
    and (p_counsellor_id is null or a.counsellor_id = p_counsellor_id)
    and (case p_assignment
           when 'needs'   then a.counsellor_id is null or a.called_since
           when 'pending' then a.counsellor_id is not null and not a.called_since
           when 'done'    then a.counsellor_id is not null and a.called_since
           else true
         end)
    and ((p_last_called_by is null or cardinality(p_last_called_by) = 0)
         or lc.called_by = any (p_last_called_by))
    and ((p_last_outcomes is null or cardinality(p_last_outcomes) = 0)
         or lc.outcome::text = any (p_last_outcomes))
    and (p_source_id is null or e.source_id = p_source_id)
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
    and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    -- ---- facet predicates, each with its optional "no detail" branch -------
    -- Written as CASE rather than through a helper so the unfiltered case
    -- short-circuits: a function's arguments are always evaluated, which would
    -- mean running all seven exists() per row on a desk with no filters set.
    and (case
           when not ('term' = any (t.nd)) and (p_term_id is null)
             then true
           else (not (p_term_id is null) and e.term_id = p_term_id)
                or ('term' = any (t.nd) and e.term_id is null)
         end)
    and (case
           when not ('importance' = any (t.nd)) and (p_importance is null or cardinality(p_importance) = 0)
             then true
           else (not (p_importance is null or cardinality(p_importance) = 0) and e.importance = any (p_importance))
                or ('importance' = any (t.nd) and e.importance is null)
         end)
    and (case
           when not ('teacher' = any (t.nd)) and (p_teacher_ids is null or cardinality(p_teacher_ids) = 0)
             then true
           else (not (p_teacher_ids is null or cardinality(p_teacher_ids) = 0) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.teacher_id = any (p_teacher_ids)))
                or ('teacher' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.teacher_id is not null))
         end)
    and (case
           when not ('course' = any (t.nd)) and (p_course_id is null)
             then true
           else (not (p_course_id is null) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.course_id = p_course_id))
                or ('course' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.course_id is not null))
         end)
    and (case
           when not ('subject' = any (t.nd)) and (p_subject_id is null)
             then true
           else (not (p_subject_id is null) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.subject_id = p_subject_id))
                or ('subject' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.subject_id is not null))
         end)
    and (case
           when not ('content' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0)
             then true
           else (not (p_content_ids is null or cardinality(p_content_ids) = 0) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.content_id = any (p_content_ids)))
                or ('content' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.content_id is not null))
         end)
    and (case
           when not ('institute' = any (t.nd)) and (p_institute_id is null)
             then true
           else (not (p_institute_id is null) and exists (select 1 from public.enquiry_items i
                    join public.teachers tch on tch.id = i.teacher_id
                   where i.enquiry_id = e.id and i.status = 'open'
                     and tch.institute_id = p_institute_id))
                or ('institute' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                        join public.teachers tch on tch.id = i.teacher_id
                       where i.enquiry_id = e.id and i.status = 'open'
                         and tch.institute_id is not null))
         end)
    and ((p_stages is null or cardinality(p_stages) = 0)
         or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome)
            = any (p_stages))
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
),
page as (
  select
    b.*,
    (case b.bucket
       when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
       when 'campaign'  then 4 when 'call_back' then 5
     end)::smallint as bucket_rank,
    count(*) over () as total_count
  from base b
  where p_include_not_due or b.due_date = b.target_date
  order by
    (case b.bucket
       when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
       when 'campaign'  then 4 when 'call_back' then 5 end),
    b.importance nulls last,
    b.top_content_priority nulls last,
    b.next_follow_up_date nulls last,
    b.enquiry_id
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0)
)
select
  p.enquiry_id, p.bucket, p.bucket_rank, p.is_overdue, p.due_date,
  p.student_id, s.mobile, s.name, p.type, p.status, p.importance,
  p.term_id, tm.name, p.source_id, src.name, p.product_text,
  p.next_follow_up_date, p.created_at, p.follow_up_slots_used,
  p.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = p.enquiry_id and i.status = 'open'),
  (select count(*)::integer from public.enquiry_items i
    where i.enquiry_id = p.enquiry_id),
  p.assigned_to, pr.full_name,
  p.stage, p.last_outcome, p.last_called_by, lcp.full_name, p.assigned_at,
  p.assignment_label, p.called_since,
  p.total_count
from page p
join public.students s on s.id = p.student_id
left join public.terms tm on tm.id = p.term_id
left join public.sources src on src.id = p.source_id
left join public.profiles pr on pr.id = p.assigned_to
left join public.profiles lcp on lcp.id = p.last_called_by
order by p.bucket_rank, p.importance nulls last,
         p.top_content_priority nulls last, p.next_follow_up_date nulls last,
         p.enquiry_id;
$function$;

revoke all on function public.recommended_calls from public;
grant execute on function public.recommended_calls to authenticated;


-- ---- recommended_facets ------------------------------------------------
drop function if exists public.recommended_facets;
CREATE FUNCTION public.recommended_facets(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_assignment text DEFAULT NULL::text, p_last_called_by uuid[] DEFAULT NULL::uuid[], p_last_outcomes text[] DEFAULT NULL::text[], p_no_detail text[] DEFAULT NULL::text[])
 RETURNS TABLE(facet text, value_id text, numbers integer, items integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_no_detail, '{}'::text[]) as nd
),
-- Every base predicate applied; each facet's own predicate carried as a flag,
-- so a facet can be counted with every filter except its own (§5.5).
cand as materialized (
  select
    e.id,
    e.term_id, e.source_id, e.importance, e.status,
    a.counsellor_id,
    coalesce(a.called_since, false) as called_since,
    lc.called_by as last_called_by,
    lc.outcome   as last_outcome,
    app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome) as stage,
    (e.status = coalesce(p_status, 'open'::public.enquiry_status)) as m_status,
    (p_counsellor_id is null or a.counsellor_id = p_counsellor_id) as m_couns,
    (p_source_id is null or e.source_id = p_source_id) as m_source,
    ((p_stages is null or cardinality(p_stages) = 0)
       or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome)
          = any (p_stages)) as m_stage,
    (case p_assignment
       when 'unassigned' then a.counsellor_id is null
       when 'assigned'   then a.counsellor_id is not null
       else true
     end) as m_assignment,
    ((p_last_called_by is null or cardinality(p_last_called_by) = 0)
       or lc.called_by = any (p_last_called_by)) as m_lastby,
    ((p_last_outcomes is null or cardinality(p_last_outcomes) = 0)
       or lc.outcome::text = any (p_last_outcomes)) as m_lastout,
    (case
       when not ('term' = any (t.nd)) and (p_term_id is null) then true
       else (not (p_term_id is null) and e.term_id = p_term_id)
            or ('term' = any (t.nd) and e.term_id is null)
     end) as m_term,
    (case
       when not ('importance' = any (t.nd)) and (p_importance is null or cardinality(p_importance) = 0) then true
       else (not (p_importance is null or cardinality(p_importance) = 0) and e.importance = any (p_importance))
            or ('importance' = any (t.nd) and e.importance is null)
     end) as m_importance,
    (case
       when not ('teacher' = any (t.nd)) and (p_teacher_ids is null or cardinality(p_teacher_ids) = 0) then true
       else (not (p_teacher_ids is null or cardinality(p_teacher_ids) = 0) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.teacher_id = any (p_teacher_ids)))
            or ('teacher' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.teacher_id is not null))
     end) as m_teacher,
    (case
       when not ('course' = any (t.nd)) and (p_course_id is null) then true
       else (not (p_course_id is null) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.course_id = p_course_id))
            or ('course' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.course_id is not null))
     end) as m_course,
    (case
       when not ('subject' = any (t.nd)) and (p_subject_id is null) then true
       else (not (p_subject_id is null) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.subject_id = p_subject_id))
            or ('subject' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.subject_id is not null))
     end) as m_subject,
    (case
       when not ('content' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0) then true
       else (not (p_content_ids is null or cardinality(p_content_ids) = 0) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.content_id = any (p_content_ids)))
            or ('content' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.content_id is not null))
     end) as m_content,
    (case
       when not ('institute' = any (t.nd)) and (p_institute_id is null) then true
       else (not (p_institute_id is null) and exists (select 1 from public.enquiry_items i
                join public.teachers tch on tch.id = i.teacher_id
               where i.enquiry_id = e.id and i.status = 'open'
                 and tch.institute_id = p_institute_id))
            or ('institute' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                    join public.teachers tch on tch.id = i.teacher_id
                   where i.enquiry_id = e.id and i.status = 'open'
                     and tch.institute_id is not null))
     end) as m_institute,
    (e.term_id is null) as n_term,
    (e.importance is null) as n_importance,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.teacher_id is not null)) as n_teacher,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.course_id is not null)) as n_course,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.subject_id is not null)) as n_subject,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.content_id is not null)) as n_content,
    (not exists (select 1 from public.enquiry_items i
                    join public.teachers tch on tch.id = i.teacher_id
                   where i.enquiry_id = e.id and i.status = 'open'
                     and tch.institute_id is not null)) as n_institute,
    true as _pad
  from public.live_enquiries e
  cross join target t
  left join lateral (
    select a2.counsellor_id,
           exists (
             select 1 from public.calls c3
              where c3.enquiry_id = e.id
                and c3.call_date = t.d
                and c3.called_at > a2.assigned_at
           ) as called_since
      from public.assignments a2
     where a2.enquiry_id = e.id and a2.date = t.d
     limit 1
  ) a on true
  left join lateral (
    select c2.outcome, c2.called_by
      from public.calls c2
     where c2.enquiry_id = e.id
     order by c2.call_date desc, c2.called_at desc, c2.id desc
     limit 1
  ) lc on true
  where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
    and (e.created_at at time zone 'Asia/Kolkata')::date <= t.d
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
    and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
    and (
      p_include_not_due
      or (case
            when e.fresh_call_date is null then t.d
            when e.next_follow_up_date is null then null
            else app.next_working_day(greatest(e.next_follow_up_date, t.d))
          end) = t.d
    )
),
-- The open lines of the candidate set, carrying the flags with them. Joining
-- two materialized CTEs gives the planner statistics on neither side; measured
-- in Brief 8 at 4.5M rows removed by join filter, per item facet.
lines as materialized (
  select i.enquiry_id, i.teacher_id, i.course_id, i.subject_id, i.content_id,
         tch.institute_id,
         c.m_status, c.m_couns, c.m_source, c.m_stage, c.m_assignment,
         c.m_lastby, c.m_lastout,
         c.m_term, c.m_importance, c.m_teacher, c.m_course, c.m_subject,
         c.m_content, c.m_institute
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
    left join public.teachers tch on tch.id = i.teacher_id
)
select 'stage', c.stage, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_source and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

union all
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_course and i.m_subject and i.m_content and i.m_institute
   and i.teacher_id is not null
 group by 2

union all
select 'teacher', '__none__', count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_teacher
 group by 2
union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_subject and i.m_content and i.m_institute
   and i.course_id is not null
 group by 2

union all
select 'course', '__none__', count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_subject and c.m_content and c.m_institute and c.n_course
 group by 2
union all
select 'subject', i.subject_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_content and i.m_institute
   and i.subject_id is not null
 group by 2

union all
select 'subject', '__none__', count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_content and c.m_institute and c.n_subject
 group by 2
union all
select 'content', i.content_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_subject and i.m_institute
   and i.content_id is not null
 group by 2

union all
select 'content', '__none__', count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_institute and c.n_content
 group by 2
union all
select 'institute', i.institute_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_subject and i.m_content
   and i.institute_id is not null
 group by 2

union all
select 'institute', '__none__', count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.n_institute
 group by 2

union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.term_id is not null
 group by 2
union all
select 'term', '__none__', count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_term
 group by 2
union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.source_id is not null
 group by 2
union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.importance is not null
 group by 2
union all
select 'importance', '__none__', count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_importance
 group by 2

union all
select 'counsellor', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null
 group by 2

-- The roster's two numbers for the current list: who called these last, and
-- who is holding them today.
union all
select 'last_called_by', c.last_called_by::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.last_called_by is not null
 group by 2

union all
select 'last_outcome', c.last_outcome::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.last_outcome is not null
 group by 2

union all
select 'assigned_pending', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_source and c.m_stage
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null and not c.called_since
 group by 2

union all
select 'assigned_done', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_source and c.m_stage
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null and c.called_since
 group by 2

union all
select 'status', c.status::text, count(*)::integer, 0
  from cand c
 where c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

-- The guard row: every filter applied, so it must equal the list's total.
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute;
$function$;

revoke all on function public.recommended_facets from public;
grant execute on function public.recommended_facets to authenticated;


-- ---- enquiries_table ---------------------------------------------------
drop function if exists public.enquiries_table;
CREATE FUNCTION public.enquiries_table(p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_lost_reason lost_reason DEFAULT NULL::lost_reason, p_close_reason close_reason DEFAULT NULL::close_reason, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_include_archived boolean DEFAULT false, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date)
 RETURNS TABLE(enquiry_id bigint, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, lost_reason lost_reason, close_reason close_reason, importance importance, lead_verification lead_verification, term_name text, source_name text, product_text text, next_follow_up_date date, fresh_call_date date, follow_up_slots_used smallint, created_at timestamp with time zone, closed_at timestamp with time zone, item_count integer, teacher_names text, last_call_at timestamp with time zone, last_outcome call_outcome, last_discussion text, assigned_to_name text, assigned_date date, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.outcome, c.discussion
    from public.calls c
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
-- Assignment is per day (§3); for a general table the useful one is the most
-- recent, with its date so the reader knows which day it belongs to.
last_assignment as (
  select distinct on (a.enquiry_id)
         a.enquiry_id, a.date, a.counsellor_id
    from public.assignments a
   order by a.enquiry_id, a.date desc
),
base as (
  select
    e.id as enquiry_id,
    e.student_id,
    s.mobile,
    s.name as student_name,
    e.type,
    e.status,
    e.lost_reason,
    e.close_reason,
    e.importance,
    e.lead_verification,
    tm.name as term_name,
    src.name as source_name,
    e.product_text,
    e.next_follow_up_date,
    e.fresh_call_date,
    e.follow_up_slots_used,
    e.created_at,
    e.closed_at,
    (select count(*)::integer from public.enquiry_items i where i.enquiry_id = e.id)
      as item_count,
    (select string_agg(distinct tch.name, ', ' order by tch.name)
       from public.enquiry_items i
       join public.teachers tch on tch.id = i.teacher_id
      where i.enquiry_id = e.id) as teacher_names,
    lc.called_at as last_call_at,
    lc.outcome as last_outcome,
    lc.discussion as last_discussion,
    pr.full_name as assigned_to_name,
    la.date as assigned_date,
    case p_sort
      when 'id'                  then e.id::numeric
      when 'created_at'          then extract(epoch from e.created_at)
      when 'next_follow_up_date' then extract(epoch from e.next_follow_up_date::timestamp)
      when 'last_call_at'        then extract(epoch from lc.called_at)
      when 'slots'               then e.follow_up_slots_used::numeric
    end as sort_num,
    case p_sort
      when 'mobile'       then s.mobile
      when 'student_name' then s.name
      when 'status'       then e.status::text
      when 'importance'   then e.importance::text
      when 'type'         then e.type::text
    end as sort_txt
  from public.enquiries e
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  left join last_call lc on lc.enquiry_id = e.id
  left join last_assignment la on la.enquiry_id = e.id
  left join public.profiles pr on pr.id = la.counsellor_id
  where (p_include_archived or e.archived_at is null)
    and (p_type is null or e.type = p_type)
    and (p_status is null or e.status = p_status)
    and (p_lost_reason is null or e.lost_reason = p_lost_reason)
    and (p_close_reason is null or e.close_reason = p_close_reason)
    and (p_counsellor_id is null or la.counsellor_id = p_counsellor_id)
    and (p_term_id is null or e.term_id = p_term_id)
    and (p_source_id is null or e.source_id = p_source_id)
    and (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance))
    and (p_mobile is null or s.mobile like '%' || p_mobile || '%')
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
    and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
    and ((p_teacher_ids is null or cardinality(p_teacher_ids) = 0) or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.teacher_id = any (p_teacher_ids)))
    and (p_course_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.course_id = p_course_id))
    and (p_subject_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.subject_id = p_subject_id))
    and ((p_content_ids is null or cardinality(p_content_ids) = 0) or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.content_id = any (p_content_ids)))
    -- calls_discussion_trgm_idx (GIN, trigram) backs this.
    and ((p_stages is null or cardinality(p_stages) = 0) or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome)
         = any (p_stages))
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.type, b.status,
  b.lost_reason, b.close_reason, b.importance, b.lead_verification,
  b.term_name, b.source_name, b.product_text, b.next_follow_up_date,
  b.fresh_call_date, b.follow_up_slots_used, b.created_at, b.closed_at,
  b.item_count, b.teacher_names, b.last_call_at, b.last_outcome,
  b.last_discussion, b.assigned_to_name, b.assigned_date,
  count(*) over () as total_count
from base b
order by
  case when lower(coalesce(p_dir, 'desc')) = 'asc'  then b.sort_num end asc  nulls last,
  case when lower(coalesce(p_dir, 'desc')) <> 'asc' then b.sort_num end desc nulls last,
  case when lower(coalesce(p_dir, 'desc')) = 'asc'  then b.sort_txt end asc  nulls last,
  case when lower(coalesce(p_dir, 'desc')) <> 'asc' then b.sort_txt end desc nulls last,
  b.enquiry_id desc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

revoke all on function public.enquiries_table from public;
grant execute on function public.enquiries_table to authenticated;


-- ---- new_calls_pool ----------------------------------------------------
drop function if exists public.new_calls_pool;
CREATE FUNCTION public.new_calls_pool(p_source_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_importance importance[] DEFAULT NULL::importance[], p_term_id uuid DEFAULT NULL::uuid, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_product_text text DEFAULT NULL::text, p_content_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_institute_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(enquiry_id bigint, student_id uuid, mobile text, student_name text, importance importance, term_name text, source_name text, product_text text, teacher_names text, item_count integer, created_at timestamp with time zone, re_enquired_at date, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with base as (
  select
    e.id as enquiry_id,
    e.student_id,
    s.mobile,
    s.name as student_name,
    e.importance,
    tm.name as term_name,
    src.name as source_name,
    e.product_text,
    (select string_agg(distinct tch.name, ', ' order by tch.name)
       from public.enquiry_items i
       join public.teachers tch on tch.id = i.teacher_id
      where i.enquiry_id = e.id and i.status = 'open') as teacher_names,
    (select count(*)::integer from public.enquiry_items i
      where i.enquiry_id = e.id and i.status = 'open') as item_count,
    e.created_at,
    e.re_enquired_at,
    -- The day this lead arrived in the pool, however it got there.
    coalesce(e.re_enquired_at, (e.created_at at time zone 'Asia/Kolkata')::date)
      as arrived_on
  from public.enquiries e
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  where e.type = 'purchase'
    and e.status = 'open'
    and e.archived_at is null
    and (e.fresh_call_date is null or e.re_enquired_at = app.ist_today())
    and not exists (
      select 1 from public.assignments a
       where a.enquiry_id = e.id
         and a.date = app.ist_today()
    )
    and (
      p_source_ids is null
      or cardinality(p_source_ids) = 0
      or e.source_id = any (p_source_ids)
    )
    and (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance))
    and (p_term_id is null or e.term_id = p_term_id)
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_product_text is null or e.product_text ilike '%' || p_product_text || '%')
    and (p_course_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.course_id = p_course_id))
    and ((p_teacher_ids is null or cardinality(p_teacher_ids) = 0) or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.teacher_id = any (p_teacher_ids)))
    and ((p_content_ids is null or cardinality(p_content_ids) = 0) or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.content_id = any (p_content_ids)))
    and (p_institute_id is null or exists (
          select 1 from public.enquiry_items i
            join public.teachers tch on tch.id = i.teacher_id
           where i.enquiry_id = e.id and i.status = 'open'
             and tch.institute_id = p_institute_id))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.importance,
  b.term_name, b.source_name, b.product_text, b.teacher_names, b.item_count,
  b.created_at, b.re_enquired_at,
  count(*) over () as total_count
from base b
-- Importance A → D, then oldest arrival first. A lead that came back today
-- sits with today's arrivals rather than with the six-month-old leads it was
-- created alongside.
order by b.importance nulls last, b.arrived_on, b.created_at, b.enquiry_id
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

revoke all on function public.new_calls_pool from public;
grant execute on function public.new_calls_pool to authenticated;


-- ---- new_calls_facets --------------------------------------------------
drop function if exists public.new_calls_facets;
CREATE FUNCTION public.new_calls_facets(p_source_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_importance importance[] DEFAULT NULL::importance[], p_term_id uuid DEFAULT NULL::uuid, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_product_text text DEFAULT NULL::text, p_content_ids uuid[] DEFAULT NULL::uuid[], p_institute_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(facet text, value_id text, numbers integer, items integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with cand as materialized (
  select
    e.id,
    e.term_id,
    e.source_id,
    e.importance,
    (p_source_ids is null or cardinality(p_source_ids) = 0
       or e.source_id = any (p_source_ids))            as m_source,
    (p_term_id is null or e.term_id = p_term_id)       as m_term,
    (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance)) as m_imp,
    ((p_teacher_ids is null or cardinality(p_teacher_ids) = 0) or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.teacher_id = any (p_teacher_ids)))            as m_teacher,
    (p_course_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.course_id = p_course_id))              as m_course,
    (p_institute_id is null or exists (
       select 1 from public.enquiry_items i
         join public.teachers tch on tch.id = i.teacher_id
        where i.enquiry_id = e.id and i.status = 'open'
          and tch.institute_id = p_institute_id))      as m_institute,
    ((p_content_ids is null or cardinality(p_content_ids) = 0) or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.content_id = any (p_content_ids)))      as m_content
  from public.enquiries e
  where e.type = 'purchase'
    and e.status = 'open'
    and e.archived_at is null
    and (e.fresh_call_date is null or e.re_enquired_at = app.ist_today())
    and not exists (
      select 1 from public.assignments a
       where a.enquiry_id = e.id and a.date = app.ist_today())
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_product_text is null or e.product_text ilike '%' || p_product_text || '%')
),
lines as materialized (
  select i.enquiry_id, i.teacher_id, i.course_id, i.content_id, tch.institute_id,
         c.m_source, c.m_term, c.m_imp, c.m_teacher, c.m_course, c.m_institute,
         c.m_content
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
    left join public.teachers tch on tch.id = i.teacher_id
)
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_course and i.m_institute and i.m_content
   and i.teacher_id is not null
 group by 2
union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_institute and i.m_content
   and i.course_id is not null
 group by 2
union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_imp and c.m_teacher and c.m_course and c.m_institute and c.m_content
   and c.term_id is not null
 group by 2
union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_term and c.m_imp and c.m_teacher and c.m_course and c.m_institute and c.m_content
   and c.source_id is not null
 group by 2
union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_institute and c.m_content
   and c.importance is not null
 group by 2
union all
select 'content', i.content_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_course
   and i.m_institute
   and i.content_id is not null
 group by 2
union all
select 'institute', i.institute_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_course
   and i.m_content
   and i.institute_id is not null
 group by 2
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_content and c.m_source and c.m_term and c.m_imp
   and c.m_teacher and c.m_course;
$function$;

revoke all on function public.new_calls_facets from public;
grant execute on function public.new_calls_facets to authenticated;


-- ---- my_day ------------------------------------------------------------
drop function if exists public.my_day;
CREATE FUNCTION public.my_day(p_date date DEFAULT NULL::date, p_counsellor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_name text, product_text text, next_follow_up_date date, is_overdue boolean, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, called_today boolean, last_call_at timestamp with time zone, last_outcome call_outcome, re_enquired_today boolean, assigned_at timestamp with time zone, assignment_label text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select
    coalesce(p_date, app.ist_today()) as d,
    coalesce(p_counsellor_id, (select auth.uid())) as who
),
mine as (
  select a.enquiry_id, a.bucket, a.assigned_at, a.label
    from public.assignments a
    cross join target t
   where a.date = t.d
     and a.counsellor_id = t.who
),
-- A call on the viewed day, made after the lead was handed over. Both halves
-- matter: the date keeps a historical view honest, assigned_at is what makes a
-- re-assignment reset the row to Pending.
done_call as (
  select c.enquiry_id, max(c.called_at) as last_call_at
    from public.calls c
    join mine m on m.enquiry_id = c.enquiry_id
    cross join target t
   where c.call_date = t.d
     and c.called_at > m.assigned_at
   group by c.enquiry_id
)
select
  e.id,
  m.bucket,
  (case m.bucket
     when 'follow_up' then 1
     when 'offer'     then 2
     when 'fresh'     then 3
     when 'campaign'  then 4
     when 'call_back' then 5
   end)::smallint as bucket_rank,
  e.student_id,
  s.mobile,
  s.name,
  e.type,
  e.status,
  e.importance,
  tm.name,
  e.product_text,
  e.next_follow_up_date,
  (e.next_follow_up_date is not null and e.next_follow_up_date < t.d) as is_overdue,
  e.follow_up_slots_used,
  e.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = e.id and i.status = 'open') as teacher_names,
  (select count(*)::integer from public.enquiry_items i
    where i.enquiry_id = e.id) as item_count,
  (dc.enquiry_id is not null) as called_today,
  dc.last_call_at,
  (select c.outcome
     from public.calls c
    where c.enquiry_id = e.id
    order by c.call_date desc, c.called_at desc, c.id desc
    limit 1) as last_outcome,
  (e.re_enquired_at is not null and e.re_enquired_at = t.d) as re_enquired_today,
  m.assigned_at,
  m.label
from mine m
join public.live_enquiries e on e.id = m.enquiry_id
join public.students s on s.id = e.student_id
cross join target t
left join public.terms tm on tm.id = e.term_id
left join done_call dc on dc.enquiry_id = e.id
where e.type = 'purchase'
order by
  (case m.bucket
     when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
     when 'campaign'  then 4 when 'call_back' then 5 end),
  e.importance nulls last,
  e.top_content_priority nulls last,
  e.next_follow_up_date nulls last,
  e.id;
$function$;

revoke all on function public.my_day from public;
grant execute on function public.my_day to authenticated;


-- ---- export_enquiries --------------------------------------------------
drop function if exists public.export_enquiries;
CREATE FUNCTION public.export_enquiries(p_ids bigint[])
 RETURNS TABLE(enquiry_id bigint, mobile text, student_name text, type enquiry_type, status enquiry_status, lost_reason lost_reason, close_reason close_reason, importance importance, lead_verification lead_verification, term_name text, source_name text, product_text text, teachers text, courses text, subjects text, contents text, item_statuses text, order_ids text, amount_total numeric, next_follow_up_date date, fresh_call_date date, follow_up_slots_used smallint, last_call_at timestamp with time zone, last_outcome call_outcome, last_discussion text, assigned_to_name text, assigned_date date, assignment_label text, created_at timestamp with time zone, closed_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with wanted as (
  select unnest(p_ids) as id
),
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.outcome, c.discussion
    from public.calls c
   where c.enquiry_id in (select id from wanted)
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
last_assignment as (
  select distinct on (a.enquiry_id)
         a.enquiry_id, a.date, a.counsellor_id, a.label
    from public.assignments a
   where a.enquiry_id in (select id from wanted)
   order by a.enquiry_id, a.date desc
),
-- Items flattened to one cell each, in a stable order so the columns line up
-- row by row: the third teacher goes with the third subject.
items as (
  select i.enquiry_id,
         string_agg(tch.name, ' | ' order by i.created_at, i.id) as teachers,
         string_agg(crs.name, ' | ' order by i.created_at, i.id) as courses,
         string_agg(coalesce(sub.name, '—'), ' | ' order by i.created_at, i.id) as subjects,
         string_agg(coalesce(cnt.name, '—'), ' | ' order by i.created_at, i.id) as contents,
         string_agg(i.status::text, ' | ' order by i.created_at, i.id) as item_statuses,
         string_agg(distinct i.order_id, ' | ') as order_ids,
         sum(i.amount) as amount_total
    from public.enquiry_items i
    join public.teachers tch on tch.id = i.teacher_id
    join public.courses crs on crs.id = i.course_id
    left join public.subjects sub on sub.id = i.subject_id
    left join public.contents cnt on cnt.id = i.content_id
   where i.enquiry_id in (select id from wanted)
   group by i.enquiry_id
)
select
  e.id,
  s.mobile,
  s.name,
  e.type,
  e.status,
  e.lost_reason,
  e.close_reason,
  e.importance,
  e.lead_verification,
  tm.name,
  src.name,
  e.product_text,
  it.teachers,
  it.courses,
  it.subjects,
  it.contents,
  it.item_statuses,
  it.order_ids,
  it.amount_total,
  e.next_follow_up_date,
  e.fresh_call_date,
  e.follow_up_slots_used,
  lc.called_at,
  lc.outcome,
  lc.discussion,
  pr.full_name,
  la.date,
  la.label,
  e.created_at,
  e.closed_at
from public.enquiries e
join public.students s on s.id = e.student_id
left join public.terms tm on tm.id = e.term_id
left join public.sources src on src.id = e.source_id
left join items it on it.enquiry_id = e.id
left join last_call lc on lc.enquiry_id = e.id
left join last_assignment la on la.enquiry_id = e.id
left join public.profiles pr on pr.id = la.counsellor_id
where e.id in (select id from wanted)
order by e.id;
$function$;

revoke all on function public.export_enquiries from public;
grant execute on function public.export_enquiries to authenticated;


-- ---- the My Day sidebar badge ---------------------------------------------
-- One number: everything on this counsellor's day that still needs calling,
-- plus the open tickets nobody has touched today. It is the sum of the five
-- tab "pending" counts, computed in one round trip rather than by loading the
-- whole day into the layout on every navigation.
create or replace function public.my_day_pending_count(
  p_date date default null,
  p_counsellor_id uuid default null
)
returns integer
language sql
stable
set search_path to ''
as $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_counsellor_id, (select auth.uid())) as who
),
assigned as (
  select count(*)::integer as n
    from public.assignments a
    join public.live_enquiries e on e.id = a.enquiry_id
    cross join target t
   where a.date = t.d
     and a.counsellor_id = t.who
     and e.type = 'purchase'
     and not exists (
       select 1 from public.calls c
        where c.enquiry_id = a.enquiry_id
          and c.call_date = t.d
          and c.called_at > a.assigned_at
     )
),
-- Tickets are not assigned to anybody, so the tab shows the same queue to
-- everyone; the badge says the same thing the tab does.
tickets as (
  select count(*)::integer as n
    from public.live_enquiries e
    cross join target t
   where e.type = 'after_sale'
     and e.status in ('open', 'escalated')
     and not exists (
       select 1 from public.calls c
        where c.enquiry_id = e.id and c.call_date = t.d
     )
)
select (select n from assigned) + (select n from tickets);
$function$;

comment on function public.my_day_pending_count is
  'The number on the My Day badge: pending across all five tabs for one day.';

revoke all on function public.my_day_pending_count from public;
grant execute on function public.my_day_pending_count to authenticated;
