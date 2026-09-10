-- §5.12 New Calls: the pool of leads nobody has spoken to or claimed.
--
-- Distinct from recommended_calls(): that answers "what should be called
-- today", which includes follow-ups and call backs and is ordered by §6's
-- bucket rules. This answers "what has nobody touched at all" — never called,
-- unclaimed for today — and is ordered simply by how important the lead looks
-- and how long it has been sitting there.
--
-- SECURITY INVOKER, like the other list functions: it reads through the
-- caller's RLS.

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
  p_offset integer default 0
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
      where i.enquiry_id = e.id) as teacher_names,
    (select count(*)::integer from public.enquiry_items i where i.enquiry_id = e.id)
      as item_count,
    e.created_at
  from public.enquiries e
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
           where i.enquiry_id = e.id and i.course_id = p_course_id))
    and (p_teacher_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.teacher_id = p_teacher_id))
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
$$;

comment on function public.new_calls_pool is
  '§5.12: open purchase enquiries never called and unclaimed today, by '
  'importance then age.';

revoke all on function public.new_calls_pool from public;
grant execute on function public.new_calls_pool to authenticated;

-- Drives both the page and the sidebar badge.
create index if not exists enquiries_new_calls_idx
  on public.enquiries (importance, created_at)
  where status = 'open' and type = 'purchase' and fresh_call_date is null;
