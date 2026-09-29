-- §75.1. A merge gives the parent every institute and teacher the child knew.
--
-- CREATE OR REPLACE: the signature is unchanged.

CREATE OR REPLACE FUNCTION support.merge_ticket(p_child_id bigint, p_parent_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
         -- §64.3, §75.1. The institute the inherited kind needs: the child keeps
         -- its own list where it has one and borrows the parent's where it has
         -- none, because an institute escalation must name at least one.
         institute_ids    = case when cardinality(c.institute_ids) > 0
                                 then c.institute_ids else p.institute_ids end,
         resolved_at      = null,
         resolved_by      = null,
         last_touched_at  = v_now
   where id = p_child_id;

  insert into support.events (ticket_id, actor_id, kind, detail) values
    (p_child_id,  v_actor, 'merged_into',  jsonb_build_object('ticket_id', p_parent_id, 'automatic', false)),
    (p_parent_id, v_actor, 'child_merged', jsonb_build_object('ticket_id', p_child_id,  'automatic', false));

  /**
   * §75.1. The parent gains whatever the child knew.
   *
   * They are two reports of one complaint, so a house named on either is a house
   * the merged ticket concerns — and the child is about to stop being listed, so
   * anything only it carried would otherwise be lost. The parent's own list is
   * kept in order and the child's additions follow it: the parent is the record
   * that survives, and its first institute stays first (the singular column, and
   * so the escalation, follow it while both shapes exist).
   */
  update support.tickets t
     set last_touched_at = v_now,
         institute_ids = (
           select coalesce(array_agg(x order by ord), '{}'::uuid[])
             from (select x, min(ord) as ord
                     from unnest(t.institute_ids || c.institute_ids)
                          with ordinality as u(x, ord)
                    group by x) d),
         teacher_ids = (
           select coalesce(array_agg(x order by ord), '{}'::uuid[])
             from (select x, min(ord) as ord
                     from unnest(t.teacher_ids || c.teacher_ids)
                          with ordinality as u(x, ord)
                    group by x) d)
   where t.id = p_parent_id;

  -- §63.1. The suggestion, if there was one, is now settled — whichever
  -- direction it was recorded in, and whether or not this merge came from the
  -- prompt or from "Merge into…" by hand.
  update support.duplicate_candidates
     set merged_at = v_now
   where lo_ticket_id = least(p_child_id, p_parent_id)
     and hi_ticket_id = greatest(p_child_id, p_parent_id)
     and merged_at is null;

  return p_parent_id;
end $function$
;

notify pgrst, 'reload schema';
