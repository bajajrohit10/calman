-- §78. An after-sale hand-off closes the lead and marks it done.
--
-- Ticking "this is an after-sale call" on the call panel raised a Support ticket
-- and then left the counselling lead exactly where it was (§62.2), writing no
-- call at all. Three consequences, all of them reported as bugs:
--
--   * the lead stayed open in New Calls with nobody who would ever ring it;
--   * it stayed *pending* on the assignment desk for ever, because "still to do"
--     means "no call since it was handed over" (§76) and no call was ever made;
--   * the counsellor's own report showed no work for the call they had just made.
--
-- §69.2 closed the subset that had no calls and no interest lines, as
-- `superseded`. That was a patch on the shape of the accident — a Quick Add lead
-- created seconds earlier — and it left the leads with a history in exactly the
-- state described above. One rule replaces it: the hand-off is written down as a
-- call, and the lead closes as handed_to_support whatever its history.

-- ---------------------------------------------------------------------------
-- 1. The outcome is legal on a purchase lead.
-- ---------------------------------------------------------------------------
--
-- Only on a purchase lead: that is the only enquiry the after-sale tick is ever
-- pressed on. An after-sale enquiry going to Support already writes a real call
-- with a real outcome first (§62.2, the door below), so it never needs this one,
-- and a constraint that refuses is the right answer if some later route tries.
alter table public.calls drop constraint outcome_matches_type;
alter table public.calls add constraint outcome_matches_type check (
  (enquiry_type = 'purchase' and outcome in (
     'follow_up', 'call_back', 'purchased', 'competitor', 'not_interested',
     'closed',
     -- §78.
     'ticket_raised'))
  or
  (enquiry_type = 'after_sale' and outcome in (
     'noted', 'working', 'escalated', 'pending_institute', 'resolved'))
);

-- ---------------------------------------------------------------------------
-- 2. The recompute knows what a hand-off means.
-- ---------------------------------------------------------------------------
--
-- Without this the new call falls through to the follow_up | call_back arm and
-- re-opens the lead it just closed. Put ahead of the after_sale branch rather
-- than inside the purchase ones because the answer does not depend on the type:
-- an enquiry whose last call handed it to Support is closed, and the guard at the
-- top of this function then keeps it closed when a later call lands.
--
-- Stated here rather than only in raise_from_counselling so that the close does
-- not depend on which of the two runs last inside that transaction, and so that
-- deleting or re-inserting the call cannot leave the lead half-closed — which is
-- exactly how the §65 wipe re-opened enquiry 1645.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  patched := replace(src,
$old$  elsif enq.type = 'after_sale' then$old$,
$new$  elsif v_last.outcome = 'ticket_raised' then
    -- §78. The lead went to Support. Closed, and said so.
    v_status := 'closed';
    v_close  := 'handed_to_support';
    v_next   := null;

  elsif enq.type = 'after_sale' then$new$);

  if patched = src then
    raise exception 'recompute_enquiry: the after_sale branch was not matched';
  end if;
  execute patched;
end $mig$;

-- ---------------------------------------------------------------------------
-- 3. The hand-off writes the call and closes the lead.
-- ---------------------------------------------------------------------------
--
-- DROP first: p_supersede_lead_id leaves and p_write_call arrives, and Postgres
-- will not change a parameter list in place.
drop function support.raise_from_counselling(
  uuid, bigint, text, text, text, text, date, uuid, uuid, boolean, bigint);

