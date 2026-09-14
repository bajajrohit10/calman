-- Brief 30: the team's day, moving work between counsellors, and carrying
-- uncalled work forward.
--
-- Three facts drive the shape here.
--
-- One: "pending" already has a definition in this database, in
-- my_day_pending_count — an assignment on the day with no call after the
-- moment it was handed over. Every count below uses that same test rather
-- than a fresh one, because a team grid that disagrees with the counsellor's
-- own screen about how much they have left is worse than no grid.
--
-- Two: moving work to another counsellor on the same day and carrying it to
-- another date are not two operations. The first is an UPDATE (the unique
-- constraint on (enquiry_id, date) has said since the first migration that a
-- reassignment is an update), the second is an insert on the new date leaving
-- the old day's record intact. Both pick the same rows by the same rule, so
-- they are one internal function with two public doors, each with its own
-- permission.
--
-- Three: a past day must keep its record. Carrying forward does not delete
-- what was assigned on Tuesday — Tuesday really did have that work on it, and
-- a screen showing Tuesday has to be able to say "assigned, never called,
-- carried to Thursday". Hence carried_to rather than a delete.

-- ---------------------------------------------------------------------------
-- 1. The mark
-- ---------------------------------------------------------------------------
alter table public.assignments
  add column if not exists carried_to date;

comment on column public.assignments.carried_to is
  'Set when this uncalled assignment was carried forward or moved to another '
  'date (Brief 30.6). The row stays where it is — the day it was assigned to '
  'is a fact — and this says where the work went.';

-- Carrying forward and the team grid both ask "what is still open on this
-- day", which is already covered by assignments_day_counsellor_idx; this one
-- is for the other direction, "has this enquiry been carried anywhere", which
-- the duplicate guard asks per row.
create index if not exists assignments_carried_idx
  on public.assignments (enquiry_id, carried_to)
  where carried_to is not null;

-- ---------------------------------------------------------------------------
-- 2. my_day carries the mark, so a past day can show it
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_day';

  if src is null then
    raise exception 'public.my_day is not defined';
  end if;

  patched := replace(src,
    'slots_at_open smallint)',
    'slots_at_open smallint, carried_to date)');
  if patched = src then
    raise exception 'my_day: the return type was not found';
  end if;

  patched := replace(patched,
    'select a.enquiry_id, a.bucket, a.assigned_at, a.label',
    'select a.enquiry_id, a.bucket, a.assigned_at, a.label, a.carried_to');
  if patched not like '%a.label, a.carried_to%' then
    raise exception 'my_day: the mine CTE was not found';
  end if;

  patched := replace(patched,
    E'  sl.n\nfrom mine m',
    E'  sl.n,\n  m.carried_to\nfrom mine m');
  if patched not like '%m.carried_to%from mine m%' then
    raise exception 'my_day: the output list was not found';
  end if;

  drop function if exists public.my_day;
  execute patched;
end $$;

