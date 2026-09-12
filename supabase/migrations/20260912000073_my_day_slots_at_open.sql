-- The slot sub-tabs should hold still while somebody works them.
--
-- §24.1 grouped on follow_up_slots_used, which is the live derived value: the
-- moment a call is logged the lead climbs a rung, so the row a counsellor just
-- called leaves the sub-tab they are working and reappears on the next one.
-- The rung they chose empties under them and the count they were working down
-- stops meaning anything.
--
-- So the sub-tab groups on the slot count as it stood at the *start of the
-- selected day*. A lead that began the day on the second rung stays on the
-- second rung all day and simply moves from Pending to Done, which is what the
-- tab is for. Tomorrow it is on the third, because by then it is.
--
-- Computed here rather than read off the enquiry, because the enquiry only
-- knows where the lead is now. Same rule as app.recompute_enquiry: distinct
-- call days minus the fresh one, offer calls excluded (§23.2) — restricted to
-- days before the one being viewed. Capped at 3, so the top rung means "three
-- or more" the way §5.8's third-follow-up column does.

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

  -- 1. The new column on the row.
  patched := replace(src,
    'offer_ids uuid[], lost_reason lost_reason)',
    'offer_ids uuid[], lost_reason lost_reason, slots_at_open smallint)');
  if patched = src then
    raise exception 'my_day: the return type was not found';
  end if;

  -- 2. The lateral that works it out.
  patched := replace(patched,
    E') off on true\nwhere e.type = ''purchase''',
    E') off on true
-- The §4.3 ladder as it stood this morning: distinct ordinary call days before
-- today, less the fresh one. Offer calls never counted towards it (§23.2), and
-- the fourth rung collects anything past the third.
left join lateral (
  select least(greatest(count(distinct c.call_date) - 1, 0), 3)::smallint as n
    from public.calls c
   where c.enquiry_id = e.id
     and not c.is_offer_call
     and c.call_date < t.d
) sl on true
where e.type = ''purchase''');
  if patched not like '%sl on true%' then
    raise exception 'my_day: the offer lateral anchor was not found';
  end if;

  -- 3. Carried out to the caller.
  patched := replace(patched,
    E'  e.lost_reason\nfrom mine m',
    E'  e.lost_reason,\n  sl.n\nfrom mine m');
  if patched not like '%sl.n%from mine m%' then
    raise exception 'my_day: the output list was not found';
  end if;

  -- The return type changes, so replace cannot do it.
  drop function if exists public.my_day;
  execute patched;
end $$;

comment on function public.my_day is
  'One counsellor''s day (§6), keyed on the day''s assignments. slots_at_open '
  'is the §4.3 slot count as it stood at the start of the viewed day, which is '
  'what My Day''s slot sub-tabs group on so a row stays on its rung when it is '
  'called (§24.1).';

revoke all on function public.my_day from public;
grant execute on function public.my_day to authenticated;
