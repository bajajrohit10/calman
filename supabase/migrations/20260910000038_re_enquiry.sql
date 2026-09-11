-- §10.1 Re-upload rules: re-enquiry, and the log of every source a number
-- arrived through.
--
-- Two new pieces of state:
--
--   enquiries.re_enquired_at   the IST day a re-upload brought this lead back.
--                              Scoped to *today* in the New Calls predicate,
--                              not `is not null`: a re-enquiry surfaces for the
--                              day it arrived and then falls back into the
--                              normal follow-up queue. Otherwise every lead
--                              ever re-uploaded would pile up in New Calls for
--                              ever.
--
--   enquiry_sources            one row per arrival. The re-upload rules
--                              *override* an open enquiry's source, which
--                              would destroy the old value; this is where it
--                              survives.
--
-- Quick Add is untouched by all of this — the counsellor still chooses there.

alter table public.enquiries add column re_enquired_at date;

comment on column public.enquiries.re_enquired_at is
  'IST day a bulk re-upload brought this open enquiry back into New Calls. '
  'Set by app.import_re_enquire(); read by new_calls_pool for today only.';

create table public.enquiry_sources (
  id uuid primary key default gen_random_uuid(),
  enquiry_id bigint not null references public.enquiries (id) on delete cascade,
  -- Nullable: a row can arrive with no source, and that is still a fact worth
  -- recording.
  source_id uuid references public.sources (id),
  occurred_at timestamptz not null default now(),
  import_batch_id uuid references public.import_batches (id),
  note text
);

create index enquiry_sources_enquiry_idx
  on public.enquiry_sources (enquiry_id, occurred_at desc);

alter table public.enquiry_sources enable row level security;

create policy enquiry_sources_select on public.enquiry_sources
  for select to authenticated using ((select app.is_staff()));
create policy enquiry_sources_insert on public.enquiry_sources
  for insert to authenticated with check ((select app.is_staff()));

-- Backfill: one row per existing enquiry from its current source.
--
-- Without this the history panel would show "arrived via AC" for a re-upload
-- and nothing at all for the original, which reads as though the enquiry had
-- no source before — the opposite of what the log is for.
insert into public.enquiry_sources (enquiry_id, source_id, occurred_at, note)
select e.id, e.source_id, e.created_at,
       'Backfilled from the enquiry''s source when the log was introduced.'
  from public.enquiries e;

-- ---------------------------------------------------------------------------
-- New Calls membership
-- ---------------------------------------------------------------------------

create or replace function public.new_calls_pool(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_id uuid default null,
  p_importance public.importance default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_institute_id uuid default null
)
returns table (
  enquiry_id bigint,
  student_id uuid,
  mobile text,
  student_name text,
  importance public.importance,
  term_name text,
  source_name text,
  product_text text,
  teacher_names text,
  item_count integer,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
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
  from public.enquiries e
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  where e.type = 'purchase'
    and e.status = 'open'
    and e.archived_at is null
    -- Never called, OR brought back by a re-upload today (§10.1 rule c).
    -- fresh_call_date is trigger-derived from the call history, so the first
    -- half cannot drift from what the calls actually say.
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
    and (p_institute_id is null or exists (
          select 1 from public.enquiry_items i
            join public.teachers tch on tch.id = i.teacher_id
           where i.enquiry_id = e.id and i.status = 'open'
             and tch.institute_id = p_institute_id))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.importance,
  b.term_name, b.source_name, b.product_text, b.teacher_names, b.item_count,
  b.created_at,
  count(*) over () as total_count
from base b
-- Unchanged: importance A → D, then oldest first. A re-enquired lead keeps its
-- original created_at and so sorts by how long it has been on the books, not by
-- when it came back.
order by b.importance nulls last, b.created_at, b.enquiry_id
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$$;

revoke all on function public.new_calls_pool from public;
grant execute on function public.new_calls_pool to authenticated;

-- The partial index only covered the never-called half of that OR. A second
-- one covers the re-enquired half, and the planner bitmap-ORs them.
create index enquiries_re_enquired_idx
  on public.enquiries (re_enquired_at, importance, created_at)
  where status = 'open' and type = 'purchase' and archived_at is null
    and re_enquired_at is not null;

-- ---------------------------------------------------------------------------
-- The facet function's candidate set has to agree with the pool, or the counts
-- stop matching what clicking returns.
-- ---------------------------------------------------------------------------

create or replace function public.new_calls_facets(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_id uuid default null,
  p_importance public.importance default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null,
  p_institute_id uuid default null
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
          and i.course_id = p_course_id))              as m_course,
    (p_institute_id is null or exists (
       select 1 from public.enquiry_items i
         join public.teachers tch on tch.id = i.teacher_id
        where i.enquiry_id = e.id and i.status = 'open'
          and tch.institute_id = p_institute_id))      as m_institute
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
  select i.enquiry_id, i.teacher_id, i.course_id, tch.institute_id,
         c.m_source, c.m_term, c.m_imp, c.m_teacher, c.m_course, c.m_institute
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
    left join public.teachers tch on tch.id = i.teacher_id
)
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_course and i.m_institute
   and i.teacher_id is not null
 group by 2
union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_institute
   and i.course_id is not null
 group by 2
union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_imp and c.m_teacher and c.m_course and c.m_institute
   and c.term_id is not null
 group by 2
union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_term and c.m_imp and c.m_teacher and c.m_course and c.m_institute
   and c.source_id is not null
 group by 2
union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_institute
   and c.importance is not null
 group by 2
union all
select 'institute', i.institute_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_course
   and i.institute_id is not null
 group by 2
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_source and c.m_term and c.m_imp
   and c.m_teacher and c.m_course;
$$;

revoke all on function public.new_calls_facets from public;
grant execute on function public.new_calls_facets to authenticated;
