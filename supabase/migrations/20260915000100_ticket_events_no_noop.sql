-- §44b.4. The escalatee is stamped on the enquiry a moment before the call
-- that changes the status, so an escalation logged two events: a
-- working→working row when the name landed, and a working→escalated row when
-- the recompute caught up. The first is an audit row that records nothing
-- anybody asked about.
--
-- The rule is now: a status change is always an event, and a change of
-- escalatee is an event only on a ticket that is already escalated — which is
-- the one case where the name moving is the whole of the news.

create or replace function app.ticket_events_after_status()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.type <> 'after_sale' then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    -- Status unchanged. Only a re-escalation of an escalated ticket counts.
    if new.status <> 'escalated'
       or old.escalated_to is not distinct from new.escalated_to then
      return null;
    end if;
  end if;

  insert into public.ticket_events (enquiry_id, from_status, to_status, escalated_to, actor_id)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    new.escalated_to,
    auth.uid()
  );
  return null;
end $$;
