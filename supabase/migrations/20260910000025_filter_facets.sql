-- §5.5/§5.12 faceted filter counts.
--
-- One function per screen rather than one per facet. The expensive part of
-- both screens is establishing the candidate set — for the desk that means the
-- due-date derivation over every open enquiry — and leave-one-out faceting
-- needs that set nine times. One call establishes it once, in a materialized
-- CTE, and runs nine grouped aggregates over it.
--
-- Leave-one-out is the whole trick: a facet's counts are computed with every
-- *other* active filter applied but not its own, so picking a teacher does not
-- collapse the teacher list to the one you already picked.
--
-- Brief 8 decision (2): for teacher/course/subject/content, `numbers` is the
-- distinct enquiries carrying at least one OPEN line matching the option and
-- `items` is how many such open lines there are. Won and lost lines do not
-- count — the desk is about who still needs calling. recommended_calls filters
-- on open items too (migration 0024), so the count a counsellor reads is the
-- number of rows they get when they click it.
--
-- `_total` is a guard row: the same candidate set with *every* filter applied.
-- The page compares it to the list's own total_count and falls back to plain
-- option labels if they disagree, because two queries that are meant to agree
-- about scope will eventually stop agreeing, and wrong counts are worse than
-- no counts.

create or replace function public.recommended_facets(
  p_date date default null,
  p_include_not_due boolean default false,
  p_counsellor_id uuid default null,
  p_teacher_id uuid default null,
  p_course_id uuid default null,
  p_subject_id uuid default null,
  p_content_id uuid default null,
  p_term_id uuid default null,
  p_source_id uuid default null,
  p_importance public.importance default null,
  p_type public.enquiry_type default null,
  p_status public.enquiry_status default null,
  p_created_from date default null,
  p_created_to date default null,
  p_follow_up_from date default null,
  p_follow_up_to date default null,
  p_discussion text default null
)
returns table (
  facet text,
  value_id text,
  numbers integer,
  items integer
)
language sql
stable
security invoker
set search_path = ''
as $$
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
  from public.enquiries e
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
$$;

comment on function public.recommended_facets is
  'Faceted option counts for the Assignment Desk, leave-one-out against the '
  'same scope as recommended_calls(). Item facets count open lines only. The '
  '_total row is the guard: it must equal the list total_count.';

revoke all on function public.recommended_facets from public;
grant execute on function public.recommended_facets to authenticated;

-- ---------------------------------------------------------------------------
-- New Calls (§5.12). Same idea, cheaper base: the pool is never-called and
-- unclaimed, so there is no due-date derivation to pay for.
--
-- Source is multi-select on this screen, so its facet drops the whole array
-- rather than one value, and each option shows what it is worth on its own
-- within the rest of the filter.
-- ---------------------------------------------------------------------------

create or replace function public.new_calls_facets(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_id uuid default null,
  p_importance public.importance default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null
)
returns table (
  facet text,
  value_id text,
  numbers integer,
  items integer
)
language sql
stable
security invoker
set search_path = ''
as $$
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
  from public.enquiries e
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
$$;

comment on function public.new_calls_facets is
  'Faceted option counts for New Calls, leave-one-out against the same scope '
  'as new_calls_pool(). Item facets count open lines only.';

revoke all on function public.new_calls_facets from public;
grant execute on function public.new_calls_facets to authenticated;
