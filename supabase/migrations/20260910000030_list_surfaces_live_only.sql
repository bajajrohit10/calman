-- §9 Archive: point the list surfaces at public.live_enquiries.
--
-- Seven surfaces change. Six switch their FROM/JOIN to the view; the Enquiries
-- table (§5.6) keeps reading the table and gains p_include_archived, because
-- it is the investigative screen and an admin who knows an enquiry exists must
-- be able to find it without going via the student's number.
--
-- One correction to the Brief 9 plan, which said eight: export_enquiries takes
-- an explicit bigint[] of ids. It is id-driven machinery, not a list surface —
-- the filtering happens upstream in enquiries_table — and filtering it would
-- break "re-export this batch", which by definition exports archived rows. It
-- is deliberately left alone.
--
-- The bodies below are the deployed definitions with that single edit applied
-- mechanically, so nothing drifts in transcription.
--
-- enquiries_table is dropped and recreated rather than replaced: adding a
-- parameter changes the signature, and CREATE OR REPLACE would leave two
-- overloads for PostgREST to choose between.

drop function if exists public.enquiries_table(
  public.enquiry_type, public.enquiry_status, public.lost_reason, public.close_reason,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, public.importance,
  date, date, date, date, text, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.recommended_calls(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, is_overdue boolean, due_date date, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_id uuid, term_name text, source_id uuid, source_name text, product_text text, next_follow_up_date date, created_at timestamp with time zone, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, assigned_to uuid, assigned_to_name text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d
),
-- Everything the filter and the sort need, and nothing they do not. The two
-- item aggregates are deliberately absent: they cost 1.7s across the whole
-- due set and are only ever read for one page of it.
base as (
  select
    e.id as enquiry_id,
    case
      -- Decision: "fresh" is never-called, not created-today. A fresh lead has
      -- no follow-up date, so dropping it out of this bucket after a day would
      -- leave it in no bucket at all — silently lost.
      when e.fresh_call_date is null then 'fresh'::public.assignment_bucket
      -- The call that decides the bucket, read straight off
      -- calls_enquiry_latest_idx. A DISTINCT ON in a CTE reads better, but a
      -- CTE carries no statistics into the generic plan a SQL function's
      -- parameters force: measured, the planner nested-looped it and removed
      -- 10,530,109 rows by join filter. This is one index lookup per row, and
      -- only for rows that have been called at all.
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
      -- Fresh: due from the day it was created, every day, until called.
      when e.fresh_call_date is null then t.d
      -- Called but carrying no next date (competitor, wrong number, exhausted)
      -- is not queued at all.
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
  -- Assignment is per day (§3), so this is the owner for the chosen date only.
  -- LATERAL with LIMIT 1, not a plain LEFT JOIN: with the date coming from a
  -- CTE under a generic plan the planner will otherwise nested-loop a
  -- sequential scan of the whole table per row. There can only be one row —
  -- assignments is unique on (enquiry_id, date).
  left join lateral (
    select a2.counsellor_id
      from public.assignments a2
     where a2.enquiry_id = e.id and a2.date = t.d
     limit 1
  ) a on true
  where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
    and e.status = coalesce(p_status, 'open'::public.enquiry_status)
    -- A lead cannot be due before it existed.
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
    -- Open items only: see the header note.
    and (p_teacher_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.teacher_id = p_teacher_id))
    and (p_course_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.course_id = p_course_id))
    and (p_subject_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.subject_id = p_subject_id))
    and (p_content_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.content_id = p_content_id))
    -- calls_discussion_trgm_idx (GIN, trigram) makes this an index lookup.
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
),
-- The page, and the total across everything the filter matched. A window
-- function is evaluated before LIMIT at the same query level, so total_count
-- is still the count of the whole filtered set, not of this page.
page as (
  select
    b.*,
    (case b.bucket
       when 'follow_up' then 1
       -- Reserved. Offers do not exist yet, so this branch emits no rows; the
       -- rank is here so the ordering does not have to change when they do.
       when 'offer'     then 2
       when 'fresh'     then 3
       -- Never emitted: campaign is not a property of an enquiry, it is how an
       -- admin assigns an ad-hoc filter result (§5.5).
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
    -- The importance enum is declared a,b,c,d, so this is already A → D.
    b.importance nulls last,
    -- Full → FT → EO → Test Series → Books, by contents.priority.
    b.top_content_priority nulls last,
    -- Never rewritten, so ascending puts the most overdue lead first within its
    -- importance and content-priority group.
    b.next_follow_up_date nulls last,
    b.enquiry_id
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0)
)
-- Only now, for the rows actually being returned, pay for the lookups.
select
  p.enquiry_id,
  p.bucket,
  p.bucket_rank,
  p.is_overdue,
  p.due_date,
  p.student_id,
  s.mobile,
  s.name as student_name,
  p.type,
  p.status,
  p.importance,
  p.term_id,
  tm.name as term_name,
  p.source_id,
  src.name as source_name,
  p.product_text,
  p.next_follow_up_date,
  p.created_at,
  p.follow_up_slots_used,
  p.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = p.enquiry_id
      and i.status = 'open') as teacher_names,
  (select count(*)::integer
     from public.enquiry_items i
    where i.enquiry_id = p.enquiry_id) as item_count,
  p.assigned_to,
  pr.full_name as assigned_to_name,
  p.total_count
