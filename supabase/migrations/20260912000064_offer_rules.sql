-- Brief 23: what an offer call is, and what it is allowed to do.
--
-- Brief 18 put offer leads in front of counsellors. This decides what happens
-- when one is actually called, and it comes down to a single idea: an offer
-- call is not a follow-up. We decided to run the offer; the lead did not ask
-- us to ring. So it cannot spend one of the three chances §4.3 gives a lead,
-- and it cannot be the call that declares a lead exhausted.
--
-- That one idea has consequences in five places, and they are all here.

-- ---------------------------------------------------------------------------
-- 1. New offers remind on the last day only
-- ---------------------------------------------------------------------------
--
-- Five days of reminders turned out to mean five days of the same leads at the
-- top of the desk. The default is now the last day; anybody who wants a run-up
-- types one. Existing offers keep the reminder_days they were created with —
-- a default is not a migration.

alter table public.offers alter column reminder_days set default 0;


-- ---------------------------------------------------------------------------
-- 2. A call knows whether it was an offer call
-- ---------------------------------------------------------------------------
--
-- Stored on the call, not derived from the assignment at read time, because
-- the assignment is a fact about one day and can be moved, relabelled or
-- deleted by the evening. Whether this call was an offer call is a fact about
-- the call, and the slot rule below has to give the same answer next year.

alter table public.calls
  add column if not exists is_offer_call boolean not null default false;

comment on column public.calls.is_offer_call is
  'True when the call was made against an offer assignment (§23.2). Stamped '
  'once by app.calls_before_write() and never recomputed: it is what keeps '
  'the call outside the three-slot rule after the assignment has gone.';

-- The one index the slot count needs: it asks for one enquiry''s ordinary
-- calls, and without this every recompute reads every call on the enquiry to
-- throw most of them away.
create index if not exists calls_enquiry_ordinary_idx
  on public.calls (enquiry_id, call_date)
  where not is_offer_call;

create or replace function app.calls_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_type public.enquiry_type;
begin
  select e.type into parent_type
    from public.enquiries e
   where e.id = new.enquiry_id;

  if parent_type is null then
    raise exception 'enquiry % does not exist', new.enquiry_id;
  end if;

  new.enquiry_type := parent_type;

  -- timezone('Asia/Kolkata', …) is STABLE, not IMMUTABLE, so this cannot be a
  -- GENERATED column. Setting it here avoids declaring a wrapper IMMUTABLE
  -- that isn't — a lie the planner would happily bake into an index.
  new.call_date := (new.called_at at time zone 'Asia/Kolkata')::date;

  new.next_follow_up_date := app.next_working_day(new.next_follow_up_date);

  -- §23.2. Derived here rather than in the application so that every writer of
  -- this table — the panel, an import, an admin correction — gets the same
  -- answer. The caller may assert it instead, and one does: a call logged from
  -- My Day's Offer Calls tab creates its own assignment a moment later, so at
  -- this point there is nothing to look up. An asserted true is never
  -- overruled; an unasserted call is looked up.
  if tg_op = 'INSERT' and not new.is_offer_call then
    new.is_offer_call := exists (
      select 1 from public.assignments a
       where a.enquiry_id = new.enquiry_id
         and a.date = new.call_date
         and a.bucket = 'offer'
    );
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Who an offer is for
-- ---------------------------------------------------------------------------
--
-- Two changes, both about reach. A lost lead is exactly who a discount is for
-- — the ones who said it was too expensive and the ones who went elsewhere —
-- so the status filter moves out of the view and into the callers, which is
-- where §23.4's three-way facet lives.
--
-- And a student who has already bought this faculty is taken out. Not the
-- enquiry: the student. Somebody who bought Bhanwar Borana's Full course in
-- March does not want a discount on Bhanwar Borana in September, and finding
-- that out by ringing them is the expensive way. Teacher and institute only —
-- the same dimension the offer names its faculty by; a course or content
-- target says nothing about who taught it.

create or replace view public.offer_matches with (security_invoker = true) as
select
  o.id   as offer_id,
  o.name as offer_name,
  greatest(o.start_date, o.end_date - o.reminder_days) as window_from,
  o.end_date,
  o.start_date,
  i.enquiry_id,
  i.id as item_id,
  i.status as item_status
from public.offers o
join public.enquiry_items i on true
join public.enquiries pe on pe.id = i.enquiry_id
left join public.teachers tch on tch.id = i.teacher_id
where o.is_active
  and (
    (not exists (select 1 from public.offer_teachers ot where ot.offer_id = o.id)
     and not exists (select 1 from public.offer_institutes oi where oi.offer_id = o.id))
    or exists (select 1 from public.offer_teachers ot
                where ot.offer_id = o.id and ot.teacher_id = i.teacher_id)
    or exists (select 1 from public.offer_institutes oi
                where oi.offer_id = o.id and oi.institute_id = tch.institute_id)
  )
  and (not exists (select 1 from public.offer_courses oc where oc.offer_id = o.id)
       or exists (select 1 from public.offer_courses oc
                   where oc.offer_id = o.id and oc.course_id = i.course_id))
  and (not exists (select 1 from public.offer_subjects os where os.offer_id = o.id)
       or exists (select 1 from public.offer_subjects os
                   where os.offer_id = o.id and os.subject_id = i.subject_id))
  and (not exists (select 1 from public.offer_contents ocn where ocn.offer_id = o.id)
       or exists (select 1 from public.offer_contents ocn
                   where ocn.offer_id = o.id and ocn.content_id = i.content_id))
  -- Already bought this faculty, on any enquiry of theirs (§23.4).
  and not exists (
    select 1
      from public.enquiry_items wi
      join public.enquiries we on we.id = wi.enquiry_id
      left join public.teachers wt on wt.id = wi.teacher_id
     where we.student_id = pe.student_id
       and wi.status = 'won'
       and (exists (select 1 from public.offer_teachers ot
                     where ot.offer_id = o.id and ot.teacher_id = wi.teacher_id)
            or exists (select 1 from public.offer_institutes oi
                        where oi.offer_id = o.id and oi.institute_id = wt.institute_id))
  );

