-- §61.2 follow-up. merge_ticket copies the parent's escalation kind.
--
-- A child copies its parent's state so the duplicate does not read as a
-- different situation. Migration 167 made escalation_kind mandatory exactly when
-- status is 'escalated', so a merge into an escalated parent now has to carry
-- the kind across or the insert is refused outright.
--
-- Restated in full rather than patched with replace() over pg_get_functiondef:
-- the body holds its own `case` and `end if` keywords and this project has been
-- bitten by a regex over plpgsql before.

create or replace function support.merge_ticket(
  p_child_id  bigint,
  p_parent_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  c support.tickets%rowtype;
  p support.tickets%rowtype;
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
begin
  if not app.is_support() then raise exception 'not permitted'; end if;
  if p_child_id = p_parent_id then raise exception 'A ticket cannot merge into itself.'; end if;

  select * into c from support.tickets where id = p_child_id for update;
  if not found then raise exception 'ticket % does not exist', p_child_id; end if;
  select * into p from support.tickets where id = p_parent_id for update;
  if not found then raise exception 'ticket % does not exist', p_parent_id; end if;

  if c.parent_ticket_id is not null then
    raise exception 'Ticket % is already merged into %.', p_child_id, c.parent_ticket_id;
  end if;
  if p.parent_ticket_id is not null then
    raise exception 'Ticket % is itself a duplicate of %; merge into that one instead.',
      p_parent_id, p.parent_ticket_id;
  end if;
  -- A child copies the parent's status, and a resolved parent would hand the
  -- child a 'resolved' with no resolved_at of its own. Refused rather than
  -- papered over: merging into a closed ticket is nearly always the wrong
  -- target, and the team can reopen it first if it really is the right one.
  if p.status = 'resolved' then
    raise exception 'Ticket % is resolved. Reopen it before merging into it.', p_parent_id;
  end if;
  if exists (select 1 from support.tickets x where x.parent_ticket_id = p_child_id) then
    raise exception 'Ticket % has duplicates of its own; merge those first.', p_child_id;
  end if;

  update support.tickets
     set parent_ticket_id = p_parent_id,
         merged_at        = v_now,
         status           = p.status,
         follow_up_date   = p.follow_up_date,
         -- §61.2. The kind travels with the status and the escalatee. Without
         -- it, merging into an escalated parent gives the child a status of
         -- 'escalated' and no kind, which tickets_escalation_kind_set refuses —
         -- so the merge would fail rather than mis-record.
         escalation_kind  = p.escalation_kind,
         escalated_to     = p.escalated_to,
         resolved_at      = null,
         resolved_by      = null,
         last_touched_at  = v_now
   where id = p_child_id;

  insert into support.events (ticket_id, actor_id, kind, detail) values
    (p_child_id,  v_actor, 'merged_into',  jsonb_build_object('ticket_id', p_parent_id, 'automatic', false)),
    (p_parent_id, v_actor, 'child_merged', jsonb_build_object('ticket_id', p_child_id,  'automatic', false));

  update support.tickets set last_touched_at = v_now where id = p_parent_id;
  return p_parent_id;
end $fn$;

grant execute on function support.merge_ticket(bigint, bigint)
  to authenticated, service_role;

notify pgrst, 'reload schema';
