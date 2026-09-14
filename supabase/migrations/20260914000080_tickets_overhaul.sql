-- Brief 33: the ticket queue stops pretending to be a day's work.
--
-- A ticket is not an appointment. A purchase lead belongs to a date — it is
-- assigned to somebody for a day and either called or not — but an after-sale
-- problem belongs to nobody's calendar: it is open until it is closed, and a
-- queue that hides it because the date picker moved is a queue that loses it.
-- So the unresolved states are not date-bound here at all, and only Resolved
-- is — "what did we finish on Tuesday" is the one ticket question a date can
-- answer.
--
-- Four changes, one theme: the after-sale side of the system becomes visible
-- to the parts that only ever looked at purchases.

-- ---------------------------------------------------------------------------
-- 1. tickets_list: resolved-on-a-date, "mine", and an overdue flag
--
-- p_from/p_to have always filtered on created_at, which answers "raised in
-- this window". Resolved needs "closed on this day", which is a different
-- column and a different question, so it gets its own parameter rather than
-- overloading one that already means something.
-- ---------------------------------------------------------------------------
drop function if exists public.tickets_list(boolean, public.enquiry_status, uuid, public.issue_category, date, date, text, text, integer, integer);

create function public.tickets_list(
  p_include_resolved boolean default false,
  p_status public.enquiry_status default null,
  p_counsellor_id uuid default null,
  p_issue_category public.issue_category default null,
  p_from date default null,
  p_to date default null,
  p_sort text default 'reminder',
  p_dir text default 'asc',
  p_limit integer default 50,
  p_offset integer default 0,
  -- Brief 33.3: only tickets closed on this IST day.
  p_resolved_on date default null,
  -- Brief 33.7: "Mine" is a ticket I raised or last spoke on. Ownership of a
  -- shared queue is not assignment — nothing hands a ticket out — so it is
  -- whichever of those two is true, not a column.
  p_mine_for uuid default null,
  -- The day the overdue flag is measured against; today unless asked.
  p_as_of date default null
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
  created_by uuid,
  resolved_on date,
  is_overdue boolean,
  re_enquired_at date,
  total_count bigint
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
    e.created_by,
    (e.closed_at at time zone 'Asia/Kolkata')::date as resolved_on,
    -- Overdue is only a thing an unresolved ticket can be, and a reminder that
    -- has arrived is not late — only one that has passed.
    (e.status <> 'closed'
       and e.next_follow_up_date is not null
       and e.next_follow_up_date < t.d) as is_overdue,
    e.re_enquired_at,
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
  where e.type = 'after_sale'
    and (
      case
        when p_resolved_on is not null then
          e.status = 'closed'
          and (e.closed_at at time zone 'Asia/Kolkata')::date = p_resolved_on
        when p_status is not null then e.status = p_status
        -- The queue is everything unresolved; the toggle widens it.
        when p_include_resolved then true
        else e.status in ('open', 'escalated')
      end
    )
    and (p_counsellor_id is null or lc.called_by = p_counsellor_id)
    and (p_mine_for is null
         or lc.called_by = p_mine_for
         or e.created_by = p_mine_for)
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
  b.last_caller_name, b.call_count, b.created_by, b.resolved_on,
  b.is_overdue, b.re_enquired_at,
  count(*) over () as total_count
from base b
order by
  -- Escalated first whatever else is asked for: it is the one state that means
  -- somebody else is now waiting on us.
  (b.status = 'escalated') desc,
  -- Then the ones already late, which is the other thing a queue owes you.
  b.is_overdue desc,
  case when lower(coalesce(p_dir, 'asc')) = 'asc'  then b.sort_num end asc  nulls last,
  case when lower(coalesce(p_dir, 'asc')) <> 'asc' then b.sort_num end desc nulls last,
  b.enquiry_id desc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

comment on function public.tickets_list is
  'The after-sale queue (§5.11, Brief 33). Open and escalated are not bound to '
  'any date — a ticket is open until it is closed; p_resolved_on asks the one '
  'question a date can answer. p_mine_for is "raised or last spoken on by me".';

revoke all on function public.tickets_list from public;
grant execute on function public.tickets_list to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The three counts, for the sub-tabs
--
-- One round trip rather than three listings, because the counts are wanted on
-- every render and the rows of two of the three tabs are not.
-- ---------------------------------------------------------------------------
create or replace function public.tickets_counts(
  p_date date default null,
  p_mine_for uuid default null
)
returns table (open_count integer, escalated_count integer, resolved_count integer)
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
          or e.created_by = p_mine_for)
)
select
  count(*) filter (where m.status = 'open')::integer,
  count(*) filter (where m.status = 'escalated')::integer,
  count(*) filter (
    where m.status = 'closed'
      and (m.closed_at at time zone 'Asia/Kolkata')::date = t.d
  )::integer