comment on view public.offer_matches is
  'One row per offer and matching interest line (Brief 18, 23). An offer with '
  'no targets in a dimension matches anything in it; teacher and institute are '
  'one dimension satisfied by either. A student who has already won an item '
  'from the offer''s faculty is excluded outright. item_status is carried '
  'rather than filtered: the bucket wants open lines, the performance funnel '
  'wants the won ones too.';

-- The form's count follows the bucket: open leads and the two kinds of lost
-- lead the desk will actually show.
create or replace function public.offer_match_count(
  p_teachers uuid[] default null,
  p_institutes uuid[] default null,
  p_courses uuid[] default null,
  p_subjects uuid[] default null,
  p_contents uuid[] default null
)
returns integer
language sql
stable
security invoker
set search_path to ''
as $function$
  select count(distinct i.enquiry_id)::integer
    from public.enquiry_items i
    join public.live_enquiries e on e.id = i.enquiry_id
    left join public.teachers tch on tch.id = i.teacher_id
   where i.status = 'open'
     and e.type = 'purchase'
     and (e.status = 'open'
          or (e.status = 'lost' and e.lost_reason in ('max_followups', 'competitor')))
     and (
       (coalesce(cardinality(p_teachers), 0) = 0
        and coalesce(cardinality(p_institutes), 0) = 0)
       or i.teacher_id = any (coalesce(p_teachers, '{}'::uuid[]))
       or tch.institute_id = any (coalesce(p_institutes, '{}'::uuid[]))
     )
     and (coalesce(cardinality(p_courses), 0) = 0
          or i.course_id = any (p_courses))
     and (coalesce(cardinality(p_subjects), 0) = 0
          or i.subject_id = any (p_subjects))
     and (coalesce(cardinality(p_contents), 0) = 0
          or i.content_id = any (p_contents))
     and not exists (
       select 1
         from public.enquiry_items wi
         join public.enquiries we on we.id = wi.enquiry_id
         left join public.teachers wt on wt.id = wi.teacher_id
        where we.student_id = e.student_id
          and wi.status = 'won'
          and (wi.teacher_id = any (coalesce(p_teachers, '{}'::uuid[]))
               or wt.institute_id = any (coalesce(p_institutes, '{}'::uuid[])))
     );
$function$;

comment on function public.offer_match_count is
  'How many leads a set of offer targets would reach today (Brief 18, 23) — '
  'open and the two kinds of lost the offer bucket shows, minus the students '
  'who already bought that faculty. Takes the targets, not an offer, so the '
  'form can answer before anything is saved.';

revoke all on function public.offer_match_count from public;
grant execute on function public.offer_match_count to authenticated;


-- ---------------------------------------------------------------------------
-- 5. An offer call that revives a lost lead
-- ---------------------------------------------------------------------------
--
-- A lost enquiry is a finished story and §4.9 keeps it that way: recompute
-- derives status from calls, so logging a live outcome on a lost enquiry would
-- quietly reopen it and lose the record that it was ever lost. §4.8 already
-- says the answer — the student gets a *new* enquiry alongside the old one —
-- and Quick Add has worked that way since Brief 3. This is that, done by the
-- offer instead of by hand.
--
-- Checked against the supersede/reopen machinery before building, as the brief
-- asked: there is no conflict. app.supersede_enquiry only moves an *open*
-- enquiry to closed/superseded and refuses anything else; app.import_re_enquire
-- likewise requires open; recompute only refuses to touch superseded rows.
-- Nothing in either path looks at how many enquiries a student has, and there
-- is no uniqueness constraint that a second one would violate.

