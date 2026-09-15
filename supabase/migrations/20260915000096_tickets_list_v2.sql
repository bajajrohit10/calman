-- §44.2–44.5. The queue, in five states, with what a ticket is now made of.

drop function if exists public.tickets_list(boolean, public.enquiry_status, uuid, public.issue_category, date, date, text, text, integer, integer, date, uuid, date);

create or replace function public.tickets_list(
  p_include_resolved boolean default false,
  p_status public.enquiry_status default null,
  p_counsellor_id uuid default null,
  p_issue_category public.issue_category default null,
  p_from date default null,
  p_to date default null,
  p_sort text default null,
  p_dir text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_resolved_on date default null,
  -- §44.5. "Mine" is no longer just who touched it: a ticket escalated to
  -- somebody is theirs whether or not they have ever called it.
  p_mine_for uuid default null,
  p_as_of date default null,
  -- §44.4's new filters.
  p_escalated_to uuid default null,
  p_institute_id uuid default null,
  p_open_since integer default null,
  p_due text default null,
  p_due_within integer default null
)
returns table (
  enquiry_id bigint, student_id uuid, mobile text, student_name text,
  status public.enquiry_status, reminder_date date, created_at timestamptz,
  last_call_at timestamptz, last_outcome public.call_outcome, last_discussion text,
  issue_category public.issue_category, order_id text,
  last_caller_id uuid, last_caller_name text, call_count integer,
  created_by uuid, resolved_on date, is_overdue boolean, re_enquired_at timestamptz,
  teacher_id uuid, teacher_name text, institute_id uuid, institute_name text,
  product_text text, escalated_to uuid, escalated_to_name text,
  open_days integer, total_count bigint
)
language sql
stable
set search_path to ''
as $function$
with target as (
  select coalesce(p_as_of, app.ist_today()) as d
),
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.outcome, c.discussion,
         c.issue_category, c.called_by
    from public.calls c
   where c.enquiry_type = 'after_sale'
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
base as (
  select
    e.id as enquiry_id, e.student_id, s.mobile, s.name as student_name, e.status,
    e.next_follow_up_date as reminder_date, e.created_at,
    lc.called_at as last_call_at, lc.outcome as last_outcome,
    lc.discussion as last_discussion,
    -- §44.1: the category is the ticket's, with the last call's as the
    -- fallback for every ticket raised before it moved onto the enquiry.
    lc.issue_category,
    e.order_id, lc.called_by as last_caller_id, pr.full_name as last_caller_name,
    (select count(*)::integer from public.calls c where c.enquiry_id = e.id) as call_count,
    e.created_by,
    (e.closed_at at time zone 'Asia/Kolkata')::date as resolved_on,
    (e.status <> 'closed'
       and e.next_follow_up_date is not null
       and e.next_follow_up_date < t.d) as is_overdue,
    e.re_enquired_at,
    e.teacher_id, tch.name as teacher_name,
    tch.institute_id, inst.name as institute_name,
    e.product_text,
    e.escalated_to, esc.full_name as escalated_to_name,
    -- §44.3. Whole days since it was opened, in IST like every other date here.
    (t.d - (e.created_at at time zone 'Asia/Kolkata')::date)::integer as open_days,
    case p_sort
      when 'created'   then extract(epoch from e.created_at)
      when 'last_call' then extract(epoch from lc.called_at)
      else extract(epoch from e.next_follow_up_date::timestamp)
    end as sort_num
  from public.live_enquiries e
  join public.students s on s.id = e.student_id
  cross join target t
  left join last_call lc on lc.enquiry_id = e.id
  left join public.profiles pr on pr.id = lc.called_by
  left join public.teachers tch on tch.id = e.teacher_id
  left join public.institutes inst on inst.id = tch.institute_id
  left join public.profiles esc on esc.id = e.escalated_to
  where e.type = 'after_sale'
    and (
      case
        when p_resolved_on is not null then
          e.status = 'closed'
          and (e.closed_at at time zone 'Asia/Kolkata')::date = p_resolved_on
        when p_status is not null then e.status = p_status
        when p_include_resolved then true
        -- The standing queue is everything not yet resolved.
        else e.status in ('open', 'working', 'escalated', 'pending_institute')
      end
    )
    and (p_counsellor_id is null or lc.called_by = p_counsellor_id)
    -- §44.5. Theirs to work: they raised it, they last called it, or it has
    -- been escalated to them.
    and (p_mine_for is null
         or lc.called_by = p_mine_for
         or e.created_by = p_mine_for
         or e.escalated_to = p_mine_for)
    and (p_issue_category is null or lc.issue_category = p_issue_category)
    and (p_escalated_to is null or e.escalated_to = p_escalated_to)
    and (p_institute_id is null or tch.institute_id = p_institute_id)
    and (p_open_since is null
         or (t.d - (e.created_at at time zone 'Asia/Kolkata')::date) > p_open_since)
    and (p_due is null or case p_due
           when 'overdue' then e.status <> 'closed'
                            and e.next_follow_up_date is not null
                            and e.next_follow_up_date < t.d
           when 'today'   then e.next_follow_up_date = t.d
           when 'within'  then e.next_follow_up_date is not null
                            and e.next_follow_up_date >= t.d
                            and e.next_follow_up_date <= t.d + coalesce(p_due_within, 7)
           else true
         end)
    and (p_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_from)
    and (p_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_to)
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.status,
  b.reminder_date, b.created_at, b.last_call_at, b.last_outcome,
  b.last_discussion, b.issue_category, b.order_id, b.last_caller_id,
  b.last_caller_name, b.call_count, b.created_by, b.resolved_on,
  b.is_overdue, b.re_enquired_at,
  b.teacher_id, b.teacher_name, b.institute_id, b.institute_name,
  b.product_text, b.escalated_to, b.escalated_to_name, b.open_days,
  count(*) over () as total_count
from base b
order by
  (b.status = 'escalated') desc,
  b.is_overdue desc,
  case when lower(coalesce(p_dir, 'asc')) = 'asc'  then b.sort_num end asc  nulls last,
  case when lower(coalesce(p_dir, 'asc')) <> 'asc' then b.sort_num end desc nulls last,
  b.enquiry_id desc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

-- ---------------------------------------------------------------------------
-- The five sub-tab counts
-- ---------------------------------------------------------------------------

drop function if exists public.tickets_counts(date, uuid);

create or replace function public.tickets_counts(
  p_date date default null,
  p_mine_for uuid default null
)
returns table (
  open_count integer,
  working_count integer,
  escalated_count integer,
  pending_institute_count integer,
  resolved_count integer
)
language sql
stable
set search_path to ''
as $function$
with target as (select coalesce(p_date, app.ist_today()) as d),
last_call as (
  select distinct on (c.enquiry_id) c.enquiry_id, c.called_by
    from public.calls c
   where c.enquiry_type = 'after_sale'
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
mine as (
  select e.id, e.status, e.closed_at
    from public.live_enquiries e
    left join last_call lc on lc.enquiry_id = e.id
   where e.type = 'after_sale'
     and (p_mine_for is null
          or lc.called_by = p_mine_for
          or e.created_by = p_mine_for
          or e.escalated_to = p_mine_for)
)
select
  count(*) filter (where m.status = 'open')::integer,
  count(*) filter (where m.status = 'working')::integer,
  count(*) filter (where m.status = 'escalated')::integer,
  count(*) filter (where m.status = 'pending_institute')::integer,
  count(*) filter (
    where m.status = 'closed'
      and (m.closed_at at time zone 'Asia/Kolkata')::date = t.d
  )::integer
from mine m
cross join target t;
$function$;

grant execute on function public.tickets_counts(date, uuid) to authenticated;