from mine m
cross join target t;
$function$;

comment on function public.tickets_counts is
  'Brief 33.3. Open and escalated are counted whole; resolved is counted for '
  'the given day, because that is the only one a date bounds.';

revoke all on function public.tickets_counts from public;
grant execute on function public.tickets_counts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The lookup learns about tickets (Brief 33.5)
--
-- import_lookup has only ever looked at purchase enquiries, so a number with
-- an open ticket and no open lead came back "resolved" — and the screen said
-- "Closed call" about somebody we are in the middle of helping. The purchase
-- answer is unchanged; the ticket is reported alongside it, because a number
-- can legitimately be in both pipelines at once and the screen has to be able
-- to say so.
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
  closed_on date,
  closed_as text,
  assigned_to text,
  -- Brief 33.5: the open ticket, if there is one.
  ticket_enquiry_id bigint,
  ticket_status text,
  ticket_note_by text,
  ticket_note_on date
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
-- The open ticket. Escalated counts as open here: somebody is waiting on us
-- either way, and "escalated" is what the label will say.
open_ticket as (
  select distinct on (e.student_id)
         e.student_id, e.id, e.status::text as status
    from public.enquiries e
   where e.type = 'after_sale'
     and e.status in ('open', 'escalated')
     and e.archived_at is null
     and e.student_id in (select student_id from matched where student_id is not null)
   order by e.student_id, e.id desc
),
ticket_note as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.call_date, pr.full_name
    from public.calls c
    left join public.profiles pr on pr.id = c.called_by
   where c.enquiry_id in (select id from open_ticket)
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.call_date, pr.full_name
    from public.calls c
    left join public.profiles pr on pr.id = c.called_by
   where c.enquiry_id in (select id from open_enq)
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
assigned as (
  select a.enquiry_id, pr.full_name
    from public.assignments a
    join public.profiles pr on pr.id = a.counsellor_id
   where a.date = app.ist_today()
     and a.carried_to is null
     and a.enquiry_id in (select id from open_enq)
),
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
     and e.type = 'purchase'
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
    when lc.call_date = app.ist_today() then 'open_called_today'
    else 'open_called_earlier'
  end,
  oe.id,
  lc.called_at,
  lc.call_date,
  lc.full_name,
  coalesce(cn.n, 0),
  ce.closed_on,
  case when w.student_id is not null and oe.id is null then 'wrong_number'
       else ce.closed_as end,
  asg.full_name,
  ot.id,
  ot.status,
  tn.full_name,
  tn.call_date
from matched m
left join open_enq oe on oe.student_id = m.student_id
left join last_call lc on lc.enquiry_id = oe.id
left join assigned asg on asg.enquiry_id = oe.id
left join closed_enq ce on ce.student_id = m.student_id
left join counts cn on cn.student_id = m.student_id
left join wrong w on w.student_id = m.student_id
left join open_ticket ot on ot.student_id = m.student_id
left join ticket_note tn on tn.enquiry_id = ot.id;
$function$;