create or replace function public.reopen_via_offer(
  p_enquiry_id bigint,
  p_offer_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old public.enquiries%rowtype;
  v_offer public.offers%rowtype;
  v_new bigint;
  v_note text;
begin
  if not app.is_staff() then
    raise exception 'not authorised to reopen an enquiry'
      using errcode = '42501';
  end if;

  select * into old from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id using errcode = 'P0002';
  end if;
  if old.type <> 'purchase' then
    raise exception 'only a purchase enquiry can be reopened by an offer'
      using errcode = '22023';
  end if;
  if old.status <> 'lost' then
    raise exception 'only a lost enquiry is reopened by an offer (this one is %)', old.status
      using errcode = '22023';
  end if;
  if old.archived_at is not null then
    raise exception 'enquiry % is archived', p_enquiry_id using errcode = '22023';
  end if;

  select * into v_offer from public.offers where id = p_offer_id;
  if not found then
    raise exception 'offer % does not exist', p_offer_id using errcode = 'P0002';
  end if;

  v_note := 'Reopened via offer ' || v_offer.name;

  -- The new enquiry starts clean: no calls, so no fresh date and no slots, and
  -- recompute will leave it open until somebody calls it. The grading is
  -- carried because it is what we know about the person, not about the dead
  -- enquiry.
  insert into public.enquiries (
    student_id, type, source_id, product_text, term_id,
    importance, lead_verification, status, created_by
  )
  values (
    old.student_id, 'purchase', old.source_id,
    case when nullif(btrim(coalesce(old.product_text, '')), '') is null
         then v_note
         else old.product_text || E'\n' || v_note end,
    old.term_id, old.importance, old.lead_verification, 'open',
    (select auth.uid())
  )
  returning id into v_new;

  -- Only the lines the offer is actually about. Copying the whole dead
  -- enquiry would put a teacher the student already said no to back on a list
  -- as though it were live interest.
  insert into public.enquiry_items (
    enquiry_id, teacher_id, course_id, subject_id, content_id, status, created_by
  )
  select distinct v_new, i.teacher_id, i.course_id, i.subject_id, i.content_id,
         'open', (select auth.uid())
    from public.enquiry_items i
   where i.enquiry_id = p_enquiry_id
     and exists (
       select 1 from public.offer_matches om
        where om.offer_id = p_offer_id
          and om.item_id = i.id
     );

  insert into public.enquiry_sources (enquiry_id, source_id, note)
  values (v_new, old.source_id, v_note || ' (was #' || p_enquiry_id || ')');

  return v_new;
end;
$$;

comment on function public.reopen_via_offer is
  'A live outcome on an offer call to a lost lead opens a new enquiry for the '
  'student (§23.5, §4.8): the original''s source and term, the grading, and '
  'only the interest lines the offer targets. The lost enquiry is left exactly '
  'as it was — it is the record that the lead was lost.';

revoke all on function public.reopen_via_offer from public;
grant execute on function public.reopen_via_offer to authenticated;



create or replace function app.recompute_enquiry(p_enquiry_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
  v_fresh date;
  v_fresh_slot date;
  v_last_slot date;
  v_slots integer := 0;
  v_last public.calls%rowtype;
  v_priority smallint;
  v_items_total integer := 0;
  v_items_open integer := 0;
  v_items_won integer := 0;
  v_items_competitor integer := 0;
  v_status public.enquiry_status;
  v_lost public.lost_reason;
  v_close public.close_reason;
  v_next date;
begin
  select * into enq
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    return;
  end if;

  -- A superseded enquiry was closed by a human decision in §5.1, not by call
  -- history. Never recompute it back open.
  if enq.status = 'closed' and enq.close_reason = 'superseded' then
    return;
  end if;

  select min(c.call_date), max(c.call_date)
    into v_fresh, v_last_slot
    from public.calls c
   where c.enquiry_id = p_enquiry_id;

  -- A slot is a calendar day AFTER the fresh-call day, so same-day repeat
  -- calls collapse into one and the fresh day itself never counts (§4.3).
  --
  -- Offer calls are outside the rule entirely (§23.2). An offer is a reason to
  -- ring somebody that has nothing to do with how far down the follow-up
  -- ladder they are, and spending a slot on one would mean a lead could be
  -- talked out of the pipeline by an offer we ourselves decided to run. So
  -- both ends of the count skip them: the fresh day the slots are measured
  -- from is the first *ordinary* call, and only ordinary days count after it.
  --
  -- fresh_call_date itself still comes from every call, offer ones included —
  -- it answers "has anybody spoken to this lead", and after an offer call the
  -- answer is yes.
  select min(c.call_date)
    into v_fresh_slot
    from public.calls c
   where c.enquiry_id = p_enquiry_id
     and not c.is_offer_call;

  select count(distinct c.call_date)
    into v_slots
    from public.calls c
   where c.enquiry_id = p_enquiry_id
     and not c.is_offer_call
     and c.call_date > v_fresh_slot;

  select c.* into v_last
    from public.calls c
   where c.enquiry_id = p_enquiry_id
   order by c.call_date desc, c.called_at desc, c.id desc
   limit 1;

  select count(*),
         count(*) filter (where i.status = 'open'),
         count(*) filter (where i.status = 'won'),
         count(*) filter (where i.status = 'competitor')
    into v_items_total, v_items_open, v_items_won, v_items_competitor
    from public.enquiry_items i
   where i.enquiry_id = p_enquiry_id;

  -- Best (lowest) content priority across still-open items, so §6 can sort
  -- the recommended list on enquiries alone rather than joining items.
  select min(ct.priority)
    into v_priority
    from public.enquiry_items i
    join public.contents ct on ct.id = i.content_id
   where i.enquiry_id = p_enquiry_id
     and i.status = 'open';

  if v_last.id is null then
    -- No calls yet: a fresh import or quick-add.
    v_status := 'open';
    v_next := enq.next_follow_up_date;

  elsif enq.type = 'after_sale' then
    -- §10 decision 4. The reminder date is carried, but after-sale enquiries
    -- never enter a §6 bucket — the Tickets screen (§5.11) reads them.
    v_status := case v_last.outcome
                  when 'noted' then 'open'::public.enquiry_status
                  when 'escalated' then 'escalated'::public.enquiry_status
                  when 'resolved' then 'closed'::public.enquiry_status
                end;
    v_next := v_last.next_follow_up_date;

  elsif v_last.outcome = 'closed' then
    v_status := 'closed';
    v_close := 'wrong_number';          -- §4.7, the only import-flagging close
    v_next := null;

  elsif v_last.outcome = 'competitor' then
    v_status := 'lost';
    v_lost := 'competitor';
    v_next := null;

  elsif v_last.outcome = 'purchased' then
    -- §4.5, as corrected by §10 decision 6: "no open items remain" is not
    -- enough to call it won — at least one item has to have been won.
    if v_items_open > 0 then
      v_status := 'open';
      v_next := v_last.next_follow_up_date;
    elsif v_items_won > 0 or v_items_total = 0 then
      v_status := 'won';
      v_next := null;
    elsif v_items_competitor > 0 then
      v_status := 'lost';
      v_lost := 'competitor';
      v_next := null;
    else
      v_status := 'lost';
      v_lost := 'dropped';
      v_next := null;
    end if;

  else
    -- follow_up | call_back
    if v_slots >= 3 then
      v_status := 'lost';
      v_lost := 'max_followups';
      v_next := null;
    else
      v_status := 'open';
      v_next := v_last.next_follow_up_date;
    end if;
  end if;

  update public.enquiries e
     set status = v_status,
         lost_reason = case when v_status = 'lost' then v_lost end,
         close_reason = case when v_status = 'closed' then coalesce(v_close, e.close_reason) end,
         next_follow_up_date = v_next,
         fresh_call_date = v_fresh,
         follow_up_slots_used = v_slots,
         last_slot_date = v_last_slot,
         top_content_priority = v_priority,
         closed_at = case
                       when v_status in ('won', 'lost', 'closed') then coalesce(e.closed_at, now())
                     end
   where e.id = p_enquiry_id;
end;
$$;

-- ---- recommended_calls -------------------------------------------------
drop function if exists public.recommended_calls;
CREATE FUNCTION public.recommended_calls(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_assignment text DEFAULT NULL::text, p_last_called_by uuid[] DEFAULT NULL::uuid[], p_last_outcomes text[] DEFAULT NULL::text[], p_no_detail text[] DEFAULT NULL::text[], p_offer_ids uuid[] DEFAULT NULL::uuid[], p_bucket text DEFAULT NULL::text, p_offer_statuses text[] DEFAULT NULL::text[])
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, is_overdue boolean, due_date date, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_id uuid, term_name text, source_id uuid, source_name text, product_text text, next_follow_up_date date, created_at timestamp with time zone, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, assigned_to uuid, assigned_to_name text, stage text, last_outcome call_outcome, last_called_by uuid, last_called_by_name text, assigned_at timestamp with time zone, assignment_label text, called_since boolean, offer_names text[], offer_ids uuid[], lost_reason lost_reason, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_no_detail, '{}'::text[]) as nd,
         -- All three by default (Brief 23.4): an offer is aimed at people who
         -- did not buy, and the ones who gave up or went elsewhere are most of
         -- them. The facet is there to take them back out again.
         coalesce(nullif(p_offer_statuses, '{}'), array['open','lost_exhausted','lost_competitor']) as os
),
base as (
  select
    e.id as enquiry_id,
    bk.bucket,
    case
      when e.next_follow_up_date is not null and e.next_follow_up_date < t.d
        then true else false
    end as is_overdue,
    case
      when bk.bucket = 'offer' then t.d
      when e.fresh_call_date is null then t.d
      when e.next_follow_up_date is null then null
      else app.next_working_day(greatest(e.next_follow_up_date, t.d))
    end as due_date,
    e.student_id, e.type, e.status, e.importance, e.term_id, e.source_id,
    e.product_text, e.next_follow_up_date, e.created_at,
    e.follow_up_slots_used, e.top_content_priority,
    a.counsellor_id as assigned_to,
    a.assigned_at,
    a.label as assignment_label,
    coalesce(a.called_since, false) as called_since,
    lc.outcome as last_outcome,
    lc.called_by as last_called_by,
    app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome) as stage,
    off.names as offer_names,
    off.ids as offer_ids,
    e.lost_reason,
    t.d as target_date
  from public.live_enquiries e
  cross join target t
  -- One indexed lookup each, not a correlated subquery per output column.
  left join lateral (
    select a2.counsellor_id, a2.assigned_at, a2.label, a2.bucket,
           exists (
             select 1 from public.calls c3
              where c3.enquiry_id = e.id
                and c3.call_date = t.d
                and c3.called_at >= a2.assigned_at
           ) as called_since
      from public.assignments a2
     where a2.enquiry_id = e.id and a2.date = t.d
     limit 1
  ) a on true
  left join lateral (
    select c2.outcome, c2.called_by
      from public.calls c2
     where c2.enquiry_id = e.id
     order by c2.call_date desc, c2.called_at desc, c2.id desc
     limit 1
  ) lc on true
  -- Every offer whose reminder window covers the viewed day and whose targets
  -- this lead's open lines satisfy. A lead in two offers gets both names and
  -- still appears once: this is one row per lead, not one per offer.
  left join lateral (
    select array_agg(distinct om.offer_name order by om.offer_name) as names,
           array_agg(distinct om.offer_id) as ids
      from public.offer_matches om
     where om.enquiry_id = e.id
       and t.d between om.window_from and om.end_date
       and om.item_status = 'open'
  ) off on true
  -- The bucket, decided once. due_date below has to ask the same question, and
  -- two copies of a four-way CASE is how they start disagreeing.
  left join lateral (
    select (case
              -- A call back is a time promised to a person; an offer is a
              -- reminder. The promise wins, and keeps its evening slot.
              -- Open only. A lost lead's last call back is not a live
              -- promise, and leaving it in this arm would hide the lead from
              -- the offer bucket that §23.4 exists to put it in.
              when lc.outcome = 'call_back' and e.fresh_call_date is not null
                   and e.status = 'open'
                then 'call_back'
              -- §6 ranks offers above fresh and follow-up alike. Above
              -- follow-up it has to be: a lead whose next follow-up falls
              -- after the offer ends would otherwise never surface while the
              -- offer was running, which is the whole point of the bucket.
              -- Or because somebody was handed it as one. §23.3: a lead with
              -- an offer assignment for the day must never also turn up as a
              -- follow-up, and the assignment outlives the offer that caused
              -- it — deactivating an offer must not split one day's work into
              -- two rows on two lists.
              when off.names is not null or a.bucket = 'offer' then 'offer'
              when e.fresh_call_date is null then 'fresh'
              else 'follow_up'
            end)::public.assignment_bucket as bucket
  ) bk on true
  where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
    -- §23.4. An offer is the one thing worth ringing a dead lead about, so an
    -- offer lead may be open or lost, and which of the three the desk shows is
    -- a filter. Everything else is open-only as before, and an explicitly
    -- chosen status still wins over all of it.
    and (case
           when bk.bucket = 'offer' and p_status is null then
                (e.status = 'open' and 'open' = any (t.os))
             or (e.status = 'lost' and e.lost_reason = 'max_followups'
                 and 'lost_exhausted' = any (t.os))
             or (e.status = 'lost' and e.lost_reason = 'competitor'
                 and 'lost_competitor' = any (t.os))
           else e.status = coalesce(p_status, 'open'::public.enquiry_status)
         end)
    and (e.created_at at time zone 'Asia/Kolkata')::date <= t.d
    and (p_counsellor_id is null or a.counsellor_id = p_counsellor_id)
    and (case p_assignment
           when 'needs'   then a.counsellor_id is null or a.called_since
           when 'pending' then a.counsellor_id is not null and not a.called_since
           when 'done'    then a.counsellor_id is not null and a.called_since
           else true
         end)
    and ((p_last_called_by is null or cardinality(p_last_called_by) = 0)
         or lc.called_by = any (p_last_called_by))
    and ((p_last_outcomes is null or cardinality(p_last_outcomes) = 0)
         or lc.outcome::text = any (p_last_outcomes))
    and (p_source_id is null or e.source_id = p_source_id)
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
    and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    -- ---- facet predicates, each with its optional "no detail" branch -------
    -- Written as CASE rather than through a helper so the unfiltered case
    -- short-circuits: a function's arguments are always evaluated, which would
    -- mean running all seven exists() per row on a desk with no filters set.
    and (case
           when not ('term' = any (t.nd)) and (p_term_id is null)
             then true
           else (not (p_term_id is null) and e.term_id = p_term_id)
                or ('term' = any (t.nd) and e.term_id is null)
         end)
    and (case
           when not ('importance' = any (t.nd)) and (p_importance is null or cardinality(p_importance) = 0)
             then true
           else (not (p_importance is null or cardinality(p_importance) = 0) and e.importance = any (p_importance))
                or ('importance' = any (t.nd) and e.importance is null)
         end)
    and (case
           when not ('teacher' = any (t.nd)) and (p_teacher_ids is null or cardinality(p_teacher_ids) = 0)
             then true
           else (not (p_teacher_ids is null or cardinality(p_teacher_ids) = 0) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.teacher_id = any (p_teacher_ids)))
                or ('teacher' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.teacher_id is not null))
         end)
    and (case
           when not ('course' = any (t.nd)) and (p_course_id is null)
             then true
           else (not (p_course_id is null) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.course_id = p_course_id))
                or ('course' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.course_id is not null))
         end)
    and (case
           when not ('subject' = any (t.nd)) and (p_subject_id is null)
             then true
           else (not (p_subject_id is null) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.subject_id = p_subject_id))
                or ('subject' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.subject_id is not null))
         end)
    and (case
           when not ('content' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0)
             then true
           else (not (p_content_ids is null or cardinality(p_content_ids) = 0) and exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.content_id = any (p_content_ids)))
                or ('content' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                       where i.enquiry_id = e.id and i.status = 'open'
                         and i.content_id is not null))
         end)
    and (case
           when not ('institute' = any (t.nd)) and (p_institute_id is null)
             then true
           else (not (p_institute_id is null) and exists (select 1 from public.enquiry_items i
                    join public.teachers tch on tch.id = i.teacher_id
                   where i.enquiry_id = e.id and i.status = 'open'
                     and tch.institute_id = p_institute_id))
                or ('institute' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                        join public.teachers tch on tch.id = i.teacher_id
                       where i.enquiry_id = e.id and i.status = 'open'
                         and tch.institute_id is not null))
         end)
    and ((p_stages is null or cardinality(p_stages) = 0)
         or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome)
            = any (p_stages))
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
    -- The Offers preset asks for one bucket; the multi-select asks for leads
    -- matching particular offers. Different questions, and they compose.
    and (p_bucket is null or bk.bucket::text = p_bucket)
    and ((p_offer_ids is null or cardinality(p_offer_ids) = 0)
         or off.ids && p_offer_ids)
),
page as (
  select
    b.*,
    (case b.bucket
       when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
       when 'campaign'  then 4 when 'call_back' then 5
     end)::smallint as bucket_rank,
    count(*) over () as total_count
  from base b
  where p_include_not_due or b.due_date = b.target_date
  order by
    (case b.bucket
       when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
       when 'campaign'  then 4 when 'call_back' then 5 end),
    b.importance nulls last,
    b.top_content_priority nulls last,
    b.next_follow_up_date nulls last,
    b.enquiry_id
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0)
)
select
  p.enquiry_id, p.bucket, p.bucket_rank, p.is_overdue, p.due_date,
  p.student_id, s.mobile, s.name, p.type, p.status, p.importance,
  p.term_id, tm.name, p.source_id, src.name, p.product_text,
  p.next_follow_up_date, p.created_at, p.follow_up_slots_used,
  p.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = p.enquiry_id and i.status = 'open'),
  (select count(*)::integer from public.enquiry_items i
    where i.enquiry_id = p.enquiry_id),
  p.assigned_to, pr.full_name,
  p.stage, p.last_outcome, p.last_called_by, lcp.full_name, p.assigned_at,
  p.assignment_label, p.called_since, p.offer_names, p.offer_ids, p.lost_reason,
  p.total_count
