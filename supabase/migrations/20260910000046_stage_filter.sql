-- §13.1 Stage filter: where an enquiry has got to, and when it was last called.
--
-- Five buckets, derived from the two columns app.recompute_enquiry() already
-- maintains, so this cannot drift from the call history:
--
--   uncalled     fresh_call_date is null
--   fresh_only   called, but no follow-up slot used yet
--   fu1/fu2/fu3  follow_up_slots_used 1, 2, 3-or-more
--
-- Multi-select with union semantics, like teacher and content. Beside it,
-- p_last_called_from/to read last_slot_date, which the recompute sets to
-- max(call_date) — so "fresh call yesterday and nothing since" is stage =
-- fresh_only plus last-called = yesterday, in one pass and with no join.
--
-- The stage facet is leave-one-out like every other; the last-called range is
-- a base predicate, not a facet, because a date range has no option list.
--
-- Generated from the deployed definitions with the change applied
-- mechanically; all twelve facet clauses were checked afterwards.

drop function if exists public.recommended_calls(date, boolean, uuid, uuid[], uuid, uuid, uuid[], uuid, uuid, public.importance, public.enquiry_type, public.enquiry_status, date, date, date, date, text, integer, integer, uuid);
drop function if exists public.recommended_facets(date, boolean, uuid, uuid[], uuid, uuid, uuid[], uuid, uuid, public.importance, public.enquiry_type, public.enquiry_status, date, date, date, date, text, uuid);
drop function if exists public.enquiries_table(public.enquiry_type, public.enquiry_status, public.lost_reason, public.close_reason, uuid, uuid[], uuid, uuid, uuid[], uuid, uuid, public.importance, date, date, date, date, text, text, text, text, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.recommended_calls(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date)
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, is_overdue boolean, due_date date, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_id uuid, term_name text, source_id uuid, source_name text, product_text text, next_follow_up_date date, created_at timestamp with time zone, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, assigned_to uuid, assigned_to_name text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d
),
base as (
  select
    e.id as enquiry_id,
    case
      when e.fresh_call_date is null then 'fresh'::public.assignment_bucket
      when (select c.outcome
              from public.calls c
             where c.enquiry_id = e.id
             order by c.call_date desc, c.called_at desc, c.id desc
             limit 1) = 'call_back' then 'call_back'::public.assignment_bucket
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
    e.student_id,
    e.type,
    e.status,
    e.importance,
    e.term_id,
    e.source_id,
    e.product_text,
    e.next_follow_up_date,
    e.created_at,
    e.follow_up_slots_used,
    e.top_content_priority,
    a.counsellor_id as assigned_to,
    t.d as target_date
  from public.live_enquiries e
  cross join target t
  left join lateral (
    select a2.counsellor_id
      from public.assignments a2
     where a2.enquiry_id = e.id and a2.date = t.d
     limit 1
  ) a on true
  where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
    and e.status = coalesce(p_status, 'open'::public.enquiry_status)
    and (e.created_at at time zone 'Asia/Kolkata')::date <= t.d
    and (p_counsellor_id is null or a.counsellor_id = p_counsellor_id)
    and (p_term_id is null or e.term_id = p_term_id)
    and (p_source_id is null or e.source_id = p_source_id)
    and (p_importance is null or e.importance = p_importance)
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
    and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
    and ((p_teacher_ids is null or cardinality(p_teacher_ids) = 0) or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.teacher_id = any (p_teacher_ids)))
    and (p_course_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.course_id = p_course_id))
    and (p_subject_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.subject_id = p_subject_id))
    and ((p_content_ids is null or cardinality(p_content_ids) = 0) or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.content_id = any (p_content_ids)))
    -- One hop further than the teacher filter: the teacher's institute.
    and (p_institute_id is null or exists (
          select 1 from public.enquiry_items i
            join public.teachers tch on tch.id = i.teacher_id
           where i.enquiry_id = e.id and i.status = 'open'
             and tch.institute_id = p_institute_id))
    and ((p_stages is null or cardinality(p_stages) = 0) or case
      when e.fresh_call_date is null then 'uncalled'
      when e.follow_up_slots_used = 0 then 'fresh_only'
      when e.follow_up_slots_used = 1 then 'fu1'
      when e.follow_up_slots_used = 2 then 'fu2'
      else 'fu3'
    end = any (p_stages))
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
),
page as (
  select
    b.*,
    (case b.bucket
       when 'follow_up' then 1
       when 'offer'     then 2
       when 'fresh'     then 3
       when 'campaign'  then 4
       when 'call_back' then 5
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
  p.assigned_to, pr.full_name, p.total_count
from page p
join public.students s on s.id = p.student_id
left join public.terms tm on tm.id = p.term_id
left join public.sources src on src.id = p.source_id
left join public.profiles pr on pr.id = p.assigned_to
order by p.bucket_rank, p.importance nulls last,
         p.top_content_priority nulls last, p.next_follow_up_date nulls last,
         p.enquiry_id;
$function$
;

CREATE OR REPLACE FUNCTION public.recommended_facets(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date)
 RETURNS TABLE(facet text, value_id text, numbers integer, items integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d
),
-- The candidate set: every base predicate applied, none of the nine facets.
-- Each facet's own predicate is carried as a boolean instead.
cand as materialized (
  select
    e.id,
    e.term_id,
    e.source_id,
    e.importance,
    e.status,
    a.counsellor_id,
    -- Status is a facet, but the list's scope defaults to open, so the flag
    -- has to say `= coalesce(p_status,'open')` rather than "unfiltered".
    (e.status = coalesce(p_status, 'open'::public.enquiry_status)) as m_status,
    (p_term_id is null or e.term_id = p_term_id)                   as m_term,
    (p_source_id is null or e.source_id = p_source_id)             as m_source,
    (p_importance is null or e.importance = p_importance)          as m_imp,
    (p_counsellor_id is null or a.counsellor_id = p_counsellor_id) as m_couns,
    ((p_teacher_ids is null or cardinality(p_teacher_ids) = 0) or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.teacher_id = any (p_teacher_ids)))                        as m_teacher,
    (p_course_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.course_id = p_course_id))                          as m_course,
    (p_subject_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.subject_id = p_subject_id))                        as m_subject,
    ((p_content_ids is null or cardinality(p_content_ids) = 0) or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.content_id = any (p_content_ids)))                        as m_content,
    (p_institute_id is null or exists (
       select 1 from public.enquiry_items i
         join public.teachers tch on tch.id = i.teacher_id
        where i.enquiry_id = e.id and i.status = 'open'
          and tch.institute_id = p_institute_id))                   as m_institute,
    case
      when e.fresh_call_date is null then 'uncalled'
      when e.follow_up_slots_used = 0 then 'fresh_only'
      when e.follow_up_slots_used = 1 then 'fu1'
      when e.follow_up_slots_used = 2 then 'fu2'
      else 'fu3'
    end as stage,
    ((p_stages is null or cardinality(p_stages) = 0)
       or case
      when e.fresh_call_date is null then 'uncalled'
      when e.follow_up_slots_used = 0 then 'fresh_only'
      when e.follow_up_slots_used = 1 then 'fu1'
      when e.follow_up_slots_used = 2 then 'fu2'
      else 'fu3'
    end = any (p_stages))                                      as m_stage
  from public.live_enquiries e
  cross join target t
  -- LATERAL with LIMIT 1, not a plain LEFT JOIN. `assignments` has a unique
  -- index on (enquiry_id, date), but with the date coming from a CTE under a
  -- generic plan the planner chose a nested loop over a *sequential* scan of
  -- the whole table — measured at 1,837,745 rows removed by join filter, 6.4s
  -- of a 6.5s query. LIMIT 1 makes the index lookup the only sensible plan,
  -- and one row is all there can be.
  left join lateral (
    select a2.counsellor_id
      from public.assignments a2
     where a2.enquiry_id = e.id and a2.date = t.d
     limit 1
  ) a on true
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
    -- The due-date rule, identical to recommended_calls. Resolved enquiries
    -- carry no next date, so they fall out here without needing a status
    -- predicate — which is what lets status itself be a facet.
    and (
      p_include_not_due
      or (case
            when e.fresh_call_date is null then t.d
            when e.next_follow_up_date is null then null
            else app.next_working_day(greatest(e.next_follow_up_date, t.d))
          end) = t.d
    )
),
-- The open lines belonging to that candidate set, read once for all four
-- item facets, carrying the candidate's facet flags with them.
--
-- The flags ride along rather than being joined back afterwards because
-- joining two materialized CTEs gives the planner no statistics on either
-- side: measured, it nested-looped them and removed 4,530,045 rows by join
-- filter, per item facet. Joining `cand` to the real enquiry_items table
-- instead uses enquiry_items_enquiry_idx and happens once.
lines as materialized (
  select i.enquiry_id, i.teacher_id, i.course_id, i.subject_id, i.content_id,
         tch.institute_id,
         c.m_status, c.m_term, c.m_source, c.m_imp, c.m_couns,
         c.m_teacher, c.m_course, c.m_subject, c.m_content, c.m_institute,
         c.m_stage
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
    left join public.teachers tch on tch.id = i.teacher_id
)
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_course
   and i.m_subject and i.m_content and i.m_institute and i.m_stage
   and i.teacher_id is not null
 group by 2

