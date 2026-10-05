-- §83.3. Analytics events: what changed, and when.
--
-- A comparison invites a causal reading — "conversion fell five points" — and the
-- page has no way of knowing that the discount went from 8% to 21% on the 5th.
-- One line per change, shown in a bar under the control whenever it falls inside
-- either window, so the comparison is read beside its own explanation rather than
-- in a vacuum.
--
-- Deliberately free text and one date. A structured "what kind of change was it"
-- field would be a taxonomy nobody maintains; the value here is entirely in
-- somebody bothering to type the sentence, so the form asks for as little as
-- possible.
create table public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  -- The day the change took effect, not the day it was recorded.
  at          date not null,
  note        text not null,
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  constraint analytics_events_note_not_blank check (btrim(note) <> '')
);

-- Read by /analytics, which is already manager-and-above, and written from
-- Settings. Admin for both: these annotate everybody's numbers, so the set of
-- people who can add one is the set who are accountable for them.
alter table public.analytics_events enable row level security;

create policy analytics_events_select on public.analytics_events
  for select using ((select app.is_admin()));

create policy analytics_events_write on public.analytics_events
  for all using ((select app.is_admin())) with check ((select app.is_admin()));

-- The bar asks "which events fall in this window", twice per page load.
create index analytics_events_at_idx on public.analytics_events (at);

grant select, insert, update, delete on public.analytics_events to authenticated;

-- §83.3. Events in either window, in date order.
--
-- Two ranges rather than one call per range: the bar is a single list and the
-- caller should not have to merge and de-duplicate two of them. A comparison
-- range that is null simply contributes nothing.
create or replace function public.analytics_events_in_range(
  p_from     date,
  p_to       date,
  p_cmp_from date default null,
  p_cmp_to   date default null
)
returns table (
  id    uuid,
  at    date,
  note  text,
  /** Which window it falls in, so the bar can say "in the comparison". */
  scope text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select e.id, e.at, e.note,
         case when e.at between p_from and p_to then 'current' else 'comparison' end
    from public.analytics_events e
   where (e.at between p_from and p_to)
      or (p_cmp_from is not null and p_cmp_to is not null
          and e.at between p_cmp_from and p_cmp_to)
   order by e.at;
$function$;

grant execute on function public.analytics_events_in_range(date, date, date, date)
  to authenticated, service_role;

notify pgrst, 'reload schema';
