-- §73. Who raised the ticket, as a column.
--
-- The Counsellor tab is about to mean "still with the counsellor who raised it",
-- and there was nothing on the row to compare assigned_to against. The raiser was
-- only ever recorded as the actor on the `created` event and in the wording of
-- the opening note — recoverable, but not something a tab rule can read: the
-- rule is evaluated per row inside support.tab_matches, which is immutable and
-- takes a ticket, not a query plan that can go and read the event log.
alter table support.tickets
  add column if not exists raised_by uuid references public.profiles (id);

comment on column support.tickets.raised_by is
  '§73. The person who raised this ticket, where a person did. Null for the form '
  'webhook, which has nobody behind it. Compared against assigned_to to decide '
  'whether a counselling ticket is still with its counsellor.';

-- The backfill, from the one place the answer was already kept. Only where the
-- created event names an actor: a form ticket has none and stays null, which is
-- correct rather than missing.
update support.tickets t
   set raised_by = e.actor_id
  from support.events e
 where e.ticket_id = t.id
   and e.kind = 'created'
   and e.actor_id is not null
   and t.raised_by is null;

-- The queue asks "is this still the raiser's" for every counselling row it lists.
create index if not exists tickets_raised_by_idx
  on support.tickets (raised_by) where raised_by is not null;