from page p
join public.students s on s.id = p.student_id
left join public.terms tm on tm.id = p.term_id
left join public.sources src on src.id = p.source_id
left join public.profiles pr on pr.id = p.assigned_to
left join public.profiles lcp on lcp.id = p.last_called_by
order by p.bucket_rank, p.importance nulls last,
         p.top_content_priority nulls last, p.next_follow_up_date nulls last,
         p.enquiry_id;
$function$;

revoke all on function public.recommended_calls from public;
grant execute on function public.recommended_calls to authenticated;




-- ---- recommended_facets ------------------------------------------------
drop function if exists public.recommended_facets;
CREATE FUNCTION public.recommended_facets(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_assignment text DEFAULT NULL::text, p_last_called_by uuid[] DEFAULT NULL::uuid[], p_last_outcomes text[] DEFAULT NULL::text[], p_no_detail text[] DEFAULT NULL::text[], p_offer_ids uuid[] DEFAULT NULL::uuid[], p_bucket text DEFAULT NULL::text, p_offer_statuses text[] DEFAULT NULL::text[])
 RETURNS TABLE(facet text, value_id text, numbers integer, items integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_no_detail, '{}'::text[]) as nd,
         coalesce(nullif(p_offer_statuses, '{}'), array['open','lost_exhausted','lost_competitor']) as os
),
-- Every base predicate applied; each facet's own predicate carried as a flag,
-- so a facet can be counted with every filter except its own (§5.5).
cand as materialized (
  select
    e.id,
    e.term_id, e.source_id, e.importance, e.status,
    a.counsellor_id,
    coalesce(a.called_since, false) as called_since,
    lc.called_by as last_called_by,
    lc.outcome   as last_outcome,
    app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome) as stage,
    -- The list's status rule, restated here because the guard row has to
    -- equal the list. An offer lead may be lost; everything else is open-only.
    (case
       when bk.bucket = 'offer' and p_status is null then e.status in ('open','lost')
       else e.status = coalesce(p_status, 'open'::public.enquiry_status)
     end) as m_status,
    (case
       when bk.bucket = 'offer' and p_status is null then
            (e.status = 'open' and 'open' = any (t.os))
         or (e.status = 'lost' and e.lost_reason = 'max_followups'
             and 'lost_exhausted' = any (t.os))
         or (e.status = 'lost' and e.lost_reason = 'competitor'
             and 'lost_competitor' = any (t.os))
       else true
     end) as m_ostatus,
    (case
       when e.status = 'open' then 'open'
       when e.status = 'lost' and e.lost_reason = 'max_followups' then 'lost_exhausted'
       when e.status = 'lost' and e.lost_reason = 'competitor' then 'lost_competitor'
     end) as offer_status,
    (p_counsellor_id is null or a.counsellor_id = p_counsellor_id) as m_couns,
    (p_source_id is null or e.source_id = p_source_id) as m_source,
    ((p_stages is null or cardinality(p_stages) = 0)
       or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome)
          = any (p_stages)) as m_stage,
    (case p_assignment
       when 'needs'   then a.counsellor_id is null or a.called_since
       when 'pending' then a.counsellor_id is not null and not a.called_since
       when 'done'    then a.counsellor_id is not null and a.called_since
       else true
     end) as m_assignment,
    ((p_last_called_by is null or cardinality(p_last_called_by) = 0)
       or lc.called_by = any (p_last_called_by)) as m_lastby,
    ((p_last_outcomes is null or cardinality(p_last_outcomes) = 0)
       or lc.outcome::text = any (p_last_outcomes)) as m_lastout,
    (case
       when not ('term' = any (t.nd)) and (p_term_id is null) then true
       else (not (p_term_id is null) and e.term_id = p_term_id)
            or ('term' = any (t.nd) and e.term_id is null)
     end) as m_term,
    (case
       when not ('importance' = any (t.nd)) and (p_importance is null or cardinality(p_importance) = 0) then true
       else (not (p_importance is null or cardinality(p_importance) = 0) and e.importance = any (p_importance))
            or ('importance' = any (t.nd) and e.importance is null)
     end) as m_importance,
    (case
       when not ('teacher' = any (t.nd)) and (p_teacher_ids is null or cardinality(p_teacher_ids) = 0) then true
       else (not (p_teacher_ids is null or cardinality(p_teacher_ids) = 0) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.teacher_id = any (p_teacher_ids)))
            or ('teacher' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.teacher_id is not null))
     end) as m_teacher,
    (case
       when not ('course' = any (t.nd)) and (p_course_id is null) then true
       else (not (p_course_id is null) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.course_id = p_course_id))
            or ('course' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.course_id is not null))
     end) as m_course,
    (case
       when not ('subject' = any (t.nd)) and (p_subject_id is null) then true
       else (not (p_subject_id is null) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.subject_id = p_subject_id))
            or ('subject' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.subject_id is not null))
     end) as m_subject,
    (case
       when not ('content' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0) then true
       else (not (p_content_ids is null or cardinality(p_content_ids) = 0) and exists (select 1 from public.enquiry_items i
               where i.enquiry_id = e.id and i.status = 'open'
                 and i.content_id = any (p_content_ids)))
            or ('content' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.content_id is not null))
     end) as m_content,
    (case
       when not ('institute' = any (t.nd)) and (p_institute_id is null) then true
       else (not (p_institute_id is null) and exists (select 1 from public.enquiry_items i
                join public.teachers tch on tch.id = i.teacher_id
               where i.enquiry_id = e.id and i.status = 'open'
                 and tch.institute_id = p_institute_id))
            or ('institute' = any (t.nd) and not exists (select 1 from public.enquiry_items i
                    join public.teachers tch on tch.id = i.teacher_id
                   where i.enquiry_id = e.id and i.status = 'open'
                     and tch.institute_id is not null))
     end) as m_institute,
    (e.term_id is null) as n_term,
    (e.importance is null) as n_importance,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.teacher_id is not null)) as n_teacher,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.course_id is not null)) as n_course,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.subject_id is not null)) as n_subject,
    (not exists (select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.status = 'open'
                     and i.content_id is not null)) as n_content,
    (not exists (select 1 from public.enquiry_items i
                    join public.teachers tch on tch.id = i.teacher_id
                   where i.enquiry_id = e.id and i.status = 'open'
                     and tch.institute_id is not null)) as n_institute,
    bk.bucket,
    (p_bucket is null or bk.bucket::text = p_bucket) as m_bucket,
    ((p_offer_ids is null or cardinality(p_offer_ids) = 0)
       or off.ids && p_offer_ids) as m_offer,
    off.ids as offer_ids,
    true as _pad
  from public.live_enquiries e
  cross join target t
  left join lateral (
    select a2.counsellor_id, a2.bucket,
           exists (
             select 1 from public.calls c3
              where c3.enquiry_id = e.id
                and c3.call_date = t.d
                and c3.called_at >= a2.assigned_at
           ) as called_since
      from public.assignments a2
     where a2.enquiry_id = e.id and a2.date = t.d
     limit 1
  ) a on true
  left join lateral (
    select c2.outcome, c2.called_by
      from public.calls c2
     where c2.enquiry_id = e.id
     order by c2.call_date desc, c2.called_at desc, c2.id desc
     limit 1
  ) lc on true
  -- Copied from recommended_calls deliberately and kept identical: the facets
  -- exist to count the list, and the moment the two derive a bucket
  -- differently the guard row stops matching and the desk shows no counts.
  left join lateral (
    select array_agg(distinct om.offer_name order by om.offer_name) as names,
           array_agg(distinct om.offer_id) as ids
      from public.offer_matches om
     where om.enquiry_id = e.id
       and t.d between om.window_from and om.end_date
       and om.item_status = 'open'
  ) off on true
  left join lateral (
    select (case
              when lc.outcome = 'call_back' and e.fresh_call_date is not null
                   and e.status = 'open'
                then 'call_back'
              when off.names is not null or a.bucket = 'offer' then 'offer'
              when e.fresh_call_date is null then 'fresh'
              else 'follow_up'
            end)::public.assignment_bucket as bucket
  ) bk on true
  where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
    and (e.created_at at time zone 'Asia/Kolkata')::date <= t.d
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
    and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
    and (
      p_include_not_due
      or (case
            when bk.bucket = 'offer' then t.d
            when e.fresh_call_date is null then t.d
            when e.next_follow_up_date is null then null
            else app.next_working_day(greatest(e.next_follow_up_date, t.d))
          end) = t.d
    )
),
-- The open lines of the candidate set, carrying the flags with them. Joining
-- two materialized CTEs gives the planner statistics on neither side; measured
-- in Brief 8 at 4.5M rows removed by join filter, per item facet.
lines as materialized (
  select i.enquiry_id, i.teacher_id, i.course_id, i.subject_id, i.content_id,
         tch.institute_id,
         c.m_status, c.m_couns, c.m_source, c.m_stage, c.m_assignment,
         c.m_lastby, c.m_lastout,
         c.m_term, c.m_importance, c.m_teacher, c.m_course, c.m_subject,
         c.m_content, c.m_institute, c.m_bucket, c.m_offer, c.m_ostatus
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
    left join public.teachers tch on tch.id = i.teacher_id
)
select 'stage', c.stage, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

