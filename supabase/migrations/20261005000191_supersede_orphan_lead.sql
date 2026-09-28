-- §69.2. A lead that existed only to open the call panel does not stay in New Calls.
--
-- DROP and recreate: p_supersede_lead_id is a new parameter, and adding one to an
-- existing function creates a second overload rather than replacing the first.
drop function if exists support.raise_from_counselling(
  uuid, bigint, text, text, text, text, date, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION support.raise_from_counselling(p_student_id uuid, p_enquiry_id bigint DEFAULT NULL::bigint, p_order_id text DEFAULT NULL::text, p_discussion text DEFAULT NULL::text, p_issue_category text DEFAULT NULL::text, p_outcome text DEFAULT 'noted'::text, p_follow_up_date date DEFAULT NULL::date, p_escalated_to uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_close_enquiry boolean DEFAULT true, p_supersede_lead_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor      uuid := (select auth.uid());
  v_now        timestamptz := now();
  v_student    public.students%rowtype;
  v_ticket     bigint;
  v_existing   bigint;
  v_status     support.ticket_status;
  v_assigned   uuid;
  v_follow     date;
  v_resolved_at timestamptz;
  v_resolved_by uuid;
  v_issues     text[];
  v_other      text;
  v_institute  uuid;
  v_teacher    uuid := p_teacher_id;
  v_actor_name text;
  v_note       text;
  v_cat_label  text;
  -- §69.2. Whether the lead this was raised from was closed behind us.
  v_superseded boolean := false;
begin
  if not app.is_support() then raise exception 'not permitted'; end if;

  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then raise exception 'student % does not exist', p_student_id; end if;

  -- §62.2. The outcome mapping. Escalated and pending-with-institute both land
  -- as `new` and unassigned: the counsellor is handing the ticket over, not
  -- keeping it, and the ticket team needs to see it in New. Which outcome it was
  -- is said in the opening note rather than lost.
  case p_outcome
    -- §65.0. 'noted' joins 'working': the counsellor who raised it keeps it.
    when 'working', 'noted' then
      v_status := 'working';
      v_assigned := v_actor;
      -- Defaulted, not demanded: the same working-day answer every other
      -- Calman date control gets.
      v_follow := coalesce(p_follow_up_date, public.next_working_day());
    when 'resolved' then
      v_status := 'resolved'; v_resolved_at := v_now; v_resolved_by := v_actor;
    -- §65.0. A real hand-over, and the only way into New from this side.
    when 'escalated', 'pending_institute' then
      v_status := 'new';
    else
      raise exception 'unknown counselling outcome %', p_outcome;
  end case;

  -- A status that demands a date must have one, and `working` is the only mapped
  -- status that does. Refused rather than silently downgraded.
  if v_status = 'working' and v_follow is null then
    raise exception 'A follow-up date is required to hand this over as Working on it.';
  end if;

  select i.issues, i.issue_other into v_issues, v_other
    from support.issue_from_counselling(p_issue_category) i;

  -- The institute comes from the teacher where the masters link them, so a
  -- ticket raised about a teacher is filed against the house that sells them.
  if v_teacher is not null then
    select t.institute_id into v_institute from public.teachers t where t.id = v_teacher;
  end if;

  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;

  v_cat_label := case p_issue_category
                   when 'video_access'  then 'Video access'
                   when 'book_delivery' then 'Book delivery'
                   when 'refund'        then 'Refund'
                   when 'wrong_course'  then 'Wrong course'
                   when 'other'         then 'Other'
                   else null
                 end;

  -- The opening note carries what the mapping cannot: which counselling outcome
  -- the counsellor chose, the category in their own words, and who it was being
  -- escalated to. Always includes the category, per §62.2.
  v_note := concat_ws(
    ' · ',
    'Raised from counselling by ' || coalesce(v_actor_name, 'a counsellor'),
    case when v_cat_label is not null then 'Issue: ' || v_cat_label end,
    'Counselling outcome: ' || p_outcome,
    case when p_escalated_to is not null
         then 'was being escalated to '
              || coalesce((select full_name from public.profiles where id = p_escalated_to), 'someone') end,
    case when p_enquiry_id is not null then 'counselling enquiry #' || p_enquiry_id end
  );


  insert into support.tickets (
    source, raised_at, student_name, mobile_raw, mobile,
    order_id_raw, order_id, issues, issue_other, description,
    order_id_work, issues_work, issue_other_work,
    institute_id, teacher_id,
    status, follow_up_date, assigned_to,
    resolved_at, resolved_by,
    counselling_enquiry_id, last_touched_at
  ) values (
    'counselling', v_now, v_student.name, v_student.mobile, v_student.mobile,
    p_order_id, nullif(btrim(coalesce(p_order_id, '')), ''),
    v_issues, v_other, nullif(btrim(coalesce(p_discussion, '')), ''),
    nullif(btrim(coalesce(p_order_id, '')), ''), v_issues, v_other,
    v_institute, v_teacher,
    v_status, v_follow, v_assigned,
    v_resolved_at, v_resolved_by,
    p_enquiry_id, v_now
  )
  returning id into v_ticket;

  insert into support.events (ticket_id, actor_id, kind, detail) values
    (v_ticket, v_actor, 'created',
     jsonb_build_object('source', 'counselling', 'order_id', p_order_id,
                        'issues', to_jsonb(v_issues), 'issue_other', v_other,
                        'counselling_outcome', p_outcome)),
    (v_ticket, v_actor, 'counselling_link',
     jsonb_build_object('enquiry_id', p_enquiry_id, 'by', v_actor_name,
                        'outcome', p_outcome)),
    (v_ticket, v_actor, 'note', jsonb_build_object('text', v_note));

  if v_status <> 'new' then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (v_ticket, v_actor,
            (case when v_status = 'resolved' then 'resolved' else 'status_change' end)::support.event_kind,
            jsonb_build_object('old', 'new', 'new', v_status,
                               'follow_up_date', v_follow));
  end if;

  -- The enquiry closes in the same transaction. status + close_reason, the shape
  -- `superseded` already uses, and the recompute guard above is what keeps it
  -- closed when a later call lands on it.
  if p_close_enquiry and p_enquiry_id is not null then
    update public.enquiries
       set status = 'closed',
           close_reason = 'handed_to_support',
           closed_at = coalesce(closed_at, v_now),
           next_follow_up_date = null
     where id = p_enquiry_id;
  end if;

  -- ---------------------------------------------------------------------------
  -- §69.2. The lead that existed only to make this call.
  -- ---------------------------------------------------------------------------
  --
  -- The after-sale tick on the call panel raises a ticket and leaves the purchase
  -- lead alone, because the student may still be a live lead whatever went wrong
  -- with their order (§62.2). That is right when the lead has a history. It is
  -- wrong when Quick Add created the lead seconds earlier so the counsellor could
  -- open the call panel at all: the call goes to Support, no counselling call is
  -- ever written, and the lead is left in New Calls with no name, no product and
  -- nobody who will ever ring it. Three appeared in one evening.
  --
  -- So: zero calls and zero interest lines means the lead never became anything,
  -- and it closes as superseded — the same word, shape and recompute guard that
  -- §5.1 already uses for a lead replaced by another record. The tests are on the
  -- row itself rather than on what the caller believes, so no route can ask for a
  -- lead with real work on it to be thrown away.
  --
  -- product_text and pre_call_note are deliberately not part of the test: Quick
  -- Add writes both as defaults, and they survive on the closed row anyway.
  if p_supersede_lead_id is not null
     and p_supersede_lead_id is distinct from p_enquiry_id then
    update public.enquiries e
       set status = 'closed',
           close_reason = 'superseded',
           closed_at = coalesce(e.closed_at, v_now),
           next_follow_up_date = null
     where e.id = p_supersede_lead_id
       and e.type = 'purchase'
       and e.status <> 'closed'
       and not exists (select 1 from public.calls c where c.enquiry_id = e.id)
       and not exists (select 1 from public.enquiry_items i where i.enquiry_id = e.id);
    v_superseded := found;
  end if;

  -- §63.1. The suggestion is recorded here, by order id, exactly as intake does
  -- it — and nothing is merged. The mobile probe this replaces named any open
  -- ticket on the number, which is a weaker signal than the order and was the
  -- pairing most likely to be wrong.
  perform support.record_duplicate_candidate(v_ticket);
  select c.other_ticket_id into v_existing
    from support.duplicate_candidate_of(v_ticket) c;

  return jsonb_build_object(
    -- §69.2. So the panel can say the lead was closed rather than leaving the
    -- counsellor to notice it missing from New Calls.
    'superseded_lead', case when v_superseded then p_supersede_lead_id end,
    'ticket_id', v_ticket,
    'status', v_status::text,
    'existing_open_ticket', v_existing,
    'closed_enquiry', (p_close_enquiry and p_enquiry_id is not null)
  );
end $function$
;


grant execute on function support.raise_from_counselling(
  uuid, bigint, text, text, text, text, date, uuid, uuid, boolean, bigint)
  to authenticated, service_role;

notify pgrst, 'reload schema';
