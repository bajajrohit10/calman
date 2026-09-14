-- Brief 31: one set of words for a duplicate, everywhere it is described.
--
-- Quick Add's grid, the import review table and the import report each had
-- their own way of saying what a number already is, and the three did not
-- agree — "Open, never called" in one place, "Existing — open, not called yet"
-- in another, "Re-enquired" in a third. The five sentences the brief fixes are
-- written once in lib/duplicate-rules.ts, and this migration gives that
-- function the three facts it was missing:
--
--   * when a closed enquiry closed, and how — "Closed call · 12 Sept · Won"
--     needs a date and a word, and the lookup returned neither.
--   * who is holding an open lead today — "Already in New Calls · with Neha"
--     against "· Unassigned".
--
-- The state column is unchanged. It is the rule the commit path turns on, and
-- widening the wording is not a reason to move the rules.

-- ---------------------------------------------------------------------------
-- The two functions must change together: the wrapper's RETURNS TABLE names
-- the columns, so a new column in the inner one is invisible until both are
-- restated. Dropped rather than replaced because the return type changes.
-- ---------------------------------------------------------------------------
drop function if exists public.import_lookup(text[]);
drop function if exists app.import_lookup(text[]);

create function app.import_lookup(p_mobiles text[])
returns table (
  mobile text,
  student_id uuid,
  student_name text,
  state text,
  open_enquiry_id bigint,
  last_call_at timestamptz,
  last_call_date date,
  last_call_by text,
  enquiry_count integer,
  -- Brief 31: the facts the five sentences need.
  closed_on date,
  closed_as text,
  assigned_to text
)
language sql
stable
set search_path to ''
as $function$
with wanted as (
  select distinct m from unnest(coalesce(p_mobiles, '{}'::text[])) m
),
matched as (
  select w.m as mobile, s.id as student_id, s.name as student_name
    from wanted w
    left join public.students s on s.mobile = w.m
),
-- The open purchase enquiry, if there is one. Archived does not count as open
-- (Brief 9): it has been exported, and re-enquiring into it would write to a
-- closed batch.
open_enq as (
  select distinct on (e.student_id)
         e.student_id, e.id, e.fresh_call_date
    from public.enquiries e
   where e.status = 'open'
     and e.type = 'purchase'
     and e.archived_at is null
     and e.student_id in (select student_id from matched where student_id is not null)
   order by e.student_id, e.id desc
),
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.call_date, pr.full_name
    from public.calls c
    left join public.profiles pr on pr.id = c.called_by
   where c.enquiry_id in (select id from open_enq)
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
-- Who has this lead today. Only today's row counts: yesterday's owner is not
-- who a counsellor would be disturbing, and a lead nobody holds is the pool.
assigned as (
  select a.enquiry_id, pr.full_name
    from public.assignments a
    join public.profiles pr on pr.id = a.counsellor_id
   where a.date = app.ist_today()
     and a.carried_to is null
     and a.enquiry_id in (select id from open_enq)
),
-- The most recently closed enquiry, for a number with nothing open. Won and
-- lost are the status; a wrong number is a close reason, and it outranks both
-- because it is a fact about the number rather than about the sale.
closed_enq as (
  select distinct on (e.student_id)
         e.student_id,
         (e.closed_at at time zone 'Asia/Kolkata')::date as closed_on,
         case
           when e.close_reason = 'wrong_number' then 'wrong_number'
           when e.status = 'won' then 'won'
           else 'lost'
         end as closed_as
    from public.enquiries e
   where e.status <> 'open'
     and e.archived_at is null
     and e.student_id in (select student_id from matched where student_id is not null)
   order by e.student_id, e.closed_at desc nulls last, e.id desc
),
counts as (
  select e.student_id, count(*)::integer as n
    from public.enquiries e
   where e.student_id in (select student_id from matched where student_id is not null)
   group by 1
),
wrong as (
  select distinct e.student_id
    from public.enquiries e
   where e.close_reason = 'wrong_number' and e.archived_at is null
     and e.student_id in (select student_id from matched where student_id is not null)
)
select
  m.mobile,
  m.student_id,
  m.student_name,
  case
    when m.student_id is null then 'new'
    when oe.id is null then
      case when w.student_id is not null then 'wrong_number' else 'resolved' end
    when oe.fresh_call_date is null then 'open_uncalled'
    -- IST calendar day, the same boundary §4.3 uses for a slot, so 23:50 and
    -- 00:10 are different days.
    when lc.call_date = app.ist_today() then 'open_called_today'
    else 'open_called_earlier'
  end,
  oe.id,
  lc.called_at,
  lc.call_date,
  lc.full_name,
  coalesce(cn.n, 0),
  ce.closed_on,
  -- A number flagged as a wrong number says so whichever enquiry closed last.
  case when w.student_id is not null and oe.id is null then 'wrong_number'
       else ce.closed_as end,
  asg.full_name
from matched m
left join open_enq oe on oe.student_id = m.student_id
left join last_call lc on lc.enquiry_id = oe.id
left join assigned asg on asg.enquiry_id = oe.id
left join closed_enq ce on ce.student_id = m.student_id
left join counts cn on cn.student_id = m.student_id
left join wrong w on w.student_id = m.student_id;
$function$;

comment on function app.import_lookup is
  'What Calman already knows about each number (§10.1, Brief 31). state drives '
  'the rules; closed_on, closed_as and assigned_to are what the five status '
  'sentences are written from.';

create function public.import_lookup(p_mobiles text[])
returns table (
  mobile text,
  student_id uuid,
  student_name text,
  state text,
  open_enquiry_id bigint,
  last_call_at timestamptz,
  last_call_date date,
  last_call_by text,
  enquiry_count integer,
  closed_on date,
  closed_as text,
  assigned_to text
)
language sql
stable
set search_path to ''
as $function$ select * from app.import_lookup(p_mobiles) $function$;

revoke all on function public.import_lookup(text[]) from public;
grant execute on function public.import_lookup(text[]) to authenticated;
