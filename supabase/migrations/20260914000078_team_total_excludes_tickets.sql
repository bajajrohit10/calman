-- The team grid's Total counts assigned work only.
--
-- Tickets are not assigned to anybody: the same open queue is shown to every
-- counsellor, so the column repeats down the grid. Adding it into each row's
-- Total made the totals overlap — nine people each apparently owing the same
-- eight tickets — and a column of numbers that cannot be added up is worse
-- than one that can. The pair stays, because a manager still wants to see the
-- queue; it is just no longer arithmetic anybody can do anything with.
--
-- Patched rather than restated so the counting above it stays the one
-- definition, and asserted, because a replace that matches nothing is the
-- failure this project keeps meeting.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_day_team';

  if src is null then
    raise exception 'public.my_day_team is not defined';
  end if;

  patched := replace(src,
    E'    + coalesce(g.assigned_pending, 0) + coalesce(g.custom_pending, 0) + k.pending,',
    E'    + coalesce(g.assigned_pending, 0) + coalesce(g.custom_pending, 0),');
  if patched = src then
    raise exception 'my_day_team: the pending total was not found';
  end if;

  src := patched;
  patched := replace(src,
    E'    + coalesce(g.assigned_total, 0) + coalesce(g.custom_total, 0) + k.total',
    E'    + coalesce(g.assigned_total, 0) + coalesce(g.custom_total, 0)');
  if patched = src then
    raise exception 'my_day_team: the assigned total was not found';
  end if;

  execute patched;
end $$;

comment on function public.my_day_team is
  'One row per active counsellor for a day (Brief 30.4): pending/total per My '
  'Day category. Tickets are a shared queue — the same pair on every row, and '
  'deliberately outside Total, which counts only what is assigned to that '
  'person.';

revoke all on function public.my_day_team from public;
grant execute on function public.my_day_team to authenticated;