union all
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_ostatus and i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_course and i.m_subject and i.m_content and i.m_institute
   and i.teacher_id is not null
 group by 2

union all
select 'teacher', '__none__', count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_teacher
 group by 2
union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_ostatus and i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_subject and i.m_content and i.m_institute
   and i.course_id is not null
 group by 2

union all
select 'course', '__none__', count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_subject and c.m_content and c.m_institute and c.n_course
 group by 2
union all
select 'subject', i.subject_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_ostatus and i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_content and i.m_institute
   and i.subject_id is not null
 group by 2

union all
select 'subject', '__none__', count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_content and c.m_institute and c.n_subject
 group by 2
union all
select 'content', i.content_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_ostatus and i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_subject and i.m_institute
   and i.content_id is not null
 group by 2

union all
select 'content', '__none__', count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_institute and c.n_content
 group by 2
union all
select 'institute', i.institute_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_ostatus and i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_subject and i.m_content
   and i.institute_id is not null
 group by 2

union all
select 'institute', '__none__', count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.n_institute
 group by 2

union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.term_id is not null
 group by 2
union all
select 'term', '__none__', count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_term
 group by 2
union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.source_id is not null
 group by 2
union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.importance is not null
 group by 2
union all
select 'importance', '__none__', count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_importance
 group by 2