from page p
join public.students s on s.id = p.student_id
left join public.terms tm on tm.id = p.term_id
left join public.sources src on src.id = p.source_id
left join public.profiles pr on pr.id = p.assigned_to
order by p.bucket_rank, p.importance nulls last,
         p.top_content_priority nulls last, p.next_follow_up_date nulls last,
         p.enquiry_id;
$function$;

CREATE OR REPLACE FUNCTION public.recommended_facets(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text)
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
    (p_teacher_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.teacher_id = p_teacher_id))                        as m_teacher,
    (p_course_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.course_id = p_course_id))                          as m_course,
    (p_subject_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.subject_id = p_subject_id))                        as m_subject,
    (p_content_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.content_id = p_content_id))                        as m_content
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
         c.m_status, c.m_term, c.m_source, c.m_imp, c.m_couns,
         c.m_teacher, c.m_course, c.m_subject, c.m_content
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
)
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_course
   and i.m_subject and i.m_content
   and i.teacher_id is not null
 group by 2

union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_teacher
   and i.m_subject and i.m_content
   and i.course_id is not null
 group by 2

union all
select 'subject', i.subject_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_teacher
   and i.m_course and i.m_content
   and i.subject_id is not null
 group by 2

union all
select 'content', i.content_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_status and i.m_term and i.m_source
   and i.m_imp and i.m_couns and i.m_teacher
   and i.m_course and i.m_subject
   and i.content_id is not null
 group by 2

-- Scalar facets: one number each, no item count.
union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_source and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content
   and c.term_id is not null
 group by 2

union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content
   and c.source_id is not null
 group by 2

union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_source and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content
   and c.importance is not null
 group by 2

union all
select 'counsellor', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_source and c.m_imp
   and c.m_teacher and c.m_course and c.m_subject and c.m_content
   and c.counsellor_id is not null
 group by 2

union all
select 'status', c.status::text, count(*)::integer, 0
  from cand c
 where c.m_term and c.m_source and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content
 group by 2

-- The guard row: every filter applied, so it must equal the list's total.
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_status and c.m_term and c.m_source and c.m_imp and c.m_couns
   and c.m_teacher and c.m_course and c.m_subject and c.m_content;
$function$;

