-- §54.2. Working days are Monday to Saturday, minus holidays, plus overrides.
--
-- Two of the three already existed: app.is_working_day() reads the holidays
-- table and treats Sunday as closed, and carry-forward already targets
-- app.next_working_day(). What was missing is the third — a Sunday the team
-- decides to work — and the fact that nothing on the follow-up picker used any
-- of it. "+3 days" was Date + 3, so a Thursday sent the next call to a Sunday.
--
-- The override lives on the same table as the holidays because it is the same
-- statement: this date is not what the weekly rule says it is. A row with
-- is_working_override true names a working Sunday; a row without it names a
-- closed day. One table, read once, and no second place to look.
alter table public.holidays
  add column is_working_override boolean not null default false;

comment on column public.holidays.is_working_override is
  'True makes this date a working day that the weekly rule would have closed '
  '(a Sunday the team is working). False is the ordinary case: a date the '
  'weekly rule would have opened, closed.';

-- A Sunday the team is working needs no name, so the constraint that made one
-- compulsory is relaxed for exactly that case.
alter table public.holidays alter column name drop not null;
alter table public.holidays add constraint holidays_name_required
  check (is_working_override or (name is not null and length(btrim(name)) > 0));

create or replace function app.is_working_day(d date)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  -- isodow 7 = Sunday. Saturday is a working day (§10 decision 12).
  -- An override beats the weekly rule in both directions: it is the only row
  -- that can open a Sunday, and an ordinary holiday row closes anything else.
  select case
    when exists (
      select 1 from public.holidays h
       where h.date = d and h.is_active and h.is_working_override
    ) then true
    when exists (
      select 1 from public.holidays h
       where h.date = d and h.is_active and not h.is_working_override
    ) then false
    else extract(isodow from d) <> 7
  end;
$$;

-- §54.2(a). N working days from a date, which is what the picker means.
--
-- "+3 days" was never a request for 72 hours; it is "three more working days
-- of trying". Counted forward from the day after, so +1 is the next working
-- day rather than today when today is one.
create or replace function app.add_working_days(d date, n integer)
returns date
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  result date := d;
  left_to_go integer := greatest(coalesce(n, 0), 0);
  guard integer := 0;
begin
  if d is null then return null; end if;
  while left_to_go > 0 loop
    result := result + 1;
    guard := guard + 1;
    if guard > 400 then
      raise exception 'no % working days found within 400 of %', n, d;
    end if;
    if app.is_working_day(result) then
      left_to_go := left_to_go - 1;
    end if;
  end loop;
  return result;
end $$;

-- §54.2. What the screens ask: the working-day arithmetic and the reason a
-- date is closed, in one round trip, so the picker can label its own chips and
-- the manual box can say "Sunday" or "Holiday: Diwali" under a date somebody
-- typed.
create or replace function public.working_day_info(
  p_from date default null,
  p_offsets integer[] default array[1, 2, 3, 7],
  p_dates date[] default null
)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_object(
    'from', coalesce(p_from, app.ist_today()),
    'offsets', (
      select coalesce(jsonb_object_agg(o::text,
               app.add_working_days(coalesce(p_from, app.ist_today()), o)), '{}'::jsonb)
        from unnest(coalesce(p_offsets, '{}'::integer[])) o
    ),
    'nextWorkingDay', app.next_working_day(coalesce(p_from, app.ist_today()) + 1),
    'closed', (
      -- Only the dates that are *not* working days come back, each with the
      -- reason. A date that is fine needs nothing said about it.
      select coalesce(jsonb_object_agg(d::text, jsonb_build_object(
               'reason', case when extract(isodow from d) = 7 then 'sunday' else 'holiday' end,
               'name', (select h.name from public.holidays h
                         where h.date = d and h.is_active and not h.is_working_override)
             )), '{}'::jsonb)
        from unnest(coalesce(p_dates, '{}'::date[])) d
       where not app.is_working_day(d)
    )
  );
$$;

grant execute on function public.working_day_info(date, integer[], date[])
  to authenticated, service_role;
grant execute on function app.add_working_days(date, integer) to authenticated, service_role;

-- §54.2(b). Settings → Holidays writes here, so the policy has to allow it.
-- Reading stays open to every staff member: the follow-up picker needs it.
drop policy if exists holidays_write on public.holidays;
create policy holidays_write on public.holidays
  for all using (app.is_admin()) with check (app.is_admin());

grant select, insert, update, delete on public.holidays to authenticated;

notify pgrst, 'reload schema';
