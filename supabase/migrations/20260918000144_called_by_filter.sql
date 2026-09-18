-- §7.2. "Called by" on the Enquiries table.
--
-- The Counsellor filter asks whose lead it is today and "Last called by" asks
-- who made the most recent call. Neither answers the question a counsellor
-- actually opens this screen with, which is "what did I ring this morning" —
-- a lead called three times today by three people is only the third person's
-- under the old filters, and invisible to the other two.
--
-- So: at least one call by any of the named people, inside the window the
-- screen is already showing. The window is Enquired-between, deliberately —
-- the two controls sit next to each other and read as one sentence, and the
-- default pairing (me + today) is the sentence the feedback asked for.

-- The parameter list changes, so the function is dropped rather than replaced:
-- CREATE OR REPLACE with an extra argument leaves an overload behind and
-- PostgREST then cannot tell which one a call means.
do $$
declare sig text;
begin
  select p.oid::regprocedure::text into sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enquiries_table';
  if sig is null then raise exception 'public.enquiries_table not found'; end if;
  execute format('drop function %s', sig);
end $$;

create function public.enquiries_table(
  p_type public.enquiry_type default null,
  p_status public.enquiry_status default null,
  p_lost_reason public.lost_reason default null,
  p_close_reason public.close_reason default null,
  p_counsellor_id uuid default null,
  p_teacher_ids uuid[] default null,
  p_course_id uuid default null,
  p_subject_id uuid default null,
  p_content_ids uuid[] default null,
  p_term_id uuid default null,
  p_source_id uuid default null,
  p_importance public.importance[] default null,
  p_created_from date default null,
  p_created_to date default null,
  p_follow_up_from date default null,
  p_follow_up_to date default null,
  p_discussion text default null,
  p_mobile text default null,
  p_sort text default 'created_at',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_include_archived boolean default false,
  p_stages text[] default null,
  p_last_called_from date default null,
  p_last_called_to date default null,
  p_called_by uuid[] default null
)
returns table (
  enquiry_id bigint, student_id uuid, mobile text, student_name text,
  type public.enquiry_type, status public.enquiry_status,
  lost_reason public.lost_reason, close_reason public.close_reason,
  importance public.importance, lead_verification public.lead_verification,
  term_name text, source_name text, product_text text,
  next_follow_up_date date, fresh_call_date date, follow_up_slots_used smallint,
  created_at timestamptz, arrived_at timestamptz, closed_at timestamptz,
  item_count integer, teacher_names text, last_call_at timestamptz,
  last_outcome public.call_outcome, last_discussion text,
  assigned_to_name text, assigned_date date, total_count bigint
)
language sql
stable
set search_path to ''
as $function$
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
    coalesce(e.arrived_at, e.created_at) as arrived_at,
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
      when 'created_at'          then extract(epoch from coalesce(e.arrived_at, e.created_at))
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
    and (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance))
    and (p_mobile is null or s.mobile like '%' || p_mobile || '%')
    and (p_created_from is null
         or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date <= p_created_to)
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
    and ((p_stages is null or cardinality(p_stages) = 0) or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome)
         = any (p_stages))
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
    -- §7.2. At least one call by one of these people, inside the window. The
    -- window is the created-date window on purpose: the control sits beside
    -- "Enquired between" and the pair is read as one sentence.
    and ((p_called_by is null or cardinality(p_called_by) = 0) or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.called_by = any (p_called_by)
             and (p_created_from is null or c.call_date >= p_created_from)
             and (p_created_to is null or c.call_date <= p_created_to)))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.type, b.status,
  b.lost_reason, b.close_reason, b.importance, b.lead_verification,
  b.term_name, b.source_name, b.product_text, b.next_follow_up_date,
  b.fresh_call_date, b.follow_up_slots_used, b.created_at, b.arrived_at, b.closed_at,
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

grant execute on function public.enquiries_table(
  public.enquiry_type, public.enquiry_status, public.lost_reason, public.close_reason,
  uuid, uuid[], uuid, uuid, uuid[], uuid, uuid, public.importance[],
  date, date, date, date, text, text, text, text, integer, integer,
  boolean, text[], date, date, uuid[]
) to authenticated, service_role;