CREATE OR REPLACE FUNCTION public.new_calls_pool(p_source_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_term_id uuid DEFAULT NULL::uuid, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_product_text text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(enquiry_id bigint, student_id uuid, mobile text, student_name text, importance importance, term_name text, source_name text, product_text text, teacher_names text, item_count integer, created_at timestamp with time zone, total_count bigint)
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
    e.created_at
  from public.live_enquiries e
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  where e.type = 'purchase'
    and e.status = 'open'
    -- Never called. fresh_call_date is trigger-derived from the call history,
    -- so this cannot drift from what the calls actually say.
    and e.fresh_call_date is null
    -- And unclaimed for today: a lead someone has already taken belongs on
    -- their My Day, not back in the pool.
    and not exists (
      select 1 from public.assignments a
       where a.enquiry_id = e.id
         and a.date = app.ist_today()
    )
    -- Multi-select: an empty or null array means "any source".
    and (
      p_source_ids is null
      or cardinality(p_source_ids) = 0
      or e.source_id = any (p_source_ids)
    )
    and (p_importance is null or e.importance = p_importance)
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
    and (p_teacher_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.teacher_id = p_teacher_id))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.importance,
  b.term_name, b.source_name, b.product_text, b.teacher_names, b.item_count,
  b.created_at,
  count(*) over () as total_count
from base b
-- The enum is declared a,b,c,d, so this is already A → D; then oldest first,
-- because a lead that has sat unclaimed longest is the one going cold.
order by b.importance nulls last, b.created_at, b.enquiry_id
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

CREATE OR REPLACE FUNCTION public.new_calls_facets(p_source_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_term_id uuid DEFAULT NULL::uuid, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_product_text text DEFAULT NULL::text)
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
    (p_importance is null or e.importance = p_importance) as m_imp,
    (p_teacher_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.teacher_id = p_teacher_id))            as m_teacher,
    (p_course_id is null or exists (
       select 1 from public.enquiry_items i
        where i.enquiry_id = e.id and i.status = 'open'
          and i.course_id = p_course_id))              as m_course
  from public.live_enquiries e
  where e.type = 'purchase'
    and e.status = 'open'
    and e.fresh_call_date is null
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
  select i.enquiry_id, i.teacher_id, i.course_id,
         c.m_source, c.m_term, c.m_imp, c.m_teacher, c.m_course
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
)
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_course
   and i.teacher_id is not null
 group by 2
union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher
   and i.course_id is not null
 group by 2
union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_imp and c.m_teacher and c.m_course
   and c.term_id is not null
 group by 2
union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_term and c.m_imp and c.m_teacher and c.m_course
   and c.source_id is not null
 group by 2
union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_term and c.m_teacher and c.m_course
   and c.importance is not null
 group by 2
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_term and c.m_imp and c.m_teacher and c.m_course;
$function$;

