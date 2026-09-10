-- §5.11 Tickets: the after-sale queue.
--
-- Its own function rather than a reuse of enquiries_table() for two reasons.
-- The queue is "not closed", which is two statuses and that one takes a single
-- value; and the things a ticket is filtered by — issue category, and who is
-- working it — live on the *calls*, not the enquiry. An after-sale enquiry is
-- never assigned (§4: after-sale work never enters a bucket), so "counsellor"
-- here can only mean the person who last called it.
--
-- SECURITY INVOKER, like the other list functions: it reads through the
-- caller's RLS.

create or replace function public.tickets_list(
  p_include_resolved boolean default false,
  p_status public.enquiry_status default null,
  p_counsellor_id uuid default null,
  p_issue_category public.issue_category default null,
  p_from date default null,
  p_to date default null,
  p_sort text default 'reminder',
  p_dir text default 'asc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  enquiry_id bigint,
  student_id uuid,
  mobile text,
  student_name text,
  status public.enquiry_status,
  reminder_date date,
  created_at timestamptz,
  last_call_at timestamptz,
  last_outcome public.call_outcome,
  last_discussion text,
  issue_category public.issue_category,
  order_id text,
  last_caller_id uuid,
  last_caller_name text,
  call_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
with last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.outcome, c.discussion,
         c.issue_category, c.order_id, c.called_by
    from public.calls c
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
    -- §4: on an after-sale enquiry this date is a reminder, not a queue entry.
    e.next_follow_up_date as reminder_date,
    e.created_at,
    lc.called_at as last_call_at,
    lc.outcome as last_outcome,
    lc.discussion as last_discussion,
    lc.issue_category,
    lc.order_id,
    lc.called_by as last_caller_id,
    pr.full_name as last_caller_name,
    (select count(*)::integer from public.calls c where c.enquiry_id = e.id) as call_count,
    case p_sort
      when 'created'   then extract(epoch from e.created_at)
      when 'last_call' then extract(epoch from lc.called_at)
      else extract(epoch from e.next_follow_up_date::timestamp)
    end as sort_num
  from public.enquiries e
  join public.students s on s.id = e.student_id
  left join last_call lc on lc.enquiry_id = e.id
  left join public.profiles pr on pr.id = lc.called_by
  where e.type = 'after_sale'
    and (
      case
        when p_status is not null then e.status = p_status
        -- The queue is everything unresolved; the toggle widens it.
        when p_include_resolved then true
        else e.status in ('open', 'escalated')
      end
    )
    and (p_counsellor_id is null or lc.called_by = p_counsellor_id)
    and (p_issue_category is null or lc.issue_category = p_issue_category)
    and (p_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_from)
    and (p_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_to)
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.status,
  b.reminder_date, b.created_at, b.last_call_at, b.last_outcome,
  b.last_discussion, b.issue_category, b.order_id, b.last_caller_id,
  b.last_caller_name, b.call_count,
  count(*) over () as total_count
from base b
order by
  -- Escalated first whatever else is asked for: it is the one state that means
  -- somebody else is now waiting on us.
  (b.status = 'escalated') desc,
  case when lower(coalesce(p_dir, 'asc')) = 'asc'  then b.sort_num end asc  nulls last,
  case when lower(coalesce(p_dir, 'asc')) <> 'asc' then b.sort_num end desc nulls last,
  b.enquiry_id desc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$$;

comment on function public.tickets_list is
  '§5.11 after-sale queue: open and escalated tickets by reminder date, with '
  'the resolved ones behind a toggle. Escalated always sorts first.';

revoke all on function public.tickets_list from public;
grant execute on function public.tickets_list to authenticated;
