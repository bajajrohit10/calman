-- §64.1. Action details become optional.
--
-- They were required so no status could move unexplained. In practice the status
-- change, the follow-up date and the ticked boxes already say what happened for
-- most saves, and a mandatory field with nothing to put in it gets filled with a
-- full stop — which is worse than blank, because it looks like a note.
--
-- status_change and field_change are unaffected: a save still records what it
-- changed. What goes is the empty note event.

create or replace function support.save_ticket_action(
  p_ticket_id        bigint,
  p_issues           text[],
  p_issue_other      text,
  p_institute_id     uuid,
  p_teacher_id       uuid,
  p_order_id_work    text,
  p_details          text,
  p_outcome          support.ticket_status,
  p_follow_up_date   date,
  p_escalated_to     uuid,
  p_called           boolean default false,
  p_messaged         boolean default false,
  p_message_channel  text    default 'whatsapp',
  /** §61.2: required when the outcome is escalated, ignored otherwise. */
  p_escalation_kind  text    default null
)
returns bigint
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  t            support.tickets%rowtype;
  v_actor      uuid := (select auth.uid());
  v_now        timestamptz := now();
  v_details    text := btrim(coalesce(p_details, ''));
  v_issues     text[] := coalesce(p_issues, '{}'::text[]);
  v_other      text := nullif(btrim(coalesce(p_issue_other, '')), '');
  v_order      text := nullif(btrim(coalesce(p_order_id_work, '')), '');
  -- The kind only exists while the ticket is escalated. Anything else clears
  -- it, so a ticket moved from escalated to working does not keep claiming to
  -- be with the institute.
  v_kind       text := case when p_outcome = 'escalated' then p_escalation_kind end;
  v_person     uuid;
begin
  if not app.is_support() then raise exception 'not permitted'; end if;

  select * into t from support.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket % does not exist', p_ticket_id; end if;
  if t.parent_ticket_id is not null then
    raise exception 'ticket % is merged into %; work the parent',
      p_ticket_id, t.parent_ticket_id;
  end if;

  -- §64.1. The details are optional now. They were mandatory so that no status
  -- ever moved unexplained, but the status change, the date and the ticked boxes
  -- already say what happened for most saves, and a required field with nothing
  -- to put in it gets filled with a full stop.
  if p_outcome is null then
    raise exception 'Pick an outcome.';
  end if;
  if p_outcome <> 'resolved' and p_follow_up_date is null then
    raise exception 'A follow-up date is required unless the ticket is resolved.';
  end if;

  if p_outcome = 'escalated' then
    if v_kind is null or v_kind not in ('team', 'institute') then
      raise exception 'Say whether this is escalated to a team member or to the institute.';
    end if;
    if v_kind = 'team' and p_escalated_to is null then
      raise exception 'Say who this ticket is escalated to.';
    end if;
    -- The institute comes from this very save, so the value being written is
    -- what is checked — not the stale one on the row.
    if v_kind = 'institute' and p_institute_id is null then
      raise exception 'Set Institute first — an institute escalation has to name one.';
    end if;
  end if;

  if not (v_issues <@ support.issue_options()) then
    raise exception 'Unknown issue option.';
  end if;

  -- An institute escalation has no person, so the column is cleared rather than
  -- left holding whoever it went to last time.
  v_person := case
                when v_kind = 'team' then p_escalated_to
                when v_kind = 'institute' then null
                else t.escalated_to
              end;

  -- ---- field changes, one event each, only where something moved.
  if v_order is distinct from t.order_id_work then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'order_id_work',
                               'old', t.order_id_work, 'new', v_order));
  end if;

  if p_institute_id is distinct from t.institute_id then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'institute_id',
                               'old', t.institute_id, 'new', p_institute_id));
  end if;

  if p_teacher_id is distinct from t.teacher_id then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'teacher_id',
                               'old', t.teacher_id, 'new', p_teacher_id));
  end if;

  if not (v_issues <@ t.issues_work and t.issues_work <@ v_issues) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'issues_work',
                               'old', to_jsonb(t.issues_work), 'new', to_jsonb(v_issues)));
  end if;

  if v_other is distinct from t.issue_other_work then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'issue_other_work',
                               'old', t.issue_other_work, 'new', v_other));
  end if;

  -- ---- the status move. The kind is part of it: escalating the same ticket
  -- ---- from a colleague to the institute is a real change even though the
  -- ---- status did not move.
  if p_outcome is distinct from t.status
     or p_follow_up_date is distinct from t.follow_up_date
     or v_person is distinct from t.escalated_to
     or v_kind is distinct from t.escalation_kind then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor,
            (case when p_outcome = 'resolved' and t.status <> 'resolved' then 'resolved'
                  when t.status = 'resolved' and p_outcome <> 'resolved' then 'reopened'
                  else 'status_change' end)::support.event_kind,
            jsonb_build_object('old', t.status, 'new', p_outcome,
                               'follow_up_date', p_follow_up_date,
                               'escalation_kind', v_kind,
                               'escalated_to', v_person,
                               'institute_id', case when v_kind = 'institute'
                                                    then p_institute_id end));
  end if;

  -- ---- the note, only when there is one. An empty note event is a row that
  -- ---- says nothing and still takes a line in the history.
  if v_details <> '' then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'note', jsonb_build_object('text', v_details));
  end if;

  -- ---- one event per ticked box.
  if coalesce(p_called, false) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'called',
            jsonb_build_object('picked', true, 'note', nullif(v_details, ''), 'via', 'action panel'));
  end if;

  if coalesce(p_messaged, false) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'messaged',
            jsonb_build_object('channel', coalesce(nullif(p_message_channel, ''), 'whatsapp'),
                               'note', nullif(v_details, ''), 'via', 'action panel'));
  end if;

  -- ---- and the row itself.
  update support.tickets
     set order_id_work    = v_order,
         institute_id     = p_institute_id,
         teacher_id       = p_teacher_id,
         issues_work      = v_issues,
         issue_other_work = v_other,
         status           = p_outcome,
         follow_up_date   = case when p_outcome = 'resolved' then null
                                 else p_follow_up_date end,
         escalation_kind  = v_kind,
         escalated_to     = v_person,
         resolved_at      = case when p_outcome = 'resolved' then coalesce(resolved_at, v_now)
                                 else null end,
         resolved_by      = case when p_outcome = 'resolved' then coalesce(resolved_by, v_actor)
                                 else null end,
         last_touched_at  = v_now
   where id = p_ticket_id;

  return p_ticket_id;
end $fn$;

grant execute on function support.save_ticket_action(
  bigint, text[], text, uuid, uuid, text, text, support.ticket_status, date, uuid,
  boolean, boolean, text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
