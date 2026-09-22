-- §57.1. "Added by" on the New Calls pool.
--
-- The most recent arrival decides, not the enquiry's creator: a lead that came
-- back last night through a Shopify file was added by Shopify, whoever first
-- typed the number months ago. Where no arrival was ever logged — a handful of
-- old rows — the creator is the honest fallback.
--
-- One lateral, defined once and joined by pool, tickets and facets alike, so
-- the three cannot come to disagree about who added a lead.
create or replace function app.added_by_of(p_enquiry_id bigint)
returns table (actor_id uuid, label text)
language sql
stable
set search_path to ''
as $$
  select
    case when es.added_via = 'shopify' then null
         else coalesce(es.added_by, e.created_by) end,
    case when es.added_via = 'shopify' then 'Shopify'
         else coalesce(pr.full_name, cp.full_name, '—') end
    from public.enquiries e
    -- The most recent arrival. A left join, so an enquiry with none — a
    -- handful of old rows predate the source log — still answers, from its
    -- creator.
    left join lateral (
      select x.added_by, x.added_via
        from public.enquiry_sources x
       where x.enquiry_id = e.id
       order by x.occurred_at desc, x.id desc
       limit 1
    ) es on true
    left join public.profiles pr on pr.id = es.added_by
    left join public.profiles cp on cp.id = e.created_by
   where e.id = p_enquiry_id;
$$;

grant execute on function app.added_by_of(bigint) to authenticated, service_role;

-- The pool gains the column, a filter and a sort. Dropped and recreated
-- because the signature changes on both counts.
do $$
declare sig text;
begin
  select p.oid::regprocedure::text into sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_pool';
  execute format('drop function %s', sig);
end $$;

create function public.new_calls_pool(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_ids uuid[] default null,
  p_importance public.importance[] default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null,
  p_content_ids uuid[] default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_institute_id uuid default null,
  p_call_types text[] default null,
  /** §57.1: profile ids, plus the literal 'shopify' for the store's own. */
  p_added_by text[] default null,
  p_sort text default 'default',
  p_dir text default 'asc'
)
returns table (
  enquiry_id bigint, student_id uuid, mobile text, student_name text,
  importance public.importance, term_name text, source_name text,
  product_text text, teacher_names text, item_count integer,
  created_at timestamptz, re_enquired_at date, call_type text,
  arrived_at timestamptz, added_by_name text, added_by_id uuid,
  total_count bigint
)
language sql
stable
set search_path to ''
as $function$
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
    e.call_type,
    coalesce(e.arrived_at, e.created_at) as arrived_at,
    ab.label as added_by_name,
    ab.actor_id as added_by_id,
    coalesce(e.re_enquired_at,
             (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date)
      as arrived_on
  from public.enquiries e
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  left join lateral app.added_by_of(e.id) ab on true
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
    and (p_call_types is null or cardinality(p_call_types) = 0
         or e.call_type = any (p_call_types))
    -- §57.1. 'shopify' is a value like any other here: it is a real answer to
    -- "who added this", and a filter that could not express it would be a
    -- filter that hides the store's own leads.
    and (p_added_by is null or cardinality(p_added_by) = 0
         or (ab.actor_id is not null and ab.actor_id::text = any (p_added_by))
         or (ab.actor_id is null and ab.label = 'Shopify' and 'shopify' = any (p_added_by)))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.importance,
  b.term_name, b.source_name, b.product_text, b.teacher_names, b.item_count,
  b.created_at, b.re_enquired_at, b.call_type, b.arrived_at,
  b.added_by_name, b.added_by_id,
  count(*) over () as total_count
from base b
order by
  -- Sorting by who added it is a different question from working the queue, so
  -- it replaces the importance ordering rather than tie-breaking inside it.
  case when p_sort = 'added_by' and lower(coalesce(p_dir,'asc')) = 'asc'
       then b.added_by_name end asc nulls last,
  case when p_sort = 'added_by' and lower(coalesce(p_dir,'asc')) <> 'asc'
       then b.added_by_name end desc nulls last,
  -- Importance A → D, then oldest arrival first. A lead that came back today
  -- sits with today's arrivals rather than with the six-month-old leads it was
  -- created alongside.
  b.importance nulls last, b.arrived_on, b.arrived_at, b.enquiry_id
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

grant execute on function public.new_calls_pool(
  uuid[], uuid, uuid[], public.importance[], uuid, date, date, text, uuid[],
  integer, integer, uuid, text[], text[], text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
