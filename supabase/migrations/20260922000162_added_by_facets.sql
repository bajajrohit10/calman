-- §57.1. "Added by" everywhere the pool is counted, and on the student card.
--
-- Three functions describe the same pool — the list, the filter counts and the
-- type tabs — and a filter that only one of them understands is a filter that
-- makes the other two disagree with it. So the parameter lands in all three at
-- once, and the counts gain the dimension the list gained.

-- §57.1. The same answer for a handful of enquiries at once.
--
-- The student history shows a card per enquiry and asks the question once per
-- card; one round trip for the set is the difference between a query and a
-- loop. It delegates to app.added_by_of rather than restating the rule — the
-- Now card and New Calls must never be able to print different names for the
-- same lead.
create or replace function public.added_by_for(p_enquiry_ids bigint[])
returns table (enquiry_id bigint, actor_id uuid, label text)
language sql
stable
set search_path to ''
as $$
  select e.id, ab.actor_id, ab.label
    from public.enquiries e
    left join lateral app.added_by_of(e.id) ab on true
   where e.id = any (p_enquiry_ids);
$$;

grant execute on function public.added_by_for(bigint[]) to authenticated, service_role;

-- The after-sale half of the pool answers the same question. Its return type
-- changes, so it is dropped rather than replaced.
do $$
declare sig text;
begin
  select p.oid::regprocedure::text into sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_after_sale';
  execute format('drop function %s', sig);
end $$;

create function public.new_calls_after_sale(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  enquiry_id bigint, student_id uuid, mobile text, student_name text,
  status public.enquiry_status, issue_category public.issue_category,
  reminder_date date, last_discussion text, last_caller_name text,
  last_call_date date, call_count integer, re_enquired_at date,
  is_overdue boolean, never_called boolean,
  added_by_name text, added_by_id uuid,
  total_count bigint
)
language sql
stable
set search_path to ''
as $function$
with last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.call_date, c.discussion, c.issue_category, pr.full_name
    from public.calls c
    left join public.profiles pr on pr.id = c.called_by
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
    lc.issue_category,
    e.next_follow_up_date as reminder_date,
    lc.discussion as last_discussion,
    lc.full_name as last_caller_name,
    lc.call_date as last_call_date,
    (select count(*)::integer from public.calls c where c.enquiry_id = e.id) as call_count,
    e.re_enquired_at,
    (e.next_follow_up_date is not null
       and e.next_follow_up_date < app.ist_today()) as is_overdue,
    (lc.enquiry_id is null) as never_called,
    ab.label as added_by_name,
    ab.actor_id as added_by_id
  from public.live_enquiries e
  join public.students s on s.id = e.student_id
  left join last_call lc on lc.enquiry_id = e.id
  left join lateral app.added_by_of(e.id) ab on true
  where e.type = 'after_sale'
    and e.status in ('open', 'escalated')
    -- Never called at all, or called before and re-contacted since.
    and (lc.enquiry_id is null or e.re_enquired_at is not null)
    -- Nobody has spoken to them today; if they have, it is not waiting.
    and (
      e.re_enquired_at = app.ist_today()
      or not exists (
        select 1 from public.calls c
         where c.enquiry_id = e.id and c.call_date = app.ist_today()
      )
    )
)
select
  b.*,
  count(*) over () as total_count
from base b
order by b.never_called desc, b.reminder_date asc nulls last, b.enquiry_id desc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

grant execute on function public.new_calls_after_sale(integer, integer)
  to authenticated, service_role;

-- The type tabs count the same pool through the same function, so the new
-- parameter has to reach it or "Added by: Nilavo" would narrow the list and
-- leave the Video/Books/Unknown counts describing everybody.
do $$
declare sig text;
begin
  select p.oid::regprocedure::text into sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_type_counts';
  execute format('drop function %s', sig);
end $$;

create function public.new_calls_type_counts(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_ids uuid[] default null,
  p_importance public.importance[] default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null,
  p_content_ids uuid[] default null,
  p_institute_id uuid default null,
  p_added_by text[] default null
)
returns table (call_type text, n integer)
language sql
stable
set search_path to ''
as $function$
  select p.call_type, count(*)::integer
    from public.new_calls_pool(
           p_source_ids   => p_source_ids,
           p_course_id    => p_course_id,
           p_teacher_ids  => p_teacher_ids,
           p_importance   => p_importance,
           p_term_id      => p_term_id,
           p_created_from => p_created_from,
           p_created_to   => p_created_to,
           p_product_text => p_product_text,
           p_content_ids  => p_content_ids,
           p_institute_id => p_institute_id,
           p_added_by     => p_added_by,
           -- Everything the filters allow, so the counts describe the whole
           -- pool and not the first page of it.
           p_limit        => 1000000,
           p_offset       => 0,
           p_call_types   => null
         ) p
   group by p.call_type;
