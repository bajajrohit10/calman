-- The two reports call_report replaces.
--
-- They are no longer read by anything: /reports and its export both go through
-- public.call_report now. Leaving them defined would leave three functions that
-- answer "how many calls did we make" three different ways, which is the exact
-- problem §5.8 was rebuilt to remove — the next person to need a number would
-- find one of them first and have no way to know it had been superseded.
--
-- Nothing is lost: the definitions live in migrations 0017/0018/0020 and 0026,
-- and call_report covers every column either of them had.

drop function if exists public.daily_counsellor_report(date, date, uuid);
drop function if exists public.daily_stage_report(date, date, uuid);