union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_teacher
   and i.m_subject and i.m_content and i.m_institute and i.m_stage
   and i.course_id is not null
 group by 2

union all
select 'subject', i.subject_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_teacher
   and i.m_course and i.m_content and i.m_institute and i.m_stage
   and i.subject_id is not null
 group by 2

union all
select 'content', i.content_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_teacher
   and i.m_course and i.m_subject and i.m_institute and i.m_stage
   and i.content_id is not null
 group by 2

-- Scalar facets: one number each, no item count.
union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_source and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.m_stage
   and c.term_id is not null
 group by 2

union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.m_stage
   and c.source_id is not null
 group by 2

union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_source and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.m_stage
   and c.importance is not null
 group by 2

union all
select 'counsellor', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_source and c.m_imp
   and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.m_stage
   and c.counsellor_id is not null
 group by 2

union all
select 'status', c.status::text, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_stage and c.m_term and c.m_source and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content
 group by 2

-- The guard row: every filter applied, so it must equal the list's total.
union all
select 'institute', i.institute_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_teacher
   and i.m_course and i.m_subject and i.m_content and i.m_stage
   and i.institute_id is not null
 group by 2

union all
select 'stage', c.stage, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_source and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content
   and c.m_institute
 group by 2

union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_stage and c.m_status and c.m_term and c.m_source and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content;
$function$
;

CREATE OR REPLACE FUNCTION public.enquiries_table(p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_lost_reason lost_reason DEFAULT NULL::lost_reason, p_close_reason close_reason DEFAULT NULL::close_reason, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_include_archived boolean DEFAULT false, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date)
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
    and (p_importance is null or e.importance = p_importance)
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
    and ((p_stages is null or cardinality(p_stages) = 0) or case
      when e.fresh_call_date is null then 'uncalled'
      when e.follow_up_slots_used = 0 then 'fresh_only'
      when e.follow_up_slots_used = 1 then 'fu1'
      when e.follow_up_slots_used = 2 then 'fu2'
      else 'fu3'
    end = any (p_stages))
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
$function$
;

revoke all on function public.recommended_calls from public;
grant execute on function public.recommended_calls to authenticated;
revoke all on function public.recommended_facets from public;
grant execute on function public.recommended_facets to authenticated;
revoke all on function public.enquiries_table from public;
grant execute on function public.enquiries_table to authenticated;