$function$;

grant execute on function public.new_calls_type_counts(
  uuid[], uuid, uuid[], public.importance[], uuid, date, date, text, uuid[],
  uuid, text[]
) to authenticated, service_role;

-- §57.1. The counts gain the dimension.
--
-- Same shape as every other facet here: each branch applies every filter
-- except its own, so the options under "Added by" still show what picking
-- them would give rather than collapsing to the current choice.
do $$
declare sig text;
begin
  select p.oid::regprocedure::text into sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_facets';
  execute format('drop function %s', sig);
end $$;

create function public.new_calls_facets(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_ids uuid[] default null,
  p_importance public.importance[] default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null,
  p_content_ids uuid[] default null,
  p_institute_id uuid default null,
  p_call_types text[] default null,
  p_added_by text[] default null
)
returns table (facet text, value_id text, numbers integer, items integer)
language sql
stable
set search_path to ''
as $function$
with cand as materialized (
  select
    e.id,
    e.term_id,
    e.source_id,
    e.importance,
    ab.actor_id as added_by_id,
    ab.label    as added_by_label,
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
          and i.content_id = any (p_content_ids)))      as m_content,
    -- §57.1. 'shopify' is a value like any other: it is a real answer to
    -- "who added this", and a filter unable to express it would be a filter
    -- that hides the store's own leads.
    (p_added_by is null or cardinality(p_added_by) = 0
       or (ab.actor_id is not null and ab.actor_id::text = any (p_added_by))
       or (ab.actor_id is null and ab.label = 'Shopify'
           and 'shopify' = any (p_added_by)))           as m_added
  from public.enquiries e
  left join lateral app.added_by_of(e.id) ab on true
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
    and (p_call_types is null or cardinality(p_call_types) = 0
         or e.call_type = any (p_call_types))
),
lines as materialized (
  select i.enquiry_id, i.teacher_id, i.course_id, i.content_id, tch.institute_id,
         c.m_source, c.m_term, c.m_imp, c.m_teacher, c.m_course, c.m_institute,
         c.m_content, c.m_added
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
    left join public.teachers tch on tch.id = i.teacher_id
)
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_course and i.m_institute and i.m_content
   and i.m_added
   and i.teacher_id is not null
 group by 2
union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_institute and i.m_content
   and i.m_added
   and i.course_id is not null
 group by 2
union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_imp and c.m_teacher and c.m_course and c.m_institute and c.m_content
   and c.m_added
   and c.term_id is not null
 group by 2
union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_term and c.m_imp and c.m_teacher and c.m_course and c.m_institute and c.m_content
   and c.m_added
   and c.source_id is not null
 group by 2
union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_institute and c.m_content
   and c.m_added
   and c.importance is not null
 group by 2
union all
select 'content', i.content_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_course
   and i.m_institute and i.m_added
   and i.content_id is not null
 group by 2
union all
select 'institute', i.institute_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_source and i.m_term and i.m_imp and i.m_teacher and i.m_course
   and i.m_content and i.m_added
   and i.institute_id is not null
 group by 2
union all
-- The store's own leads answer under the literal 'shopify'; a lead whose
-- arrival credits nobody at all — a handful of old hand-logged rows — has no
-- option to sit under and is counted in no bucket, exactly as a lead with no
-- term is absent from the term facet.
select 'added_by',
       coalesce(c.added_by_id::text,
                case when c.added_by_label = 'Shopify' then 'shopify' end),
       count(*)::integer, 0
  from cand c
 where c.m_source and c.m_term and c.m_imp and c.m_teacher and c.m_course
   and c.m_institute and c.m_content
   and (c.added_by_id is not null or c.added_by_label = 'Shopify')
 group by 2
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_content and c.m_source and c.m_term and c.m_imp
   and c.m_teacher and c.m_course and c.m_added;
$function$;

grant execute on function public.new_calls_facets(
  uuid[], uuid, uuid[], public.importance[], uuid, date, date, text, uuid[],
  uuid, text[], text[]
) to authenticated, service_role;

notify pgrst, 'reload schema';