-- §7.2. What is behind each name, and the guard row.
--
-- The Enquiries screen had no facet counts at all — it is the one filter bar
-- that was built without them. Adding a whole facet set here would be a second
-- copy of every filter; this is the one facet the brief asks for, so it is the
-- one facet this computes, plus the `_total` row every facet map carries so a
-- disagreement between the counts and the list shows up as no counts rather
-- than as wrong counts.
--
-- The counts deliberately ignore p_called_by and obey everything else: an
-- option says how many enquiries it would give you if you picked it, which is
-- the only reading that makes clicking one predictable.
create function public.enquiries_called_by_facets(
  p_type public.enquiry_type default null,
  p_status public.enquiry_status default null,
  p_lost_reason public.lost_reason default null,
  p_close_reason public.close_reason default null,
  p_counsellor_id uuid default null,
  p_teacher_ids uuid[] default null,
  p_course_id uuid default null,
  p_subject_id uuid default null,
  p_content_ids uuid[] default null,
  p_term_id uuid default null,
  p_source_id uuid default null,
  p_importance public.importance[] default null,
  p_created_from date default null,
  p_created_to date default null,
  p_follow_up_from date default null,
  p_follow_up_to date default null,
  p_discussion text default null,
  p_mobile text default null,
  p_include_archived boolean default false,
  p_stages text[] default null,
  p_last_called_from date default null,
  p_last_called_to date default null,
  p_called_by uuid[] default null
)
returns table (facet text, value_id text, numbers integer, items integer)
language sql
stable
set search_path to ''
as $function$
with last_call as (
  select distinct on (c.enquiry_id) c.enquiry_id, c.outcome
    from public.calls c
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
last_assignment as (
  select distinct on (a.enquiry_id) a.enquiry_id, a.counsellor_id
    from public.assignments a
   order by a.enquiry_id, a.date desc
),
-- Every (enquiry, caller) pair inside the window, once each. Counted as
-- "numbers" by distinct enquiry and as "items" by the calls themselves, so a
-- reader who wants "how many calls" can still have it.
in_window as (
  select c.enquiry_id, c.called_by, count(*)::integer as calls
    from public.calls c
   where (p_created_from is null or c.call_date >= p_created_from)
     and (p_created_to is null or c.call_date <= p_created_to)
   group by c.enquiry_id, c.called_by
),
cand as materialized (
  select e.id,
         ((p_called_by is null or cardinality(p_called_by) = 0) or exists (
            select 1 from in_window w
             where w.enquiry_id = e.id and w.called_by = any (p_called_by))) as m_called_by
    from public.enquiries e
    join public.students s on s.id = e.student_id
    left join last_call lc on lc.enquiry_id = e.id
    left join last_assignment la on la.enquiry_id = e.id
   where (p_include_archived or e.archived_at is null)
     and (p_type is null or e.type = p_type)
     and (p_status is null or e.status = p_status)
     and (p_lost_reason is null or e.lost_reason = p_lost_reason)
     and (p_close_reason is null or e.close_reason = p_close_reason)
     and (p_counsellor_id is null or la.counsellor_id = p_counsellor_id)
     and (p_term_id is null or e.term_id = p_term_id)
     and (p_source_id is null or e.source_id = p_source_id)
     and (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance))
     and (p_mobile is null or s.mobile like '%' || p_mobile || '%')
     and (p_created_from is null
          or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date >= p_created_from)
     and (p_created_to is null
          or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date <= p_created_to)
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
     and ((p_stages is null or cardinality(p_stages) = 0)
          or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome) = any (p_stages))
     and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
     and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
     and (p_discussion is null or exists (
           select 1 from public.calls c
            where c.enquiry_id = e.id
              and c.discussion ilike '%' || p_discussion || '%'))
)
select 'called_by'::text, w.called_by::text,
       count(distinct w.enquiry_id)::integer, sum(w.calls)::integer
  from cand c
  join in_window w on w.enquiry_id = c.id
 group by w.called_by
union all
select '_total'::text, null::text, count(*)::integer, count(*)::integer
  from cand c
 where c.m_called_by;
$function$;

grant execute on function public.enquiries_called_by_facets(
  public.enquiry_type, public.enquiry_status, public.lost_reason, public.close_reason,
  uuid, uuid[], uuid, uuid, uuid[], uuid, uuid, public.importance[],
  date, date, date, date, text, text, boolean, text[], date, date, uuid[]
) to authenticated, service_role;

-- The exists() above walks the calls of one enquiry and filters by who made
-- them; without this it is an index scan on enquiry_id followed by a filter on
-- every call that lead has ever had.
create index if not exists calls_caller_date_idx
  on public.calls (called_by, call_date);

notify pgrst, 'reload schema';