CREATE OR REPLACE FUNCTION public.tickets_list(p_include_resolved boolean DEFAULT false, p_status enquiry_status DEFAULT NULL::enquiry_status, p_counsellor_id uuid DEFAULT NULL::uuid, p_issue_category issue_category DEFAULT NULL::issue_category, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_sort text DEFAULT 'reminder'::text, p_dir text DEFAULT 'asc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(enquiry_id bigint, student_id uuid, mobile text, student_name text, status enquiry_status, reminder_date date, created_at timestamp with time zone, last_call_at timestamp with time zone, last_outcome call_outcome, last_discussion text, issue_category issue_category, order_id text, last_caller_id uuid, last_caller_name text, call_count integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.outcome, c.discussion,
         c.issue_category, c.order_id, c.called_by
    from public.calls c
   where c.enquiry_type = 'after_sale'
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
base as (
  select
    e.id as enquiry_id,
    e.student_id,
    s.mobile,
    s.name as student_name,
    e.status,
    -- §4: on an after-sale enquiry this date is a reminder, not a queue entry.
    e.next_follow_up_date as reminder_date,
    e.created_at,
    lc.called_at as last_call_at,
    lc.outcome as last_outcome,
    lc.discussion as last_discussion,
    lc.issue_category,
    lc.order_id,
    lc.called_by as last_caller_id,
    pr.full_name as last_caller_name,
    (select count(*)::integer from public.calls c where c.enquiry_id = e.id) as call_count,
    case p_sort
      when 'created'   then extract(epoch from e.created_at)
      when 'last_call' then extract(epoch from lc.called_at)
      else extract(epoch from e.next_follow_up_date::timestamp)
    end as sort_num
  from public.live_enquiries e
  join public.students s on s.id = e.student_id
  left join last_call lc on lc.enquiry_id = e.id
  left join public.profiles pr on pr.id = lc.called_by
  where e.type = 'after_sale'
    and (
      case
        when p_status is not null then e.status = p_status
        -- The queue is everything unresolved; the toggle widens it.
        when p_include_resolved then true
        else e.status in ('open', 'escalated')
      end
    )
    and (p_counsellor_id is null or lc.called_by = p_counsellor_id)
    and (p_issue_category is null or lc.issue_category = p_issue_category)
    and (p_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_from)
    and (p_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_to)
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.status,
  b.reminder_date, b.created_at, b.last_call_at, b.last_outcome,
  b.last_discussion, b.issue_category, b.order_id, b.last_caller_id,
  b.last_caller_name, b.call_count,
  count(*) over () as total_count
from base b
order by
  -- Escalated first whatever else is asked for: it is the one state that means
  -- somebody else is now waiting on us.
  (b.status = 'escalated') desc,
  case when lower(coalesce(p_dir, 'asc')) = 'asc'  then b.sort_num end asc  nulls last,
  case when lower(coalesce(p_dir, 'asc')) <> 'asc' then b.sort_num end desc nulls last,
  b.enquiry_id desc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

CREATE OR REPLACE FUNCTION public.daily_counsellor_report(p_from date, p_to date, p_counsellor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(day date, counsellor_id uuid, counsellor_name text, calls_made integer, fresh_handled integer, follow_ups_done integer, call_backs integer, purchased_calls integer, purchased_amount numeric, competitor integer, closed integer, pli_issued integer, overdue_carried_forward integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope uuid;
begin
  if not app.is_staff() then
    raise exception 'not authorised to read the reports' using errcode = '42501';
  end if;

  if app.is_admin() then
    v_scope := p_counsellor_id;
  else
    v_scope := (select auth.uid());
  end if;

  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  people as (
    select p.id, p.full_name
      from public.profiles p
     where p.is_active
       and (v_scope is null or p.id = v_scope)
  ),
  grid as (
    select d.d, pe.id, pe.full_name from days d cross join people pe
  ),
  first_call as (
    select distinct on (c.enquiry_id) c.enquiry_id, c.id as call_id
      from public.calls c
     order by c.enquiry_id, c.call_date, c.called_at, c.id
  ),
  call_stats as (
    select
      c.called_by,
      c.call_date,
      count(*)::integer as calls_made,
      count(*) filter (where fc.call_id = c.id)::integer as fresh_handled,
      count(*) filter (
        where c.outcome = 'follow_up' and fc.call_id is distinct from c.id
      )::integer as follow_ups_done,
      count(*) filter (
        where c.outcome = 'call_back' and fc.call_id is distinct from c.id
      )::integer as call_backs,
      count(*) filter (where c.outcome = 'purchased')::integer as purchased_calls,
      count(*) filter (where c.outcome = 'competitor')::integer as competitor,
      count(*) filter (where c.outcome = 'closed')::integer as closed
    from public.calls c
    left join first_call fc on fc.enquiry_id = c.enquiry_id
    where c.call_date between p_from and p_to
    group by c.called_by, c.call_date
  ),
  won_amounts as (
    select c.called_by, c.call_date, sum(i.amount) as amount
      from public.enquiry_items i
      join public.calls c
        on c.enquiry_id = i.enquiry_id
       and c.outcome = 'purchased'
       and c.call_date = (i.won_at at time zone 'Asia/Kolkata')::date
     where i.won_at is not null
       and (i.won_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     group by c.called_by, c.call_date
  ),
  pli as (
    select
      a.actor_id,
      (a.at at time zone 'Asia/Kolkata')::date as d,
      count(*)::integer as n
    from public.audit_log a
    where a.table_name = 'enquiries'
      and a.actor_id is not null
      and a.actor_source <> 'service_role'
      and (a.new_data ->> 'importance') = 'a'
      and (a.action = 'insert' or (a.old_data ->> 'importance') is distinct from 'a')
      -- The status the row had when it was written. Housekeeping on a resolved
      -- enquiry is not a price list.
      and (a.new_data ->> 'status') = 'open'
      and (
        a.action = 'update'
        or not exists (
          select 1
            from public.import_rows ir
           where ir.enquiry_id::text = a.row_pk
        )
      )
      and (a.at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by 1, 2
  ),
  carried as (
    select asg.counsellor_id, asg.date as d, count(*)::integer as n
      from public.assignments asg
      join public.live_enquiries e on e.id = asg.enquiry_id
     where asg.date between p_from and p_to
       and not exists (
         select 1 from public.calls c
          where c.enquiry_id = asg.enquiry_id
            and c.call_date = asg.date
       )
       and (
         e.closed_at is null
         or (e.closed_at at time zone 'Asia/Kolkata')::date > asg.date
       )
     group by 1, 2
  )
  select
    g.d, g.id, g.full_name,
    coalesce(cs.calls_made, 0),
    coalesce(cs.fresh_handled, 0),
    coalesce(cs.follow_ups_done, 0),
    coalesce(cs.call_backs, 0),
    coalesce(cs.purchased_calls, 0),
    coalesce(wa.amount, 0)::numeric,
    coalesce(cs.competitor, 0),
    coalesce(cs.closed, 0),
    coalesce(pl.n, 0),
    coalesce(ca.n, 0)
  from grid g
  left join call_stats cs on cs.called_by = g.id and cs.call_date = g.d
  left join won_amounts wa on wa.called_by = g.id and wa.call_date = g.d
  left join pli pl on pl.actor_id = g.id and pl.d = g.d
  left join carried ca on ca.counsellor_id = g.id and ca.d = g.d
  order by g.d, g.full_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enquiries_table(p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_lost_reason lost_reason DEFAULT NULL::lost_reason, p_close_reason close_reason DEFAULT NULL::close_reason, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance DEFAULT NULL::importance, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_include_archived boolean DEFAULT false)
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
    and (p_teacher_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.teacher_id = p_teacher_id))
    and (p_course_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.course_id = p_course_id))
    and (p_subject_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.subject_id = p_subject_id))
    and (p_content_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.content_id = p_content_id))
    -- calls_discussion_trgm_idx (GIN, trigram) backs this.
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

-- ---------------------------------------------------------------------------
-- The partial indexes gain `archived_at is null` so they stay usable as the
-- archived set grows — without it the Brief 8 performance work degrades in
-- proportion to how much has been archived.
--
-- NOT run CONCURRENTLY, and it should be. Both `supabase db push` and
-- `supabase db query` wrap statements in a transaction, and CONCURRENTLY
-- cannot run inside one; there is no psql or node pg client on this project to
-- go around them. On a large live table, run the CONCURRENTLY form by hand
-- first and these become no-ops:
--
--   drop index concurrently enquiries_follow_up_queue_idx;
--   create index concurrently enquiries_follow_up_queue_idx
--     on public.enquiries (next_follow_up_date)
--     where status = 'open' and type = 'purchase' and archived_at is null;
--   ... and the same shape for the other two.
-- ---------------------------------------------------------------------------

drop index if exists enquiries_follow_up_queue_idx;
create index if not exists enquiries_follow_up_queue_idx
  on public.enquiries (next_follow_up_date)
  where status = 'open' and type = 'purchase' and archived_at is null;

drop index if exists enquiries_new_calls_idx;
create index if not exists enquiries_new_calls_idx
  on public.enquiries (importance, created_at)
  where status = 'open' and type = 'purchase' and fresh_call_date is null
    and archived_at is null;

drop index if exists enquiries_ticket_queue_idx;
create index if not exists enquiries_ticket_queue_idx
  on public.enquiries (next_follow_up_date)
  where type = 'after_sale' and status in ('open', 'escalated')
    and archived_at is null;
