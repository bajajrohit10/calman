-- The next working day, where the application can ask for it.
--
-- app.next_working_day() has decided this since the first migration, but only
-- inside the database: the before-write trigger snaps whatever date arrives on
-- a call to a working day. That was enough while the panel left the field
-- blank — the counsellor typed a date and the trigger quietly corrected it.
--
-- Brief 20 wants the field to *open* on that date, which means the panel has
-- to know it before anything is written. A thin public wrapper rather than a
-- second implementation in TypeScript: Sundays are easy to get right twice and
-- the holidays table is not, and two answers that disagree about a follow-up
-- date is exactly the bug nobody would look for.
create or replace function public.next_working_day(p_from date default null)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select app.next_working_day(coalesce(p_from, app.ist_today() + 1));
$$;

comment on function public.next_working_day is
  'The first working day on or after p_from, defaulting to tomorrow. Skips '
  'Sundays and anything in public.holidays (§10 decision 12).';

revoke all on function public.next_working_day(date) from public;
grant execute on function public.next_working_day(date) to authenticated;
