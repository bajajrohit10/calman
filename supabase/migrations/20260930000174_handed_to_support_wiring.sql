-- §62.2, part two. Everything that uses the new close_reason.
--
-- Split from 173 because Postgres allows ALTER TYPE ... ADD VALUE inside a
-- transaction but refuses to let the new label be *used* until that transaction
-- commits — and every statement here writes 'handed_to_support' as a literal into
-- a function body, which the body check resolves at creation time. One migration
-- would have failed with "unsafe use of new value of enum type".

-- ---------------------------------------------------------------------------
-- 2. The recompute must leave it alone.
-- ---------------------------------------------------------------------------
--
-- app.recompute_enquiry() derives an enquiry's status from its latest call, and
-- early-returns only for reasons that were a human decision rather than a
-- consequence of call history. Handing to support is exactly that kind of
-- decision — and without this, the next call on the enquiry would recompute it
-- straight back to open, leaving a counselling enquiry and a support ticket both
-- claiming to be the live record.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  patched := replace(src,
$old$if enq.status = 'closed' and enq.close_reason in ('superseded', 'converted') then$old$,
$new$if enq.status = 'closed'
     and enq.close_reason in ('superseded', 'converted', 'handed_to_support') then$new$);

  if patched = src then
    raise exception 'recompute_enquiry: the close_reason guard was not found';
  end if;

  execute patched;
end $mig$;

-- ---------------------------------------------------------------------------
-- 3. The duplicate rules already treat it as closed — but label it honestly.
-- ---------------------------------------------------------------------------
--
-- Nothing had to change for the *behaviour*: app.import_lookup finds an open
-- enquiry with `e.status = 'open'` and an existing ticket with
-- `status in ('open','escalated')`, so a handed-over enquiry is closed to both
-- and a fresh call on the number is a new enquiry rather than a reopen. That is
-- asserted by the tests rather than assumed here.
--
-- The label was wrong though: closed_as fell through to `else 'lost'`, so the
-- import review would have told a counsellor a number was "Lost" when it had in
-- fact become a support ticket. Those are opposite things to read on a screen
-- you are deciding from.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'import_lookup';

  patched := replace(src,
$old$           when e.close_reason = 'wrong_number' then 'wrong_number'$old$,
$new$           when e.close_reason = 'wrong_number' then 'wrong_number'
           when e.close_reason = 'handed_to_support' then 'handed_to_support'$new$);

  if patched = src then
    raise exception 'import_lookup: the closed_as case was not found';
  end if;

  execute patched;
end $mig$;

-- ---------------------------------------------------------------------------
-- 4. The counselling issue category, in Support's vocabulary.
-- ---------------------------------------------------------------------------
--
-- The two lists were written for different jobs and only two pairs are honest:
--
--   book_delivery  -> Courier & Delivery Issues          (the same thing)
--   video_access   -> Link / Serial Key Mail not received (the usual cause: the
--                     access mail never arrived)
--
-- refund, wrong_course and other have no counterpart among the five and are not
-- forced into one — a wrong course is not a "Technical Issue / Course Extension",
-- and pretending otherwise would quietly mis-file every refund request. Those
-- carry their label in issue_other_work instead.
--
-- Either way something is always set, because the ticket team cannot save an
-- action on a ticket with no issue at all.
create or replace function support.issue_from_counselling(p_category text)
returns table (issues text[], issue_other text)
language sql
immutable
set search_path to ''
as $$
  select
    case p_category
      when 'book_delivery' then array['Courier & Delivery Issues']
      when 'video_access'  then array['Link / Serial Key Mail not received']
      else '{}'::text[]
    end,
    case p_category
      when 'book_delivery' then null
      when 'video_access'  then null
      when 'refund'        then 'Refund'
      when 'wrong_course'  then 'Wrong course'
      when 'other'         then 'Other'
      -- No category at all still has to leave something behind.
      else coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'Raised from counselling')
    end;
$$;

grant execute on function support.issue_from_counselling(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Raising the ticket.
-- ---------------------------------------------------------------------------
--
-- One function, so the ticket and the enquiry's closure are one transaction: a
-- closed enquiry with no ticket would be work lost, and a ticket with an open
-- enquiry behind it would be the same complaint in two queues.
--
-- Deliberately NOT the auto-merge path the form intake uses. §62.2 is explicit
-- that a counselling call raises its own ticket even when the number already has
-- an open one; the existing id is returned so the caller can name it, and the
-- merge prompt is Brief 63's.
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
security invoker
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

  -- Any open ticket already on this number, for the caller to name. Not merged:
  -- see the header.
  select t.id into v_existing
    from support.tickets t
   where t.mobile = v_student.mobile
     and t.parent_ticket_id is null
     and t.status <> 'resolved'
   order by t.id
   limit 1;

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

-- ---------------------------------------------------------------------------
-- 6. The badge's query.
-- ---------------------------------------------------------------------------
--
-- Every support ticket linked to a counselling enquiry, with its live status. A
-- student can raise more than one against the same won enquiry, so this returns
-- a set rather than one row, newest first.
create or replace function support.tickets_for_enquiry(p_enquiry_ids bigint[])
returns table (
  counselling_enquiry_id bigint, ticket_id bigint,
  status support.ticket_status, escalation_kind text,
  follow_up_date date, resolved_at timestamptz, raised_at timestamptz
)
language sql
stable
set search_path to ''
as $$
  select t.counselling_enquiry_id, t.id, t.status, t.escalation_kind,
         t.follow_up_date, t.resolved_at, t.raised_at
    from support.tickets t
   where t.counselling_enquiry_id = any (p_enquiry_ids)
   order by t.counselling_enquiry_id, t.id desc;
$$;

grant execute on function support.tickets_for_enquiry(bigint[])
  to authenticated, service_role;

notify pgrst, 'reload schema';
