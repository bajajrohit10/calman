-- §44b.3. The ticket numbers for a range, cut the two ways the call report is
-- already cut: per day and per counsellor, each with a totals row.
--
-- "Opened" is counted by when the ticket was raised; "resolved", "escalated"
-- and "pending with institute" by when the move happened, which is what
-- ticket_events records. Counting the last three by the ticket's current
-- status would answer a different question — how many are in that state now —
-- and would make a range mean nothing.
--
-- Average days to resolve is measured Opened → Resolved on the tickets
-- resolved inside the range, whenever they were opened: a month's report is
-- about the work finished that month.

create or replace function public.ticket_summary(
  p_from date,
  p_to date,
  p_counsellor_id uuid default null,
  p_grain text default 'day'
)
returns table (
  grain_key text,
  label text,
  opened integer,
  resolved integer,
  escalated integer,
  pending_institute integer,
  avg_days_to_resolve numeric,
  is_total boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
with tickets as (
  select e.id, e.created_at, e.closed_at, e.created_by
    from public.enquiries e
   where e.type = 'after_sale'
),
-- Who a ticket belongs to for the per-counsellor cut: whoever raised it.
-- The last caller moves; the raiser is the one stable answer, and it is the
-- same person the queue's "mine" starts from.
owner as (
  select t.id, t.created_by as who, t.created_at, t.closed_at from tickets t
),
opened as (
  select o.who,
         (o.created_at at time zone 'Asia/Kolkata')::date as d,
         count(*)::integer as n
    from owner o
   where (o.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     and (p_counsellor_id is null or o.who = p_counsellor_id)
   group by 1, 2
),
moves as (
  select ev.actor_id as who,
         (ev.at at time zone 'Asia/Kolkata')::date as d,
         ev.to_status
    from public.ticket_events ev
    join tickets t on t.id = ev.enquiry_id
   where (ev.at at time zone 'Asia/Kolkata')::date between p_from and p_to
     and (p_counsellor_id is null or ev.actor_id = p_counsellor_id)
),
moved as (
  select m.who, m.d,
         count(*) filter (where m.to_status = 'closed')::integer as resolved,
         count(*) filter (where m.to_status = 'escalated')::integer as escalated,
         count(*) filter (where m.to_status = 'pending_institute')::integer as pending
    from moves m
   group by 1, 2
),
-- One row per (who, day) that either side has anything to say about.
keys as (
  select who, d from opened
  union
  select who, d from moved
),
joined as (
  select k.who, k.d,
         coalesce(o.n, 0) as opened,
         coalesce(mv.resolved, 0) as resolved,
         coalesce(mv.escalated, 0) as escalated,
         coalesce(mv.pending, 0) as pending
    from keys k
    left join opened o on o.who is not distinct from k.who and o.d = k.d
    left join moved mv on mv.who is not distinct from k.who and mv.d = k.d
),
-- The resolution times, attached to the day and person that resolved them.
spans as (
  select ev.actor_id as who,
         (ev.at at time zone 'Asia/Kolkata')::date as d,
         extract(epoch from (ev.at - t.created_at)) / 86400.0 as days
    from public.ticket_events ev
    join tickets t on t.id = ev.enquiry_id
   where ev.to_status = 'closed'
     and (ev.at at time zone 'Asia/Kolkata')::date between p_from and p_to
     and (p_counsellor_id is null or ev.actor_id = p_counsellor_id)
),
span_by_key as (
  select who, d, round(avg(days)::numeric, 1) as avg_days from spans group by 1, 2
),
rows_out as (
  select
    case when p_grain = 'counsellor' then coalesce(j.who::text, 'unassigned')
         else j.d::text end as grain_key,
    case when p_grain = 'counsellor'
         then coalesce(pr.full_name, '(nobody)')
         else to_char(j.d, 'DD Mon YYYY') end as label,
    j.opened, j.resolved, j.escalated, j.pending,
    s.avg_days,
    false as is_total
  from joined j
  left join public.profiles pr on pr.id = j.who
  left join span_by_key s on s.who is not distinct from j.who and s.d = j.d
),
grouped as (
  select grain_key, min(label) as label,
         sum(opened)::integer as opened,
         sum(resolved)::integer as resolved,
         sum(escalated)::integer as escalated,
         sum(pending)::integer as pending_institute,
         round(avg(avg_days)::numeric, 1) as avg_days_to_resolve,
         false as is_total
    from rows_out
   group by grain_key
)
select g.grain_key, g.label, g.opened, g.resolved, g.escalated,
       g.pending_institute, g.avg_days_to_resolve, g.is_total
  from grouped g
union all
select
  '__total__', 'Total',
  coalesce(sum(g.opened), 0)::integer,
  coalesce(sum(g.resolved), 0)::integer,
  coalesce(sum(g.escalated), 0)::integer,
  coalesce(sum(g.pending_institute), 0)::integer,
  -- The overall average is over the tickets, not over the rows: averaging a
  -- column of averages weights a day with one ticket like a day with forty.
  (select round(avg(days)::numeric, 1) from spans),
  true
from grouped g
order by is_total, grain_key;
$$;

comment on function public.ticket_summary(date, date, uuid, text) is
  'Ticket counts for a range (§44b.3): opened by when raised, the rest by when '
  'the move happened, plus average days from Opened to Resolved.';

grant execute on function public.ticket_summary(date, date, uuid, text) to authenticated;
