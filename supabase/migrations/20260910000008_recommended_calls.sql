-- §6 recommended call list.
--
-- SECURITY INVOKER (the default, stated for the avoidance of doubt): the
-- function reads through the caller's RLS, so a counsellor calling it sees
-- exactly what a counsellor may see. A DEFINER version would quietly hand
-- every counsellor the whole pipeline.
--
-- A function rather than a view because the chosen date is the entire job:
-- "due", "overdue" and the queue position are all computed relative to it, and
-- a view cannot take a parameter. Every filter is a parameter too, so
-- filtering, ordering and paging happen in one place and cannot disagree.
--
-- §4.6: the stored next_follow_up_date is NEVER rewritten. Overdue is derived
-- here, at read time, and the queue position rolls forward to the next working
-- day. That keeps the original date — which is what §6 sorts on — and needs no
-- nightly job.

create or replace function public.recommended_calls(
  p_date date default null,
  -- Campaign mode (§5.5): lifts the due-date restriction and nothing else.
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
  p_discussion text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  enquiry_id bigint,
  bucket public.assignment_bucket,
  bucket_rank smallint,
  is_overdue boolean,
  due_date date,
  student_id uuid,
  mobile text,
  student_name text,
  type public.enquiry_type,
  status public.enquiry_status,
  importance public.importance,
  term_id uuid,
  term_name text,
  source_id uuid,
  source_name text,
  product_text text,
  next_follow_up_date date,
  created_at timestamptz,
  follow_up_slots_used smallint,
  top_content_priority smallint,
  teacher_names text[],
  item_count integer,
  assigned_to uuid,
  assigned_to_name text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
with target as (
  select coalesce(p_date, app.ist_today()) as d
),
scope as (
  select e.id
    from public.enquiries e
   where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
     and e.status = coalesce(p_status, 'open'::public.enquiry_status)
),
-- One row per enquiry: the call that decides which bucket it is in. Done once
-- as a DISTINCT ON over the bounded set rather than as a correlated subquery
-- per row.
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id,
         c.outcome
    from public.calls c
   where c.enquiry_id in (select id from scope)
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
base as (
  select
    e.id as enquiry_id,
    case
      -- Decision: "fresh" is never-called, not created-today. A fresh lead has
      -- no follow-up date, so dropping it out of this bucket after a day would
      -- leave it in no bucket at all — silently lost.
      when e.fresh_call_date is null then 'fresh'::public.assignment_bucket
      when lc.outcome = 'call_back' then 'call_back'::public.assignment_bucket
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
    s.mobile,
    s.name as student_name,
    e.type,
    e.status,
    e.importance,
    e.term_id,
    tm.name as term_name,
    e.source_id,
    src.name as source_name,
    e.product_text,
    e.next_follow_up_date,
    e.created_at,
    e.follow_up_slots_used,
    e.top_content_priority,
    (select array_agg(distinct tch.name order by tch.name)
       from public.enquiry_items i
       join public.teachers tch on tch.id = i.teacher_id
      where i.enquiry_id = e.id
        and i.status = 'open') as teacher_names,
    (select count(*)::integer
       from public.enquiry_items i
      where i.enquiry_id = e.id) as item_count,
    a.counsellor_id as assigned_to,
    pr.full_name as assigned_to_name,
    t.d as target_date
  from public.enquiries e
  cross join target t
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  left join last_call lc on lc.enquiry_id = e.id
  -- Assignment is per day (§3), so this is the owner for the chosen date only.
  left join public.assignments a on a.enquiry_id = e.id and a.date = t.d
  left join public.profiles pr on pr.id = a.counsellor_id
  where e.id in (select id from scope)
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
    -- calls_discussion_trgm_idx (GIN, trigram) makes this an index lookup.
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
)
select
  b.enquiry_id,
  b.bucket,
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
  b.is_overdue,
  b.due_date,
  b.student_id,
  b.mobile,
  b.student_name,
  b.type,
  b.status,
  b.importance,
  b.term_id,
  b.term_name,
  b.source_id,
  b.source_name,
  b.product_text,
  b.next_follow_up_date,
  b.created_at,
  b.follow_up_slots_used,
  b.top_content_priority,
  b.teacher_names,
  b.item_count,
  b.assigned_to,
  b.assigned_to_name,
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
offset coalesce(p_offset, 0);
$$;

comment on function public.recommended_calls is
  'The §6 recommended call list for one date: open purchase enquiries due for '
  'action, bucketed and ordered bucket → importance → content priority → '
  'oldest follow-up date. Overdue is derived at read time. p_include_not_due '
  'lifts only the due-date restriction, for the §5.5 campaign filter.';

revoke all on function public.recommended_calls from public;
grant execute on function public.recommended_calls to authenticated;