union all
select 'counsellor', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null
 group by 2

-- The roster's two numbers for the current list: who called these last, and
-- who is holding them today.
union all
select 'last_called_by', c.last_called_by::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.last_called_by is not null
 group by 2

union all
select 'last_outcome', c.last_outcome::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.last_outcome is not null
 group by 2

union all
select 'assigned_pending', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null and not c.called_since
 group by 2

union all
select 'assigned_done', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null and c.called_since
 group by 2

union all
select 'status', c.status::text, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

union all
-- One row per offer the current list touches. Counted like every other facet:
-- every filter except this one, so ticking an offer narrows the list without
-- the offer counts collapsing to the leads already chosen.
select 'offer', o::text, count(distinct c.id)::integer, 0
  from cand c
  cross join lateral unnest(c.offer_ids) as o
 where c.m_ostatus and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

union all
-- Open / Lost – exhausted / Lost – competitor, for the offer view's own
-- filter. Only the offer bucket has these three states to choose between, so
-- the rows are restricted to it rather than counted over the whole list. Its
-- own filter is left out, like every other facet's.
select 'offer_status', c.offer_status, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.bucket = 'offer' and c.offer_status is not null
 group by 2

-- The guard row: every filter applied, so it must equal the list's total.
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute;
$function$;

revoke all on function public.recommended_facets from public;
grant execute on function public.recommended_facets to authenticated;