CREATE OR REPLACE FUNCTION support.raise_from_counselling(p_student_id uuid, p_enquiry_id bigint DEFAULT NULL::bigint, p_order_id text DEFAULT NULL::text, p_discussion text DEFAULT NULL::text, p_issue_category text DEFAULT NULL::text, p_outcome text DEFAULT 'noted'::text, p_follow_up_date date DEFAULT NULL::date, p_escalated_to uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_close_enquiry boolean DEFAULT true, p_write_call boolean DEFAULT false)
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
  -- §78. The counselling call that records the hand-off, and the assignment it
  -- was made under.
  v_out_label  text;
  v_asgn       uuid;
  v_bucket     public.assignment_bucket;
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

  -- §78. The same words the counsellor picked from, for the counselling call's
  -- note. The ticket's own opening note quotes the raw value because the ticket
  -- team reads it alongside the mapping; a counsellor reading their own history
  -- should see the phrase they chose.
  v_out_label := case p_outcome
                   when 'noted'             then 'Ticket, still open'
                   when 'working'           then 'Working on it'
                   when 'escalated'         then 'Escalated'
                   when 'pending_institute' then 'Pending with the institute'
                   when 'resolved'          then 'Resolved'
                   else p_outcome
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
    -- §73. The counsellor who raised it, so the Counsellor tab can ask whether
    -- it is still theirs rather than merely whether it came from counselling.
    raised_by,
    resolved_at, resolved_by,
    counselling_enquiry_id, last_touched_at
  ) values (
    'counselling', v_now, v_student.name, v_student.mobile, v_student.mobile,
    p_order_id, nullif(btrim(coalesce(p_order_id, '')), ''),
    v_issues, v_other, nullif(btrim(coalesce(p_discussion, '')), ''),
    nullif(btrim(coalesce(p_order_id, '')), ''), v_issues, v_other,
    v_institute, v_teacher,
    v_status, v_follow, v_assigned,
    v_actor,
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

  -- ---------------------------------------------------------------------------
  -- §78. One counselling call, so the lead is done for the day.
  -- ---------------------------------------------------------------------------
  --
  -- The call panel's after-sale tick writes no call of its own — the call *is*
  -- the ticket — so without this the lead is never worked on any day: My Day and
  -- the desk grid both read "a call on this lead since it was handed over" (§76)
  -- and the answer stayed no for ever. One call, outcome ticket_raised, by the
  -- counsellor, dated now.
  --
  -- The bucket is snapshotted onto the row rather than left to the assignment it
  -- names, for the §70.1 reason: assignments is unique on (enquiry_id, date), so
  -- a six o'clock re-assignment moves the row and would rewrite this morning's
  -- attribution.
  --
  -- The insert fires app.recompute_enquiry, which reads ticket_raised as closed +
  -- handed_to_support. The explicit close below therefore agrees with it rather
  -- than fighting it, and is kept because this function is the thing asserting
  -- the hand-off — it should not depend on trigger order to say so.
  --
  -- The door that already writes its own call (an enquiry in the old after-sale
  -- pipeline) passes p_write_call => false and keeps the outcome the counsellor
  -- actually chose.
  if p_write_call and p_enquiry_id is not null then
    select a.id, a.bucket into v_asgn, v_bucket
      from public.assignments a
     where a.enquiry_id = p_enquiry_id
       and a.date = (v_now at time zone 'Asia/Kolkata')::date;

    insert into public.calls (
      enquiry_id, called_at, called_by, outcome, discussion,
      assignment_id, assignment_bucket
    ) values (
      p_enquiry_id, v_now, v_actor, 'ticket_raised',
      'Support ticket #' || v_ticket || ' raised · ' || v_out_label,
      v_asgn, v_bucket
    );
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

  -- §78. §69.2 stood here: the lead was closed as `superseded`, but only when it
  -- had no calls and no interest lines, so a lead with a history stayed open and
  -- permanently pending. The close above now covers both — one rule, whatever the
  -- lead's history — and p_supersede_lead_id is gone with it.

  -- §63.1. The suggestion is recorded here, by order id, exactly as intake does
  -- it — and nothing is merged. The mobile probe this replaces named any open
  -- ticket on the number, which is a weaker signal than the order and was the
  -- pairing most likely to be wrong.
  perform support.record_duplicate_candidate(v_ticket);
  select c.other_ticket_id into v_existing
    from support.duplicate_candidate_of(v_ticket) c;

  return jsonb_build_object(
    -- §78. So the panel can say which lead was closed rather than leaving the
    -- counsellor to notice it missing from New Calls.
    'closed_lead', case when p_close_enquiry then p_enquiry_id end,
    'ticket_id', v_ticket,
    'status', v_status::text,
    'existing_open_ticket', v_existing,
    'closed_enquiry', (p_close_enquiry and p_enquiry_id is not null)
  );
end $function$;

grant execute on function support.raise_from_counselling(
  uuid, bigint, text, text, text, text, date, uuid, uuid, boolean, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The leads already handed over, closed the same way.
-- ---------------------------------------------------------------------------
--
-- Five counselling-source tickets were raised from three still-open leads before
-- this deployed: #246 from 1733 (9819359639), #266 from 1870 (9664821455), and
-- #272, #283 and #288 from 1880 (9607411208). Each of those three students has
-- exactly one purchase enquiry and no won enquiry, which is why the ticket's
-- counselling_enquiry_id is null — the convert door files the ticket against what
-- the student bought, and they had bought nothing here.
--
-- Written as a predicate rather than as three ids so that a ticket raised between
-- this being written and it being applied is caught too. It is conservative and
-- idempotent: an open purchase lead for the same student that existed before the
-- ticket, and only ever a close.
--
-- Deliberately *not* back-dating a ticket_raised call onto those past days. The
-- call is a record of work done, and inventing five of them would move numbers on
-- reports the team has already read. Without a call the closed lead simply leaves
-- that day's assignment total (§76's first rule) instead of showing as done,
-- which is the truthful answer for a hand-off nobody wrote down at the time.
create temporary table _b78_leads on commit drop as
select distinct e.id as enquiry_id, s.mobile
  from support.tickets t
  join public.students s on s.mobile = t.mobile
  join public.enquiries e on e.student_id = s.id
 where t.source = 'counselling'
   and t.parent_ticket_id is null
   and t.raised_by is not null
   and e.type = 'purchase'
   and e.status not in ('won', 'lost', 'closed')
   and e.created_at < t.created_at;

-- The badge the Enquiries list and the student page already draw reads
-- support.tickets.counselling_enquiry_id, so the link is filled in where it was
-- null — the relation is "the enquiry this was raised from", and for these it is
-- the lead. Where the door had a won enquiry to file against, that stands.
update support.tickets t
   set counselling_enquiry_id = l.enquiry_id
  from public.students s, _b78_leads l
 where s.mobile = t.mobile
   and l.mobile = s.mobile
   and t.source = 'counselling'
   and t.parent_ticket_id is null
   and t.counselling_enquiry_id is null;

update public.enquiries e
   set status = 'closed',
       close_reason = 'handed_to_support',
       closed_at = coalesce(e.closed_at, now()),
       next_follow_up_date = null
  from _b78_leads l
 where e.id = l.enquiry_id;

-- ---------------------------------------------------------------------------
-- 5. The report gains a "Ticket raised" column.
-- ---------------------------------------------------------------------------
--
-- DROP first: a column added to a `returns table` is a signature change.
--
-- The column is what keeps the report's own assertion true. Group A counts every
-- call by what kind of call it was and group B counts the same calls by how they
-- ended, so total_calls and total_outcomes must be equal on every row — the
-- `mismatch` flag exists precisely to catch an outcome added to the enum and not
-- to the CASE, which is what this would otherwise have been.
drop function public.call_report(date, date, uuid, text);

CREATE OR REPLACE FUNCTION public.call_report(p_from date, p_to date, p_counsellor_id uuid DEFAULT NULL::uuid, p_grain text DEFAULT 'day'::text)
 RETURNS TABLE(grain_key text, grain_label text, is_total boolean, new_calls integer, offers integer, follow_up_1 integer, follow_up_2 integer, follow_up_3 integer, customised integer, tickets integer, stage_new integer, stage_fu1 integer, stage_fu2 integer, stage_fu3 integer, stage_after_sale integer, total_calls integer, out_follow_up integer, out_call_back integer, out_purchased integer, out_competitor integer, out_closed integer, out_after_sale integer, out_ticket_raised integer, total_outcomes integer, customers_purchased integer, purchase_amount numeric, pli_issued integer, mismatch boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_scope uuid;
begin
  if not app.is_staff() then
    raise exception 'not authorised to read the reports' using errcode = '42501';
  end if;

  if app.is_admin() then
    v_scope := p_counsellor_id;
  else
    v_scope := (select auth.uid());
  end if;

  return query
  with
  -- The slot a call sits at (§4.3): the rank of its day among the enquiry's
  -- distinct call days. The window runs over the enquiry's whole history and
  -- the range filter is applied afterwards — filtering first would renumber
  -- the slots inside the range and call a third follow-up a fresh call.
  slotted as (
    select
      c.id,
      c.enquiry_id,
      c.call_date,
      c.called_by,
      c.outcome,
      c.enquiry_type,
      c.is_offer_call,
      -- §70.1. Recorded at logCall time where it is known; null for every call
      -- that predates the column, which the bucket resolution below allows for.
      c.assignment_id,
      c.assignment_bucket,
      -- §77.3. Who the sale belongs to, carried down to the aggregates.
      c.credited_to,
      (dense_rank() over (partition by c.enquiry_id order by c.call_date) - 1) as slot
    from public.calls c
  ),
  -- Every call in range, classified exactly once. The CASE is ordered, so the
  -- first arm that matches wins and no call can land in two columns.
  -- §70.1. The assignment each call was made under, resolved in one place.
  --
  -- Recorded on the call where we know it. Otherwise inferred, in the order the
  -- question is actually asked: the caller's own standing assignment on this
  -- enquiry, then whatever the enquiry was handed out as that day whoever it
  -- went to, then nothing. The middle step alone is what this used to do, and
  -- on its own it was wrong — a lead given to one counsellor as a campaign and
  -- rung by another was filed under a batch the caller was never handed.
  under as (
    select
      s.*,
      coalesce(
        -- §70.1. The bucket as it stood when the call was made. First, because
        -- the assignment row it names is mutable: the desk upserts on
        -- (enquiry_id, date), so a six o'clock re-assignment rewrites the
        -- morning's bucket and would otherwise rewrite the morning's report.
        s.assignment_bucket,
        (select a.bucket from public.assignments a where a.id = s.assignment_id),
        -- §71. The caller's own standing assignment used to sit here, ahead of
        -- the day's. It was a workaround for calls that recorded nothing, and it
        -- guessed badly: it would reach back to a lead's assignment from two days
        -- earlier rather than admit it did not know. The §71 backfill replayed
        -- the audit log onto all 207 calls that had a knowable answer, and on the
        -- 305 calls in the table removing this branch changes not one bucket —
        -- the 98 still unattributed are each the claim their own call created a
        -- millisecond later, which the day's assignment below resolves correctly.
        (select a.bucket from public.assignments a
          where a.enquiry_id = s.enquiry_id and a.date = s.call_date)
      ) as bucket
      from slotted s
     where s.call_date between p_from and p_to
       and (v_scope is null or s.called_by = v_scope)
  ),
  classified as (
    select
      s.id,
      s.called_by,
      s.call_date,
      s.enquiry_id,
      s.outcome,
      s.credited_to,
      case
        -- After-sale work is Tickets whatever it is assigned as.
        when s.enquiry_type = 'after_sale' then 'tickets'
        -- §70.1. The call's own assignment, not merely one that existed that day.
        when s.is_offer_call or s.bucket = 'offer' then 'offers'
        when s.bucket = 'campaign' then 'customised'
        -- Everything else, including calls nobody was assigned, by slot.
        when s.slot = 0 then 'new_calls'
        when s.slot = 1 then 'follow_up_1'
        when s.slot = 2 then 'follow_up_2'
        else 'follow_up_3'
      end as call_type,
      -- §70.2. Where the call sat on the ladder, whatever it was handed out as.
      -- Every call lands in exactly one of these, so the block totals to the
      -- same number as Calls by type without agreeing with it column by column.
      case
        when s.enquiry_type = 'after_sale' then 'stage_after_sale'
        when s.slot = 0 then 'stage_new'
        when s.slot = 1 then 'stage_fu1'
        when s.slot = 2 then 'stage_fu2'
        else 'stage_fu3'
      end as call_stage
    from under s
  ),
  -- The grain key, chosen once so every aggregate below groups the same way.
  keyed as (
    select
      case when p_grain = 'counsellor' then c.called_by::text
           else c.call_date::text end as k,
      -- §77.3. The sale's own key. At the day grain it is the same date either
      -- way; at the counsellor grain it is whoever the sale was credited to,
      -- falling back to the caller when nobody was named.
      case when p_grain = 'counsellor' then coalesce(c.credited_to, c.called_by)::text
           else c.call_date::text end as sale_k,
      c.*
    from classified c
  ),
  -- §77.3. Purchases counted on the sale's key rather than the call's, so a sale
  -- credited elsewhere leaves the caller's purchase count and joins the other
  -- person's. Separate from calls_agg because the two group differently — one
  -- row cannot be in two groups at once.
  sales_agg as (
    select
      sale_k as k,
      grouping(sale_k) = 1 as is_total,
      count(distinct enquiry_id) filter (where outcome = 'purchased')::integer
        as customers_purchased
    from keyed
    group by grouping sets ((sale_k), ())
  ),
  calls_agg as (
    select
      k,
      grouping(k) = 1 as is_total,
      count(*) filter (where call_type = 'new_calls')::integer    as new_calls,
      count(*) filter (where call_type = 'offers')::integer       as offers,
      count(*) filter (where call_type = 'follow_up_1')::integer  as follow_up_1,
      count(*) filter (where call_type = 'follow_up_2')::integer  as follow_up_2,
      count(*) filter (where call_type = 'follow_up_3')::integer  as follow_up_3,
      count(*) filter (where call_type = 'customised')::integer   as customised,
      count(*) filter (where call_type = 'tickets')::integer      as tickets,
      count(*) filter (where call_stage = 'stage_new')::integer   as stage_new,
      count(*) filter (where call_stage = 'stage_fu1')::integer   as stage_fu1,
      count(*) filter (where call_stage = 'stage_fu2')::integer   as stage_fu2,
      count(*) filter (where call_stage = 'stage_fu3')::integer   as stage_fu3,
      count(*) filter (where call_stage = 'stage_after_sale')::integer as stage_after_sale,
      count(*)::integer                                           as total_calls,
      count(*) filter (where outcome = 'follow_up')::integer      as out_follow_up,
      count(*) filter (where outcome = 'call_back')::integer      as out_call_back,
      count(*) filter (where outcome = 'purchased')::integer      as out_purchased,
      count(*) filter (where outcome = 'competitor')::integer     as out_competitor,
      count(*) filter (where outcome in ('closed','not_interested'))::integer         as out_closed,
      count(*) filter (where outcome in ('noted','working','escalated','pending_institute','resolved'))::integer
                                                                  as out_after_sale,
      -- §78. The hand-off to Support, in a column of its own. It is a real call
      -- with a real outcome, so it has to be counted somewhere or total_calls
      -- and total_outcomes stop agreeing — and it is none of the others: the
      -- lead was not followed up, not called back and not closed as a wrong
      -- number, it left counselling.
      count(*) filter (where outcome = 'ticket_raised')::integer   as out_ticket_raised,
      -- §77.3. customers_purchased moved to sales_agg, which groups on the
      -- sale's key rather than the caller's.
      0::integer as unused_purchased
    from keyed
    group by grouping sets ((k), ())
  ),
  -- Amounts are attributed to the call that won them: the purchased call on
  -- the item's won day. §5.8 has credited the day's revenue this way since
  -- Brief 6.
  amounts as (
    select
      -- §77.3. The money follows the sale, not the caller.
      case when p_grain = 'counsellor' then coalesce(c.credited_to, c.called_by)::text
           else c.call_date::text end as k,
      grouping(case when p_grain = 'counsellor' then coalesce(c.credited_to, c.called_by)::text
                    else c.call_date::text end) = 1 as is_total,
      coalesce(sum(i.amount), 0)::numeric as purchase_amount
    from public.enquiry_items i
    join public.calls c
      on c.enquiry_id = i.enquiry_id
     and c.outcome = 'purchased'
     and c.call_date = (i.won_at at time zone 'Asia/Kolkata')::date
    where i.won_at is not null
      and (i.won_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      -- §77.3. A counsellor looking at their own report sees the sales credited
      -- to them, which is what their number is.
      and (v_scope is null or coalesce(c.credited_to, c.called_by) = v_scope)
    group by grouping sets ((1), ())
  ),
  -- PLI: an enquiries row re-graded to A by a person, excluding imports.
  -- Unchanged from migration 0018; only the grouping key differs.
  pli as (
    select
      case when p_grain = 'counsellor' then a.actor_id::text
           else (a.at at time zone 'Asia/Kolkata')::date::text end as k,
      grouping(case when p_grain = 'counsellor' then a.actor_id::text
                    else (a.at at time zone 'Asia/Kolkata')::date::text end) = 1 as is_total,
      count(*)::integer as pli_issued
    from public.audit_log a
    where a.table_name = 'enquiries'
      and a.actor_id is not null
      and a.actor_source <> 'service_role'
      and (a.new_data ->> 'importance') = 'a'
      and (a.action = 'insert' or (a.old_data ->> 'importance') is distinct from 'a')
      and (
        a.action = 'update'
        or not exists (
          select 1 from public.import_rows ir where ir.enquiry_id::text = a.row_pk
        )
      )
      and (a.at at time zone 'Asia/Kolkata')::date between p_from and p_to
      and (v_scope is null or a.actor_id = v_scope)
    group by grouping sets ((1), ())
  ),
  -- Every row the table should show, even the empty ones: a day with no calls
  -- is a fact about the week, and a counsellor with none is a fact about the
  -- team.
  grid as (
    select d::date::text as k, to_char(d, 'YYYY-MM-DD') as label, false as is_total
      from generate_series(p_from, p_to, interval '1 day') d
     where p_grain = 'day'
    union all
    select pr.id::text, coalesce(pr.full_name, '(no name)'), false
      from public.profiles pr
     where p_grain = 'counsellor'
       and pr.is_active
       and (v_scope is null or pr.id = v_scope)
    union all
    select null, 'Total', true
  )
  select
    g.k,
    g.label,
    g.is_total,
    coalesce(ca.new_calls, 0),
    coalesce(ca.offers, 0),
    coalesce(ca.follow_up_1, 0),
    coalesce(ca.follow_up_2, 0),
    coalesce(ca.follow_up_3, 0),
    coalesce(ca.customised, 0),
    coalesce(ca.tickets, 0),
    -- §70.2. Calls by stage, projected next to Calls by type.
    coalesce(ca.stage_new, 0),
    coalesce(ca.stage_fu1, 0),
    coalesce(ca.stage_fu2, 0),
    coalesce(ca.stage_fu3, 0),
    coalesce(ca.stage_after_sale, 0),
    coalesce(ca.total_calls, 0),
    coalesce(ca.out_follow_up, 0),
    coalesce(ca.out_call_back, 0),
    coalesce(ca.out_purchased, 0),
    coalesce(ca.out_competitor, 0),
    coalesce(ca.out_closed, 0),
    coalesce(ca.out_after_sale, 0),
    coalesce(ca.out_ticket_raised, 0),
    coalesce(ca.out_follow_up, 0) + coalesce(ca.out_call_back, 0)
      + coalesce(ca.out_purchased, 0) + coalesce(ca.out_competitor, 0)
      + coalesce(ca.out_closed, 0) + coalesce(ca.out_after_sale, 0)
        + coalesce(ca.out_ticket_raised, 0),
    coalesce(sa.customers_purchased, 0),
    coalesce(am.purchase_amount, 0),
    coalesce(pl.pli_issued, 0),
    -- The assertion. These two count the same calls two ways, so they cannot
    -- differ unless an outcome has been added to the enum without being added
    -- to the CASE above. Carried per row so the screen can say which row.
    coalesce(ca.total_calls, 0) <> (
      coalesce(ca.out_follow_up, 0) + coalesce(ca.out_call_back, 0)
        + coalesce(ca.out_purchased, 0) + coalesce(ca.out_competitor, 0)
        + coalesce(ca.out_closed, 0) + coalesce(ca.out_after_sale, 0)
        + coalesce(ca.out_ticket_raised, 0)
    )
  from grid g
  left join calls_agg ca on ca.is_total = g.is_total
                        and (g.is_total or ca.k = g.k)
  left join sales_agg sa on sa.is_total = g.is_total
                       and (g.is_total or sa.k = g.k)
  left join amounts am on am.is_total = g.is_total
                      and (g.is_total or am.k = g.k)
  left join pli pl on pl.is_total = g.is_total
                  and (g.is_total or pl.k = g.k)
  -- Ordered by what it prints, not by what it groups on: the label is the
  -- date at the day grain and the name at the counsellor grain, and both sort
  -- the way the reader expects. The key would put the team in uuid order.
  order by g.is_total, g.label;
end;
$function$;
grant execute on function public.call_report(date, date, uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
