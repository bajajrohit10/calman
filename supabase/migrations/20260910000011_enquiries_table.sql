-- §5.6 Enquiries table: every enquiry, every status, sortable and paged.
--
-- Separate from recommended_calls() because that one is pinned to a single
-- status, a single type and §6's fixed ordering — it answers "what should be
-- called today", which is a different question from "show me everything".
--
-- SECURITY INVOKER, like recommended_calls: it reads through the caller's RLS.
--
-- Sorting is done without dynamic SQL. Each row computes one numeric and one
-- text sort key, only one of which is populated for a given p_sort, and the
-- ORDER BY picks whichever is filled in the requested direction. That keeps
-- the whole thing a plain SQL function — no EXECUTE, so no column name from
-- the client ever reaches the parser.

create or replace function public.enquiries_table(
  p_type public.enquiry_type default null,
  p_status public.enquiry_status default null,
  p_lost_reason public.lost_reason default null,
  p_close_reason public.close_reason default null,
  p_counsellor_id uuid default null,
  p_teacher_id uuid default null,
  p_course_id uuid default null,
  p_subject_id uuid default null,
  p_content_id uuid default null,
  p_term_id uuid default null,
  p_source_id uuid default null,
  p_importance public.importance default null,
  p_created_from date default null,
  p_created_to date default null,
  p_follow_up_from date default null,
  p_follow_up_to date default null,
  p_discussion text default null,
  p_mobile text default null,
  p_sort text default 'created_at',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  enquiry_id bigint,
  student_id uuid,
  mobile text,
  student_name text,
  type public.enquiry_type,
  status public.enquiry_status,
  lost_reason public.lost_reason,
  close_reason public.close_reason,
  importance public.importance,
  lead_verification public.lead_verification,
  term_name text,
  source_name text,
  product_text text,
  next_follow_up_date date,
  fresh_call_date date,
  follow_up_slots_used smallint,
  created_at timestamptz,
  closed_at timestamptz,
  item_count integer,
  teacher_names text,
  last_call_at timestamptz,
  last_outcome public.call_outcome,
  last_discussion text,
  assigned_to_name text,
  assigned_date date,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
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
  where (p_type is null or e.type = p_type)
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
$$;

comment on function public.enquiries_table is
  '§5.6: every enquiry, filterable on every input field, sortable and paged. '
  'Sorting uses precomputed keys rather than dynamic SQL.';

revoke all on function public.enquiries_table from public;
grant execute on function public.enquiries_table to authenticated;