revoke all on function public.my_day from public;
grant execute on function public.my_day to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The team's day
--
-- One row per active counsellor, five categories and a total, each as
-- pending/total. The four assignment categories are this counsellor's own
-- work. Tickets are not — nothing assigns a ticket to anybody, so the same
-- open queue is shown to everyone, exactly as my_day_pending_count already
-- counts it and as the Tickets tab already renders it. The column repeats
-- down the grid on purpose, and the screen says so.
-- ---------------------------------------------------------------------------
create or replace function public.my_day_team(p_date date default null)
returns table (
  counsellor_id uuid,
  counsellor_name text,
  new_pending integer,   new_total integer,
  offer_pending integer, offer_total integer,
  assigned_pending integer, assigned_total integer,
  custom_pending integer, custom_total integer,
  tickets_pending integer, tickets_total integer,
  total_pending integer, total_total integer
)
language sql
stable
security invoker
set search_path to ''
as $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d
),
staff as (
  select p.id, coalesce(p.full_name, '(no name)') as name
    from public.profiles p
   where p.is_active
     and p.role <> 'ticket_team'
),
-- The same test my_day_pending_count uses: assigned on the day, and no call
-- on that day since it was handed over. A carried row is not pending either —
-- the work has moved to another date and saying otherwise would have a
-- manager reallocating something that is already somewhere else.
assigned as (
  select
    a.counsellor_id,
    a.bucket,
    (a.carried_to is null and not exists (
       select 1 from public.calls c
        where c.enquiry_id = a.enquiry_id
          and c.call_date = t.d
          and c.called_at >= a.assigned_at
     )) as is_pending
  from public.assignments a
  join public.live_enquiries e on e.id = a.enquiry_id
  cross join target t
  where a.date = t.d
    and e.type = 'purchase'
),
agg as (
  select
    counsellor_id,
    count(*) filter (where bucket = 'fresh' and is_pending)::integer as new_pending,
    count(*) filter (where bucket = 'fresh')::integer                as new_total,
    count(*) filter (where bucket = 'offer' and is_pending)::integer as offer_pending,
    count(*) filter (where bucket = 'offer')::integer                as offer_total,
    count(*) filter (where bucket in ('follow_up','call_back') and is_pending)::integer
                                                                     as assigned_pending,
    count(*) filter (where bucket in ('follow_up','call_back'))::integer
                                                                     as assigned_total,
    count(*) filter (where bucket = 'campaign' and is_pending)::integer as custom_pending,
    count(*) filter (where bucket = 'campaign')::integer               as custom_total
  from assigned
  group by counsellor_id
),
tickets as (
  select
    count(*) filter (where not exists (
      select 1 from public.calls c
       where c.enquiry_id = e.id and c.call_date = t.d
    ))::integer as pending,
    count(*)::integer as total
  from public.live_enquiries e
  cross join target t
  where e.type = 'after_sale'
    and e.status in ('open', 'escalated')
)
select
  s.id,
  s.name,
  coalesce(g.new_pending, 0),      coalesce(g.new_total, 0),
  coalesce(g.offer_pending, 0),    coalesce(g.offer_total, 0),
  coalesce(g.assigned_pending, 0), coalesce(g.assigned_total, 0),
  coalesce(g.custom_pending, 0),   coalesce(g.custom_total, 0),
  k.pending, k.total,
  coalesce(g.new_pending, 0) + coalesce(g.offer_pending, 0)
    + coalesce(g.assigned_pending, 0) + coalesce(g.custom_pending, 0) + k.pending,
  coalesce(g.new_total, 0) + coalesce(g.offer_total, 0)
    + coalesce(g.assigned_total, 0) + coalesce(g.custom_total, 0) + k.total
from staff s
left join agg g on g.counsellor_id = s.id
cross join tickets k
order by s.name;
$function$;

comment on function public.my_day_team is
  'One row per active counsellor for a day (Brief 30.4): pending/total per My '
  'Day category. Tickets are a shared queue, so that pair is the same on every '
  'row — the same number my_day_pending_count adds to each counsellor''s badge.';

