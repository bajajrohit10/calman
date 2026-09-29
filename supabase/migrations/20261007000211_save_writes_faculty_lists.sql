-- §75.1. The save writes lists, and an institute escalation says which house.
--
-- DROP and recreate: p_institute_id / p_teacher_id become arrays and
-- p_escalated_institute_id is new, so the signature changes.
drop function if exists support.save_ticket_action(
  bigint, text[], text, uuid, uuid, text, text, support.ticket_status, date, uuid,
  boolean, boolean, text, text, boolean, uuid);

CREATE OR REPLACE FUNCTION support.save_ticket_action(p_ticket_id bigint, p_issues text[], p_issue_other text, p_institute_ids uuid[], p_teacher_ids uuid[], p_order_id_work text, p_details text, p_outcome support.ticket_status, p_follow_up_date date, p_escalated_to uuid, p_called boolean DEFAULT false, p_messaged boolean DEFAULT false, p_message_channel text DEFAULT 'whatsapp'::text, p_escalation_kind text DEFAULT NULL::text, p_handover boolean DEFAULT false, p_assigned_to uuid DEFAULT NULL::uuid, p_escalated_institute_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  -- §65.3. The hand-over. Not an outcome value: p_outcome is typed
  -- support.ticket_status and 'handover' is a transition, not a state.
  v_handover   boolean := coalesce(p_handover, false);
  -- §74. Who the ticket belongs to after this save, and whether that moved.
  v_owner      uuid;
  v_owner_from uuid;
  -- §75.1. Every house and teacher this ticket concerns, and which one an
  -- institute escalation went to.
  v_institutes uuid[] := coalesce(p_institute_ids, '{}'::uuid[]);
  v_teachers   uuid[] := coalesce(p_teacher_ids, '{}'::uuid[]);
  v_esc_inst   uuid;
  v_actor_name text;
  v_named      text;
  v_note       text;
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
  if v_handover then
    -- §65.3. The rule the outcome list expresses, restated where it cannot be
    -- bypassed: only a counsellor's own working ticket can be handed over.
    -- §73. Only the raising counsellor hands over — a ticket the team has taken
    -- is theirs to escalate or resolve, not to hand back by this door.
    if not support.tab_matches(t, 'counsellor') then
      raise exception 'Only a counselling ticket still with its counsellor can be handed over.';
    end if;
  elsif p_outcome is null then
    raise exception 'Pick an outcome.';
  end if;

  -- A hand-over clears the date rather than asking for one: it is going to the
  -- team's New queue, and whoever picks it up sets their own.
  if not v_handover and p_outcome <> 'resolved' and p_follow_up_date is null then
    raise exception 'A follow-up date is required unless the ticket is resolved.';
  end if;

  if not v_handover and p_outcome = 'escalated' then
    if v_kind is null or v_kind not in ('team', 'institute') then
      raise exception 'Say whether this is escalated to a team member or to the institute.';
    end if;
    if v_kind = 'team' and p_escalated_to is null then
      raise exception 'Say who this ticket is escalated to.';
    end if;
    -- The institute comes from this very save, so the value being written is
    -- what is checked — not the stale one on the row.
    if v_kind = 'institute' then
      -- §75.1. At least one, from this very save rather than the stale row.
      if cardinality(v_institutes) = 0 then
        raise exception 'Set Institute first — an institute escalation has to name one.';
      end if;
      -- With one there is nothing to choose; with several the choice is the
      -- counsellor's and is not guessed at, because the reports and the
      -- Escalated tab print whichever this names.
      if cardinality(v_institutes) = 1 then
        v_esc_inst := v_institutes[1];
      elsif p_escalated_institute_id is null then
        raise exception 'This ticket names % institutes — say which one it is escalated to.',
          cardinality(v_institutes);
      elsif not (p_escalated_institute_id = any (v_institutes)) then
        raise exception 'The institute escalated to must be one this ticket names.';
      else
        v_esc_inst := p_escalated_institute_id;
      end if;
    end if;
  end if;

  if not (v_issues <@ support.issue_options()) then
    raise exception 'Unknown issue option.';
  end if;

  -- §72.2. The ticket team says what the ticket is about; the counsellor need not.
  --
  -- A counsellor logging a query has a student on the line and may have neither
  -- the order number nor a tidy category (§72.1), so on the Counsellor tab —
  -- source counselling, still being worked — only the outcome and its date are
  -- required. Once the ticket is handed over it is worked from a queue that is
  -- grouped by issue, and an ungrouped row is one nobody picks up.
  --
  -- 'Raised from counselling' is what support.issue_from_counselling() leaves
  -- when no category was given. It exists so the reports never see an issue-less
  -- row, and it deliberately does not satisfy this: it is the system's placeholder,
  -- not somebody's answer.
  -- §73. The same test the tab uses, asked of the row rather than restated: a
  -- counselling ticket the team has taken is the team's, and the team's queue is
  -- grouped by issue.
  if not support.tab_matches(t, 'counsellor')
     and cardinality(v_issues) = 0
     and coalesce(v_other, '') in ('', 'Raised from counselling') then
    raise exception 'Pick an issue — the queue is grouped by it.';
  end if;

  -- An institute escalation has no person, so the column is cleared rather than
  -- left holding whoever it went to last time.
  v_person := case
                when v_kind = 'team' then p_escalated_to
                when v_kind = 'institute' then null
                else t.escalated_to
              end;

  /**
   * §74. Working on it claims the ticket.
   *
   * The four outcomes that mean "this is mine now and I am carrying on with it"
   * take ownership when nobody has it. Without this the team could work a ticket
   * all week and leave assigned_to null, which §73 then reads — correctly — as
   * nobody's, so it sat in Working by default rather than by anyone's decision
   * and no one could be asked about it.
   *
   * Never a takeover. A ticket already on somebody's desk stays there unless the
   * saver names a replacement, which is a deliberate act and is what the panel's
   * "Assigned to … — reassign?" line offers.
   *
   * Resolved does not claim: finishing somebody else's ticket is not taking it.
   * A hand-over clears the column outright (§65.3) and is handled in the update
   * below, so it is excluded here rather than fighting over the same field.
   */
  v_owner_from := t.assigned_to;
  v_owner := case
               when v_handover then null
               when p_assigned_to is not null then p_assigned_to
               when t.assigned_to is not null then t.assigned_to
               when p_outcome in ('working', 'escalated', 'future') then v_actor
               else t.assigned_to
             end;

  -- ---- field changes, one event each, only where something moved.
  if v_order is distinct from t.order_id_work then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'order_id_work',
                               'old', t.order_id_work, 'new', v_order));
  end if;

  if v_institutes is distinct from t.institute_ids then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'institute_ids',
                               'old', to_jsonb(t.institute_ids), 'new', to_jsonb(v_institutes)));
  end if;

  if v_teachers is distinct from t.teacher_ids then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'teacher_ids',
                               'old', to_jsonb(t.teacher_ids), 'new', to_jsonb(v_teachers)));
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
  if v_handover then
    -- §65.3. One event, kind 'handover', so the per-day table can count it
    -- without mistaking it for an escalation.
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'handover',
            jsonb_build_object('old', t.status, 'new', 'new',
                               'from_assigned_to', t.assigned_to,
                               'named', p_escalated_to));
  elsif p_outcome is distinct from t.status
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
                               'institute_id', v_esc_inst));
  end if;

  -- §74. Said on the timeline, because "who has this" is the first question
  -- anybody asks of a ticket and the queue column alone cannot answer when.
  if v_owner is distinct from v_owner_from and not v_handover then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'assignment',
            jsonb_build_object('old', v_owner_from, 'new', v_owner,
                               'claimed', p_assigned_to is null));
  end if;

  -- ---- the note, only when there is one. An empty note event is a row that
  -- ---- says nothing and still takes a line in the history.
  if v_handover then
    select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;
    -- §65.3. A named person is recorded in the note only. The column stays
    -- empty: the ticket is not escalated to them, it is in the team's queue,
    -- and writing escalated_to would put it on the Escalated tab's terms.
    select p.full_name into v_named from public.profiles p where p.id = p_escalated_to;
    v_note := concat_ws(
      ' · ',
      nullif(v_details, ''),
      'Handed over by ' || coalesce(v_actor_name, 'a counsellor'),
      case when v_named is not null then 'suggested: ' || v_named end);
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'note', jsonb_build_object('text', v_note));
  elsif v_details <> '' then
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
         institute_ids    = v_institutes,
         teacher_ids      = v_teachers,
         -- §75.1. Cleared whenever the ticket is not escalated to an institute,
         -- so a stale name cannot outlive the escalation that chose it.
         escalated_institute_id = v_esc_inst,
         issues_work      = v_issues,
         issue_other_work = v_other,
         status           = case when v_handover then 'new' else p_outcome end,
         follow_up_date   = case when v_handover then null
                                 when p_outcome = 'resolved' then null
                                 else p_follow_up_date end,
         -- §65.3. Nobody's, so the team's New queue is a real pool again.
         assigned_to      = v_owner,
         escalation_kind  = case when v_handover then null else v_kind end,
         escalated_to     = case when v_handover then null else v_person end,
         resolved_at      = case when not v_handover and p_outcome = 'resolved'
                                 then coalesce(resolved_at, v_now) else null end,
         resolved_by      = case when not v_handover and p_outcome = 'resolved'
                                 then coalesce(resolved_by, v_actor) else null end,
         last_touched_at  = v_now
   where id = p_ticket_id;

  return p_ticket_id;
end $function$
;


grant execute on function support.save_ticket_action(
  bigint, text[], text, uuid[], uuid[], text, text, support.ticket_status, date, uuid,
  boolean, boolean, text, text, boolean, uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
