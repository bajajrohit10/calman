-- §58.4 fix. save_ticket_action could not write a status_change event.
--
-- The three-armed CASE choosing between 'resolved', 'reopened' and
-- 'status_change' produces `text`, and support.events.kind is an enum, so every
-- save that actually moved the status failed with
--
--   column "kind" is of type support.event_kind but expression is of type text
--
-- Postgres implicitly casts a bare literal to an enum but not the result of a
-- CASE, so the field-change and note inserts around it were fine and only this
-- one broke — which is why it survived the migration and was caught by the
-- first save that changed a status rather than by the push.
--
-- The whole function is restated rather than patched with replace() on its
-- source: a regular expression over a plpgsql body has bitten this project
-- before, and the body contains its own `end if;` and `case` keywords.

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
  p_message_channel  text    default 'whatsapp'
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
begin
  if not app.is_support() then raise exception 'not permitted'; end if;

  select * into t from support.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket % does not exist', p_ticket_id; end if;
  if t.parent_ticket_id is not null then
    raise exception 'ticket % is merged into %; work the parent',
      p_ticket_id, t.parent_ticket_id;
  end if;

  if v_details = '' then
    raise exception 'Say what was done — the action details are required.';
  end if;
  if p_outcome is null then
    raise exception 'Pick an outcome.';
  end if;
  if p_outcome <> 'resolved' and p_follow_up_date is null then
    raise exception 'A follow-up date is required unless the ticket is resolved.';
  end if;
  if p_outcome = 'escalated' and p_escalated_to is null then
    raise exception 'Say who this ticket is escalated to.';
  end if;
  if not (v_issues <@ support.issue_options()) then
    raise exception 'Unknown issue option.';
  end if;

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

  -- Order-insensitive comparison: the checkbox order on screen is not a change.
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

  -- ---- the status move.
  if p_outcome is distinct from t.status
     or p_follow_up_date is distinct from t.follow_up_date
     or p_escalated_to is distinct from t.escalated_to then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor,
            (case when p_outcome = 'resolved' and t.status <> 'resolved' then 'resolved'
                  when t.status = 'resolved' and p_outcome <> 'resolved' then 'reopened'
                  else 'status_change' end)::support.event_kind,
            jsonb_build_object('old', t.status, 'new', p_outcome,
                               'follow_up_date', p_follow_up_date,
                               'escalated_to', p_escalated_to));
  end if;

  -- ---- the note carrying the action details. Always written: it is the
  -- ---- reason the save is one form rather than a status dropdown.
  insert into support.events (ticket_id, actor_id, kind, detail)
  values (p_ticket_id, v_actor, 'note', jsonb_build_object('text', v_details));

  -- ---- one event per ticked box.
  if coalesce(p_called, false) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'called',
            jsonb_build_object('picked', true, 'note', v_details, 'via', 'action panel'));
  end if;

  if coalesce(p_messaged, false) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'messaged',
            jsonb_build_object('channel', coalesce(nullif(p_message_channel, ''), 'whatsapp'),
                               'note', v_details, 'via', 'action panel'));
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
         escalated_to     = case when p_outcome = 'escalated' then p_escalated_to
                                 else escalated_to end,
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
  boolean, boolean, text
) to authenticated, service_role;


notify pgrst, 'reload schema';