-- ---- my_day ------------------------------------------------------------
drop function if exists public.my_day;
CREATE FUNCTION public.my_day(p_date date DEFAULT NULL::date, p_counsellor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_name text, product_text text, next_follow_up_date date, is_overdue boolean, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, called_today boolean, last_call_at timestamp with time zone, last_outcome call_outcome, re_enquired_today boolean, assigned_at timestamp with time zone, assignment_label text, offer_names text[], offer_ids uuid[], lost_reason lost_reason)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select
    coalesce(p_date, app.ist_today()) as d,
    coalesce(p_counsellor_id, (select auth.uid())) as who
),
mine as (
  select a.enquiry_id, a.bucket, a.assigned_at, a.label
    from public.assignments a
    cross join target t
   where a.date = t.d
     and a.counsellor_id = t.who
),
-- A call on the viewed day, made after the lead was handed over. Both halves
-- matter: the date keeps a historical view honest, assigned_at is what makes a
-- re-assignment reset the row to Pending.
done_call as (
  select c.enquiry_id, max(c.called_at) as last_call_at
    from public.calls c
    join mine m on m.enquiry_id = c.enquiry_id
    cross join target t
   where c.call_date = t.d
     and c.called_at >= m.assigned_at
   group by c.enquiry_id
)
select
  e.id,
  m.bucket,
  (case m.bucket
     when 'follow_up' then 1
     when 'offer'     then 2
     when 'fresh'     then 3
     when 'campaign'  then 4
     when 'call_back' then 5
   end)::smallint as bucket_rank,
  e.student_id,
  s.mobile,
  s.name,
  e.type,
  e.status,
  e.importance,
  tm.name,
  e.product_text,
  e.next_follow_up_date,
  (e.next_follow_up_date is not null and e.next_follow_up_date < t.d) as is_overdue,
  e.follow_up_slots_used,
  e.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = e.id and i.status = 'open') as teacher_names,
  (select count(*)::integer from public.enquiry_items i
    where i.enquiry_id = e.id) as item_count,
  (dc.enquiry_id is not null) as called_today,
  dc.last_call_at,
  (select c.outcome
     from public.calls c
    where c.enquiry_id = e.id
    order by c.call_date desc, c.called_at desc, c.id desc
    limit 1) as last_outcome,
  (e.re_enquired_at is not null and e.re_enquired_at = t.d) as re_enquired_today,
  m.assigned_at,
  m.label,
  off.names,
  off.ids,
  e.lost_reason
