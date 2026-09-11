-- recommended_calls: decide the page first, decorate it second.
--
-- Found by measuring the facet work against a 5,000-enquiry set (Brief 8).
-- The function took 1,767 ms to return 50 rows. The filters, the bucket
-- derivation and app.next_working_day() are not the problem — inlined, the
-- same work is 95 ms.
--
-- The cause is that a SQL function carrying `SET search_path` cannot be
-- inlined by the planner. It runs as an opaque Function Scan, so the LIMIT
-- cannot be pushed inside it: every row that passes the due-date filter gets
-- its teacher_names aggregate and item_count built, 3,527 of them, to display
-- fifty. Dropping `SET search_path` to regain inlining is not an option — it
-- is what stops a caller's search_path deciding which `enquiry_items` this
-- reads.
--
-- So the shape changes instead. Everything needed to *filter and order* stays
-- ahead of the LIMIT; the two per-row aggregates and the counsellor's name are
-- deferred to a join against the fifty rows that survive it. Same rows, same
-- order, same totals — count(*) over () is still evaluated across the whole
-- filtered set before the LIMIT applies.
--
-- One behaviour change, from Brief 8 decision (2): the teacher/course/subject/
-- content filters now match *open* items only. They already displayed open
-- items only (teacher_names has filtered on i.status = 'open' since 0008), so
-- filtering by a teacher whose line was won or lost and getting a row back
-- whose teacher column does not mention them was already wrong. It also has to
-- hold for the facet counts to mean anything: "Bhanwar (12 numbers)" has to be
-- twelve rows when you click it.

create or replace function public.recommended_calls(
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
  from public.enquiries e
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
$$;

comment on function public.recommended_calls is
  'The §6 recommended call list for one date: open purchase enquiries due for '
  'action, bucketed and ordered bucket → importance → content priority → '
  'oldest follow-up date. Overdue is derived at read time. p_include_not_due '
  'lifts only the due-date restriction, for the §5.5 campaign filter. Item '
  'filters match open items only. The page is chosen before the per-row '
  'lookups are paid for — see the migration header.';

revoke all on function public.recommended_calls from public;
grant execute on function public.recommended_calls to authenticated;

-- Serves the bucket lookup above: newest call for an enquiry in one descent.
create index if not exists calls_enquiry_latest_idx
  on public.calls (enquiry_id, call_date desc, called_at desc, id desc);

-- The facet query groups by each of the four item columns over an enquiry set,
-- restricted to open lines. These make that an index-only path rather than a
-- heap scan of every line ever recorded.
create index if not exists enquiry_items_open_teacher_idx
  on public.enquiry_items (teacher_id, enquiry_id) where status = 'open';
create index if not exists enquiry_items_open_course_idx
  on public.enquiry_items (course_id, enquiry_id) where status = 'open';
create index if not exists enquiry_items_open_subject_idx
  on public.enquiry_items (subject_id, enquiry_id) where status = 'open';
create index if not exists enquiry_items_open_content_idx
  on public.enquiry_items (content_id, enquiry_id) where status = 'open';
