-- §63.1. raise_from_counselling suggests by order id, like intake.
--
-- It reported "an open ticket already exists on this number" from a mobile match.
-- §63.1 drops mobile from the match — a parent ringing about two children's
-- orders shares a number and nothing else — and records the suggestion in
-- support.duplicate_candidates so the ticket page can ask about it.
--
-- Still never merges. The returned id is only there for the banner.

create or replace function support.raise_from_counselling(
  p_student_id      uuid,
  /** The counselling enquiry this came from. Null from Quick Add with no match. */
  p_enquiry_id      bigint  default null,
  p_order_id        text    default null,
  p_discussion      text    default null,
  /** public.issue_category as text, or null. */
  p_issue_category  text    default null,
  /** noted | working | escalated | pending_institute | resolved. */
  p_outcome         text    default 'noted',
  p_follow_up_date  date    default null,
  /** Only to name in the opening note; support tracks its own escalations. */
  p_escalated_to    uuid    default null,
  p_teacher_id      uuid    default null,
  /** False for the Quick Add path, where there is no enquiry to close. */
  p_close_enquiry   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
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
begin
  if not app.is_support() then raise exception 'not permitted'; end if;

  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then raise exception 'student % does not exist', p_student_id; end if;

  -- §62.2. The outcome mapping. Escalated and pending-with-institute both land
  -- as `new` and unassigned: the counsellor is handing the ticket over, not
  -- keeping it, and the ticket team needs to see it in New. Which outcome it was
  -- is said in the opening note rather than lost.
  case p_outcome
    when 'working' then
      v_status := 'working'; v_assigned := v_actor; v_follow := p_follow_up_date;
    when 'resolved' then
      v_status := 'resolved'; v_resolved_at := v_now; v_resolved_by := v_actor;
    when 'escalated', 'pending_institute', 'noted' then
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

  -- §63.1. The suggestion is recorded here, by order id, exactly as intake does
  -- it — and nothing is merged. The mobile probe this replaces named any open
  -- ticket on the number, which is a weaker signal than the order and was the
  -- pairing most likely to be wrong.
  perform support.record_duplicate_candidate(v_ticket);
  select c.other_ticket_id into v_existing
    from support.duplicate_candidate_of(v_ticket) c;

  return jsonb_build_object(
    'ticket_id', v_ticket,
    'status', v_status::text,
    'existing_open_ticket', v_existing,
    'closed_enquiry', (p_close_enquiry and p_enquiry_id is not null)
  );
end $fn$;

grant execute on function support.raise_from_counselling(
  uuid, bigint, text, text, text, text, date, uuid, uuid, boolean
) to authenticated, service_role;

notify pgrst, 'reload schema';
