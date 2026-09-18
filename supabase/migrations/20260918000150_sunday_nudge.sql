-- §54.2(c). The question that has to be asked before the week ends.
--
-- "+3 days" on a Thursday now skips the Sunday, which is right until the week
-- the team decides to work it — and nobody will remember to open Settings and
-- say so. So the app asks, once, in the window where the answer still changes
-- anybody's follow-up dates: from Thursday morning until the Sunday itself.
--
-- The answer is a row in holidays either way. Yes writes the override; No
-- writes nothing and records that the question was put, so it stops being
-- asked. Unanswered is not working, which is the safe default: it is the
-- weekly rule, and a Sunday nobody confirmed is a Sunday nobody agreed to.
create table public.calendar_nudges (
  date date primary key,
  answered_by uuid not null references public.profiles (id),
  answered_at timestamptz not null default now(),
  /** True was answered "yes, working"; false was dismissed. */
  working boolean not null
);

alter table public.calendar_nudges enable row level security;

create policy calendar_nudges_select on public.calendar_nudges
  for select using (app.is_staff());
create policy calendar_nudges_write on public.calendar_nudges
  for all using (app.is_admin()) with check (app.is_admin());

grant select, insert, update, delete on public.calendar_nudges to authenticated;

-- §54.2(c). The one question outstanding, or nothing.
--
-- Two kinds, in date order, first one wins: the coming Sunday from the
-- Thursday before it, and a listed holiday from three days before. One banner
-- at a time — two would be a form, and this is a question asked in passing.
create or replace function public.pending_calendar_nudge()
returns jsonb
language sql
stable
set search_path to ''
as $$
  with today as (select app.ist_today() as d),
  candidates as (
    -- The next Sunday, visible from the Thursday before it. isodow 4 = Thu.
    select (t.d + ((7 - extract(isodow from t.d)::integer) % 7))::date as date,
           'sunday'::text as kind,
           null::text as name
      from today t
     where extract(isodow from t.d) between 4 and 7
    union all
    -- A listed closed day, from three days before it.
    select h.date, 'holiday'::text, h.name
      from public.holidays h, today t
     where h.is_active and not h.is_working_override
       and h.date between t.d and t.d + 3
  )
  select coalesce(
    (select jsonb_build_object('date', c.date, 'kind', c.kind, 'name', c.name)
       from candidates c
      where not exists (select 1 from public.calendar_nudges n where n.date = c.date)
        -- A Sunday already marked working has been answered by other means.
        and not exists (
          select 1 from public.holidays h
           where h.date = c.date and h.is_active and h.is_working_override)
      order by c.date
      limit 1),
    'null'::jsonb);
$$;

grant execute on function public.pending_calendar_nudge() to authenticated, service_role;

notify pgrst, 'reload schema';