revoke all on function public.my_day_team from public;
grant execute on function public.my_day_team to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Moving uncalled work
--
-- Internal, and the only place the selection rule lives. Both public doors
-- below choose rows the same way: pending on the source day, oldest handover
-- first, optionally narrowed to buckets or to an explicit list of enquiries.
--
-- Oldest first because that is what "move 2 of her 3" should mean at six in
-- the evening: the two that have been waiting longest, not two at random.
-- ---------------------------------------------------------------------------
create or replace function app.move_assignments(
  p_date date,
  p_from uuid,
  p_to uuid,
  p_buckets public.assignment_bucket[],
  p_count integer,
  p_enquiry_ids bigint[],
  p_target_date date
)
returns table (moved integer, skipped integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_moved integer := 0;
  v_skipped integer := 0;
  v_made integer;
  r record;
begin
  for r in
    select a.id, a.enquiry_id, a.bucket, a.label
      from public.assignments a
      join public.live_enquiries e on e.id = a.enquiry_id
     where a.date = p_date
       and a.counsellor_id = p_from
       and a.carried_to is null
       and e.type = 'purchase'
       and (p_buckets is null or a.bucket = any (p_buckets))
       and (p_enquiry_ids is null or a.enquiry_id = any (p_enquiry_ids))
       and not exists (
         select 1 from public.calls c
          where c.enquiry_id = a.enquiry_id
            and c.call_date = p_date
            and c.called_at >= a.assigned_at
       )
     order by a.assigned_at, a.enquiry_id
     limit coalesce(p_count, 2147483647)
  loop
    if p_target_date = p_date then
      -- Same day, different hands. §10 decision 9 made this an update, and
      -- assigned_at moving is what puts the row back to Pending for whoever
      -- receives it — a call the first counsellor made before the handover
      -- must not read as this counsellor's work already done.
      update public.assignments
         set counsellor_id = p_to,
             assigned_by = v_actor,
             assigned_at = now()
       where id = r.id;
      v_moved := v_moved + 1;
    else
      -- Another date: a new row there, the old one left standing and marked.
      -- on conflict is the no-duplicates rule (Brief 30.6) and it is the
      -- constraint enforcing it, not a lookup that could race.
      with ins as (
        insert into public.assignments
          (enquiry_id, date, counsellor_id, bucket, assigned_by, label)
        values (r.enquiry_id, p_target_date, p_to, r.bucket, v_actor, r.label)
        on conflict (enquiry_id, date) do nothing
        returning 1
      )
      select count(*)::integer into v_made from ins;

      -- Carried either way: whether this call made the row on the target day
      -- or found one already there, the work is on that day now and the
      -- source day should stop asking for it.
      update public.assignments set carried_to = p_target_date where id = r.id;

      if v_made = 0 then
        v_skipped := v_skipped + 1;
      else
        v_moved := v_moved + 1;
      end if;
    end if;
  end loop;

  return query select v_moved, v_skipped;
end;
$function$;

comment on function app.move_assignments is
  'Brief 30.5/30.6. Moves uncalled assignments, oldest handover first. Same '
  'date is a reassignment (update); another date leaves the old day intact and '
  'marks it carried. Internal: the public wrappers carry the permissions.';

-- ---------------------------------------------------------------------------
-- 5. The two doors
-- ---------------------------------------------------------------------------
create or replace function public.reallocate_assignments(
  p_date date,
  p_from uuid,
  p_to uuid,
  p_buckets public.assignment_bucket[] default null,
  p_count integer default null,
  p_enquiry_ids bigint[] default null,
  p_target_date date default null
)
returns table (moved integer, skipped integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_target date := coalesce(p_target_date, p_date);
begin
  if not app.is_admin() then
    raise exception 'Only an admin or manager can move calls between counsellors.'
      using errcode = '42501';
  end if;
  if p_from = p_to and v_target = p_date then
    raise exception 'That would move the calls to where they already are.'
      using errcode = '22023';
  end if;
  if coalesce(p_count, 1) < 1 then
    raise exception 'Choose at least one call to move.' using errcode = '22023';
  end if;

  return query
    select * from app.move_assignments(
      p_date, p_from, p_to, p_buckets, p_count, p_enquiry_ids, v_target);
end;
$function$;

comment on function public.reallocate_assignments is
  'Brief 30.5. Hand a counsellor''s uncalled calls to somebody else, oldest '
  'first. Admin or manager only; the audit log records every row it touches.';

revoke all on function public.reallocate_assignments from public;
grant execute on function public.reallocate_assignments to authenticated;

create or replace function public.carry_forward_assignments(
  p_date date,
  p_counsellor uuid,
  p_to_date date,
  p_buckets public.assignment_bucket[] default null,
  p_enquiry_ids bigint[] default null
)
returns table (moved integer, skipped integer)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- A counsellor may roll their own uncalled work onto another day; moving
  -- somebody else's is a manager's decision, and that is the other door.
  if not (app.is_admin() or p_counsellor = (select auth.uid())) then
    raise exception 'You can only carry forward your own calls.'
      using errcode = '42501';
  end if;
  if p_to_date = p_date then
    raise exception 'Carry forward needs a different date.' using errcode = '22023';
  end if;

  return query
    select * from app.move_assignments(
      p_date, p_counsellor, p_counsellor, p_buckets, null, p_enquiry_ids, p_to_date);
end;
$function$;

comment on function public.carry_forward_assignments is
  'Brief 30.6. Copies a day''s uncalled assignments onto another date for the '
  'same counsellor, bucket and label preserved, marking the originals carried. '
  'Never duplicates one that is already on the target date.';

revoke all on function public.carry_forward_assignments from public;
grant execute on function public.carry_forward_assignments to authenticated;