comment on function app.import_lookup is
  'What Calman already knows about each number (§10.1, Briefs 31 and 33). The '
  'state is the purchase pipeline; ticket_* is the after-sale one, reported '
  'alongside because a number can be in both at once.';

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
  assigned_to text,
  ticket_enquiry_id bigint,
  ticket_status text,
  ticket_note_by text,
  ticket_note_on date
)
language sql
stable
set search_path to ''
as $function$ select * from app.import_lookup(p_mobiles) $function$;

revoke all on function public.import_lookup(text[]) from public;
grant execute on function public.import_lookup(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The after-sale half of New Calls (Brief 33.6)
--
-- Two kinds of row, one list: a ticket nobody has called yet, and one that has
-- been called before and whose number has come in again. Both are "somebody is
-- waiting and nobody has picked this up today", which is what the New Calls
-- pool means on the purchase side.
-- ---------------------------------------------------------------------------
create or replace function public.new_calls_after_sale(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  enquiry_id bigint,
  student_id uuid,
  mobile text,
  student_name text,
  status public.enquiry_status,
  issue_category public.issue_category,
  reminder_date date,
  last_discussion text,
  last_caller_name text,
  last_call_date date,
  call_count integer,
  re_enquired_at date,
  is_overdue boolean,
  never_called boolean,
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
    (lc.enquiry_id is null) as never_called
  from public.live_enquiries e
  join public.students s on s.id = e.student_id
  left join last_call lc on lc.enquiry_id = e.id
  where e.type = 'after_sale'
    and e.status in ('open', 'escalated')
    -- Never called at all, or called before and re-contacted since.
    and (lc.enquiry_id is null or e.re_enquired_at is not null)
    -- Nobody has spoken to them today; if they have, it is not waiting.
    and not exists (
      select 1 from public.calls c
       where c.enquiry_id = e.id and c.call_date = app.ist_today()
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

comment on function public.new_calls_after_sale is
  'Brief 33.6. The after-sale half of New Calls: tickets never called, and '
  'open tickets whose number has arrived again, with nobody on them today.';

revoke all on function public.new_calls_after_sale from public;
grant execute on function public.new_calls_after_sale to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Attaching an arriving number to an open ticket (Brief 33.5)
--
-- Not import_re_enquire: that one is about a purchase lead and will refuse
-- anything that is not status 'open', which would turn away every escalated
-- ticket. This logs the arrival, marks the ticket re-contacted so New Calls
-- can find it, and touches nothing else — a ticket's reminder belongs to
-- whoever is working it, not to whoever's list the number came in on.
-- ---------------------------------------------------------------------------
create or replace function public.attach_to_ticket(
  p_enquiry_id bigint,
  p_source_id uuid default null,
  p_note text default 'Number arrived again in Quick Add.'
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  enq public.enquiries%rowtype;
begin
  if not app.is_staff() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into enq from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id using errcode = 'P0002';
  end if;
  if enq.type <> 'after_sale' then
    raise exception 'enquiry % is not a ticket', p_enquiry_id using errcode = '22023';
  end if;
  if enq.status not in ('open', 'escalated') then
    raise exception 'ticket % is already resolved', p_enquiry_id using errcode = '22023';
  end if;

  insert into public.enquiry_sources (enquiry_id, source_id, note)
  values (p_enquiry_id, p_source_id, p_note);

  update public.enquiries
     set re_enquired_at = app.ist_today(),
         source_id = coalesce(source_id, p_source_id)
   where id = p_enquiry_id;

  return 'Added to the open ticket #' || p_enquiry_id || '.';
end;
$function$;

comment on function public.attach_to_ticket is
  'Brief 33.5. Logs an arriving number against an open ticket and marks it '
  're-contacted, so it surfaces in New Calls → After Sale. Creates nothing.';

revoke all on function public.attach_to_ticket from public;
grant execute on function public.attach_to_ticket to authenticated;
