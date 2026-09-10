-- Holidays need the same soft-delete as every other master list.
--
-- The initial schema gave `holidays` a date primary key and no `is_active`,
-- which left Settings unable to honour §3's "all soft-delete: is_active" for
-- this one table: a holiday added by mistake could be renamed but never
-- withdrawn, because §2 grants no delete anywhere.

alter table public.holidays
  add column if not exists is_active boolean not null default true;

-- app.is_working_day() has to respect the flag, or a deactivated holiday would
-- still push follow-up dates forward.
create or replace function app.is_working_day(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- isodow 7 = Sunday. Saturday is a working day (§10 decision 12).
  select extract(isodow from d) <> 7
     and not exists (
       select 1
         from public.holidays h
        where h.date = d
          and h.is_active
     );
$$;
