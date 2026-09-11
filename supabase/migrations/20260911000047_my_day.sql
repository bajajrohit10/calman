-- My Day, keyed on the assignment rather than on the recommended list.
--
-- The screen used to render recommended_calls() filtered to one counsellor.
-- That was right while My Day was a set of bucket sections, and wrong the
-- moment it grew "pending / total" counts, because recommended_calls() only
-- ever returns open enquiries: the instant a call is logged as Purchased the
-- enquiry closes and the row disappears. The day's total would shrink every
-- time somebody sold something, and the Done list would be empty of exactly
-- the calls worth looking at.
--
-- So the membership of the list is now the assignment row — which does not
-- move when the enquiry closes — and the enquiry is joined on for display.
-- Status comes back with it, so a closed enquiry can be shown as closed
-- instead of silently dropped.
--
-- Only purchase enquiries. After-sale work is the Tickets tab, which reads
-- tickets_list() as the Tickets screen does; if both surfaces counted the same
-- row the tab totals would not add up to the day.

create or replace function public.my_day(
  p_date date default null,
  p_counsellor_id uuid default null
)
returns table (
  enquiry_id bigint,
  bucket public.assignment_bucket,
  bucket_rank smallint,
  student_id uuid,
  mobile text,
  student_name text,
  type public.enquiry_type,
  status public.enquiry_status,
  importance public.importance,
  term_name text,
  product_text text,
  next_follow_up_date date,
  is_overdue boolean,
  follow_up_slots_used smallint,
  top_content_priority smallint,
  teacher_names text[],
  item_count integer,
  called_today boolean,
  last_call_at timestamptz,
  last_outcome public.call_outcome
)
language sql
stable
set search_path to ''
as $function$
with target as (
  select
    coalesce(p_date, app.ist_today()) as d,
    coalesce(p_counsellor_id, (select auth.uid())) as who
),
mine as (
  select a.enquiry_id, a.bucket
    from public.assignments a
    cross join target t
   where a.date = t.d
     and a.counsellor_id = t.who
),
-- One pass over the day's calls for the day's enquiries, rather than a
-- correlated exists() per row: the Done split reads this for every row.
today_call as (
  select c.enquiry_id, max(c.called_at) as last_call_at
    from public.calls c
    join mine m on m.enquiry_id = c.enquiry_id
    cross join target t
   where c.call_date = t.d
   group by c.enquiry_id
)
select
  e.id,
  m.bucket,
  (case m.bucket
     when 'follow_up' then 1
     when 'offer'     then 2
     when 'fresh'     then 3
     when 'campaign'  then 4
     when 'call_back' then 5
   end)::smallint as bucket_rank,
  e.student_id,
  s.mobile,
  s.name,
  e.type,
  e.status,
  e.importance,
  tm.name,
  e.product_text,
  e.next_follow_up_date,
  (e.next_follow_up_date is not null and e.next_follow_up_date < t.d) as is_overdue,
  e.follow_up_slots_used,
  e.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = e.id and i.status = 'open') as teacher_names,
  (select count(*)::integer from public.enquiry_items i
    where i.enquiry_id = e.id) as item_count,
  (tc.enquiry_id is not null) as called_today,
  tc.last_call_at,
  (select c.outcome
     from public.calls c
    where c.enquiry_id = e.id
    order by c.call_date desc, c.called_at desc, c.id desc
    limit 1) as last_outcome
from mine m
join public.live_enquiries e on e.id = m.enquiry_id
join public.students s on s.id = e.student_id
cross join target t
left join public.terms tm on tm.id = e.term_id
left join today_call tc on tc.enquiry_id = e.id
where e.type = 'purchase'
-- §6 order, so the Pending list reads exactly as the sections used to. The
-- Done list is re-sorted by call time in the client; sorting it here as well
-- would mean two orders in one result set and neither being obvious.
order by
  (case m.bucket
     when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
     when 'campaign'  then 4 when 'call_back' then 5 end),
  e.importance nulls last,
  e.top_content_priority nulls last,
  e.next_follow_up_date nulls last,
  e.id;
$function$;

comment on function public.my_day is
  'One counsellor''s assigned day (§6). Keyed on assignments, so a row stays '
  'in its tab after the enquiry closes; called_today drives the Pending/Done '
  'split. Purchase only — after-sale is the Tickets tab.';

revoke all on function public.my_day from public;
grant execute on function public.my_day to authenticated;