from mine m
join public.live_enquiries e on e.id = m.enquiry_id
join public.students s on s.id = e.student_id
cross join target t
left join public.terms tm on tm.id = e.term_id
left join done_call dc on dc.enquiry_id = e.id
-- Which offer put this on the list. Recomputed for the viewed day rather than
-- stamped on the assignment: the bucket is already recorded there, and a name
-- copied at assignment time would go stale the moment the offer was renamed.
left join lateral (
  select array_agg(distinct om.offer_name order by om.offer_name) as names,
         array_agg(distinct om.offer_id) as ids
    from public.offer_matches om
   where m.bucket = 'offer'
     and om.enquiry_id = e.id
     and t.d between om.window_from and om.end_date
       and om.item_status = 'open'
) off on true
where e.type = 'purchase'
order by
  (case m.bucket
     when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
     when 'campaign'  then 4 when 'call_back' then 5 end),
  e.importance nulls last,
  e.top_content_priority nulls last,
  e.next_follow_up_date nulls last,
  e.id;
$function$;

revoke all on function public.my_day from public;
grant execute on function public.my_day to authenticated;




-- ---------------------------------------------------------------------------
-- Reports keep counting offer calls under Offers (§23.2)
-- ---------------------------------------------------------------------------
--
-- §5.8 classified a call by the assignment on its day. That still works, but
-- the call now carries the answer itself, and the flag is the more durable of
-- the two: the assignment can be moved or deleted, the stamp cannot. So the
-- flag is asked first and the assignment stays as the fallback for the calls
-- logged before this migration existed.

do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'call_report';

  if src is null then
    raise exception 'public.call_report is not defined';
  end if;

  patched := regexp_replace(
    src,
    'when a\.bucket = ''offer''\s+then ''offers''',
    'when s.is_offer_call or a.bucket = ''offer'' then ''offers''',
    'g');

  if patched = src then
    raise exception 'call_report: the offers arm was not found, nothing patched';
  end if;

  -- slotted feeds classified, so the flag has to be carried through it.
  patched := regexp_replace(
    patched,
    '(\s+)c\.enquiry_type,(\s+)\(dense_rank\(\)',
    E'\\1c.enquiry_type,\\1c.is_offer_call,\\2(dense_rank()',
    'g');

  if patched not like '%c.is_offer_call%' then
    raise exception 'call_report: slotted was not given is_offer_call';
  end if;

  execute patched;
end $$;
