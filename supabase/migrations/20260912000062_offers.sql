-- Brief 18: Offers.
--
-- The schema has carried offers since migration 0001 and nothing has ever read
-- them. This wires them up end to end: a place to define one, the rule that
-- decides which leads it is about, the §6 bucket that puts those leads in
-- front of a counsellor while the offer is closing, and the numbers that say
-- afterwards whether it worked.
--
-- Three decisions worth recording, because none of them is forced by the brief
-- and all three are the kind of thing that gets re-litigated later:
--
--  1. **A call back outranks an offer.** §6 lists the buckets in order and
--     offers come second, above fresh and follow-up. A call back comes last on
--     purpose — it is an evening job, and it is a time promised to a person.
--     An offer is a reminder we invented. So the promise keeps its slot and
--     everything else in an offer window becomes an Offer call. Above
--     follow-up the offer bucket has to be: a lead whose next follow-up falls
--     after the offer ends would otherwise never surface while the offer was
--     running, which is the entire point.
--
--  2. **The window is clamped to the offer's own start.** The brief defines it
--     as end_date - reminder_days .. end_date. An offer running 1–5 October
--     with ten reminder days would otherwise start nagging on 21 September,
--     about a discount that does not exist yet. So the window opens at
--     greatest(start_date, end_date - reminder_days) and the form shows the
--     result.
--
--  3. **Targets are per open interest line, not per lead.** "At least one open
--     item that satisfies every dimension" means one line has to match all of
--     them at once. A lead with a Bhanwar Borana line and a separate Books
--     line does not match an offer on "Bhanwar Borana + Books" unless one line
--     is both. Matching across lines would make an offer on a specific
--     teacher-and-format combination mean something nobody intended.

-- ---------------------------------------------------------------------------
-- 1. Institutes join the four target tables (§ design note, Brief 10)
-- ---------------------------------------------------------------------------

create table if not exists public.offer_institutes (
  offer_id uuid not null references public.offers (id) on delete cascade,
  institute_id uuid not null references public.institutes (id),
  primary key (offer_id, institute_id)
);

alter table public.offer_institutes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'offer_institutes'
                    and policyname = 'offer_institutes_select') then
    create policy offer_institutes_select on public.offer_institutes
      for select to authenticated using (app.is_staff());
    create policy offer_institutes_insert on public.offer_institutes
      for insert to authenticated with check (app.is_admin());
    create policy offer_institutes_delete on public.offer_institutes
      for delete to authenticated using (app.is_admin());
  end if;
end $$;

-- The same exception the other four target tables have: an offer's targets are
-- editable, so they are the one thing besides assignments that can be deleted.
grant delete on public.offer_institutes to authenticated;
grant select, insert on public.offer_institutes to authenticated;

-- Offers are edited from one screen and read from every list; the reads are all
-- "which offers cover this lead", so the join tables want the offer side
-- indexed and the target side too.
create index if not exists offer_institutes_institute_idx
  on public.offer_institutes (institute_id);
create index if not exists offer_teachers_teacher_idx
  on public.offer_teachers (teacher_id);
create index if not exists offer_courses_course_idx
  on public.offer_courses (course_id);
create index if not exists offer_subjects_subject_idx
  on public.offer_subjects (subject_id);
create index if not exists offer_contents_content_idx
  on public.offer_contents (content_id);


-- ---------------------------------------------------------------------------
-- 2. Which leads an offer is about
-- ---------------------------------------------------------------------------
--
-- One row per (offer, open interest line that satisfies every dimension the
-- offer specifies). Deliberately *not* distinct and deliberately not
-- aggregated: a plain flat view is one the planner can push a caller's
-- `enquiry_id = ...` straight into, which is how the desk gets away with
-- asking this question once per candidate lead. Callers aggregate.
--
-- security_invoker so the caller's own RLS decides what they can see, matching
-- public.live_enquiries.

create or replace view public.offer_matches with (security_invoker = true) as
select
  o.id   as offer_id,
  o.name as offer_name,
  -- Decision 2 above: never remind about an offer that has not started.
  greatest(o.start_date, o.end_date - o.reminder_days) as window_from,
  o.end_date,
  o.start_date,
  i.enquiry_id,
  i.id as item_id
from public.offers o
join public.enquiry_items i on i.status = 'open'
left join public.teachers tch on tch.id = i.teacher_id
where o.is_active
  -- Teacher and institute are one dimension asked two ways: name the faculty,
  -- or name the body they teach for. A line satisfies it if either list names
  -- it, and anything satisfies it if neither list is used at all. A teacher
  -- with no institute matches no institute-targeted offer, which is the right
  -- default — an offer aimed at a body should not leak to faculty nobody has
  -- placed yet.
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
                   where ocn.offer_id = o.id and ocn.content_id = i.content_id));

comment on view public.offer_matches is
  'One row per offer and matching open interest line (Brief 18). An offer with '
  'no targets in a dimension matches anything in it; teacher and institute are '
  'one dimension satisfied by either. Not distinct on purpose — a flat view '
  'lets the planner push the caller''s enquiry_id down into it.';

grant select on public.offer_matches to authenticated;


-- ---------------------------------------------------------------------------
-- 3. "Matches N open leads today", for the offer form
-- ---------------------------------------------------------------------------
--
-- Takes the targets being typed rather than an offer id, so the count is
-- answerable before the offer is saved. Without it a wrong target is invisible
-- until the day the bucket fires and a counsellor is handed four thousand
-- leads.

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
     and e.status = 'open'
     and e.type = 'purchase'
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
          or i.content_id = any (p_contents));
$function$;

comment on function public.offer_match_count is
  'How many open purchase leads a set of offer targets would reach today '
  '(Brief 18). Takes the targets, not an offer, so the form can answer before '
  'anything is saved. Mirrors public.offer_matches exactly.';

revoke all on function public.offer_match_count from public;
grant execute on function public.offer_match_count to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Offer performance (§7)
-- ---------------------------------------------------------------------------
--
-- A funnel over one set, which is what makes the three numbers comparable:
-- reached is the leads actually handed out under this offer's bucket during
-- its run, called is how many of those got a call in the same window, won is
-- how many of those bought inside it. A lead that bought without ever being
-- handed out is not this offer's doing and is not counted.
--
-- The window is the offer's own start..end. The bucket can only be handed out
-- inside the reminder window anyway, so the wider bound costs nothing and
-- keeps the numbers stable if reminder_days is edited afterwards.

create or replace function public.offer_performance(p_ids uuid[] default null)
returns table (
  offer_id uuid,
  name text,
  start_date date,
  end_date date,
  window_from date,
  reminder_days smallint,
  is_active boolean,
  matches_now integer,
  reached integer,
  called integer,
  won integer,
  won_amount numeric
)
language sql
stable
security invoker
set search_path to ''
as $function$
  with o as (
    select * from public.offers
     where p_ids is null or id = any (p_ids)
  ),
  reached as (
    select o.id as offer_id, a.enquiry_id
      from o
      join public.assignments a
        on a.bucket = 'offer'
       and a.date between o.start_date and o.end_date
      join public.offer_matches om
        on om.offer_id = o.id and om.enquiry_id = a.enquiry_id
     group by 1, 2
  )
  select
    o.id,
    o.name,
    o.start_date,
    o.end_date,
    greatest(o.start_date, o.end_date - o.reminder_days),
    o.reminder_days,
    o.is_active,
    (select count(distinct om.enquiry_id)::integer
       from public.offer_matches om
       join public.live_enquiries e on e.id = om.enquiry_id
      where om.offer_id = o.id and e.status = 'open' and e.type = 'purchase'),
    (select count(*)::integer from reached r where r.offer_id = o.id),
    (select count(*)::integer from reached r
      where r.offer_id = o.id
        and exists (select 1 from public.calls c
                     where c.enquiry_id = r.enquiry_id
                       and c.call_date between o.start_date and o.end_date)),
    (select count(*)::integer from reached r
      where r.offer_id = o.id
        and exists (select 1 from public.enquiry_items it
                     where it.enquiry_id = r.enquiry_id
                       and it.won_at is not null
                       and (it.won_at at time zone 'Asia/Kolkata')::date
                           between o.start_date and o.end_date)),
    coalesce((select sum(it.amount)
                from reached r
                join public.enquiry_items it on it.enquiry_id = r.enquiry_id
               where r.offer_id = o.id
                 and it.won_at is not null
                 and (it.won_at at time zone 'Asia/Kolkata')::date
                     between o.start_date and o.end_date), 0)::numeric
  from o
  order by o.end_date desc, o.name;
$function$;

comment on function public.offer_performance is
  'Reached / called / won for each offer (§7), as a funnel over one set: the '
  'leads handed out under the offer bucket during its run, how many of those '
  'were called in it, and how many bought in it. matches_now is how many open '
  'leads the targets reach today, whatever the dates say.';

revoke all on function public.offer_performance from public;
grant execute on function public.offer_performance to authenticated;



-- ---- recommended_calls -------------------------------------------------
drop function if exists public.recommended_calls;
CREATE FUNCTION public.recommended_calls(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_assignment text DEFAULT NULL::text, p_last_called_by uuid[] DEFAULT NULL::uuid[], p_last_outcomes text[] DEFAULT NULL::text[], p_no_detail text[] DEFAULT NULL::text[], p_offer_ids uuid[] DEFAULT NULL::uuid[], p_bucket text DEFAULT NULL::text)
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, is_overdue boolean, due_date date, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_id uuid, term_name text, source_id uuid, source_name text, product_text text, next_follow_up_date date, created_at timestamp with time zone, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, assigned_to uuid, assigned_to_name text, stage text, last_outcome call_outcome, last_called_by uuid, last_called_by_name text, assigned_at timestamp with time zone, assignment_label text, called_since boolean, offer_names text[], total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_no_detail, '{}'::text[]) as nd
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
    t.d as target_date
  from public.live_enquiries e
  cross join target t
  -- One indexed lookup each, not a correlated subquery per output column.
  left join lateral (
    select a2.counsellor_id, a2.assigned_at, a2.label,
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
  ) off on true
  -- The bucket, decided once. due_date below has to ask the same question, and
  -- two copies of a four-way CASE is how they start disagreeing.
  left join lateral (
    select (case
              -- A call back is a time promised to a person; an offer is a
              -- reminder. The promise wins, and keeps its evening slot.
              when lc.outcome = 'call_back' and e.fresh_call_date is not null
                then 'call_back'
              -- §6 ranks offers above fresh and follow-up alike. Above
              -- follow-up it has to be: a lead whose next follow-up falls
              -- after the offer ends would otherwise never surface while the
              -- offer was running, which is the whole point of the bucket.
              when off.names is not null then 'offer'
              when e.fresh_call_date is null then 'fresh'
              else 'follow_up'
            end)::public.assignment_bucket as bucket
  ) bk on true
  where e.type = coalesce(p_type, 'purchase'::public.enquiry_type)
    and e.status = coalesce(p_status, 'open'::public.enquiry_status)
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
  p.assignment_label, p.called_since, p.offer_names,
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
CREATE FUNCTION public.recommended_facets(p_date date DEFAULT NULL::date, p_include_not_due boolean DEFAULT false, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_institute_id uuid DEFAULT NULL::uuid, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_assignment text DEFAULT NULL::text, p_last_called_by uuid[] DEFAULT NULL::uuid[], p_last_outcomes text[] DEFAULT NULL::text[], p_no_detail text[] DEFAULT NULL::text[], p_offer_ids uuid[] DEFAULT NULL::uuid[], p_bucket text DEFAULT NULL::text)
 RETURNS TABLE(facet text, value_id text, numbers integer, items integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_no_detail, '{}'::text[]) as nd
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
    (e.status = coalesce(p_status, 'open'::public.enquiry_status)) as m_status,
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
    (p_bucket is null or bk.bucket::text = p_bucket) as m_bucket,
    ((p_offer_ids is null or cardinality(p_offer_ids) = 0)
       or off.ids && p_offer_ids) as m_offer,
    off.ids as offer_ids,
    true as _pad
  from public.live_enquiries e
  cross join target t
  left join lateral (
    select a2.counsellor_id,
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
  ) off on true
  left join lateral (
    select (case
              when lc.outcome = 'call_back' and e.fresh_call_date is not null
                then 'call_back'
              when off.names is not null then 'offer'
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
         c.m_content, c.m_institute, c.m_bucket, c.m_offer
    from cand c
    join public.enquiry_items i
      on i.enquiry_id = c.id and i.status = 'open'
    left join public.teachers tch on tch.id = i.teacher_id
)
select 'stage', c.stage, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

union all
select 'teacher', i.teacher_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_course and i.m_subject and i.m_content and i.m_institute
   and i.teacher_id is not null
 group by 2

union all
select 'teacher', '__none__', count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_teacher
 group by 2
union all
select 'course', i.course_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_subject and i.m_content and i.m_institute
   and i.course_id is not null
 group by 2

union all
select 'course', '__none__', count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_subject and c.m_content and c.m_institute and c.n_course
 group by 2
union all
select 'subject', i.subject_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_content and i.m_institute
   and i.subject_id is not null
 group by 2

union all
select 'subject', '__none__', count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_content and c.m_institute and c.n_subject
 group by 2
union all
select 'content', i.content_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_subject and i.m_institute
   and i.content_id is not null
 group by 2

union all
select 'content', '__none__', count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_institute and c.n_content
 group by 2
union all
select 'institute', i.institute_id::text,
       count(distinct i.enquiry_id)::integer, count(*)::integer
  from lines i
 where i.m_offer and i.m_bucket and i.m_status and i.m_couns and i.m_stage and i.m_assignment and i.m_lastby and i.m_lastout and i.m_source and i.m_term and i.m_importance and i.m_teacher and i.m_course and i.m_subject and i.m_content
   and i.institute_id is not null
 group by 2

union all
select 'institute', '__none__', count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.n_institute
 group by 2

union all
select 'term', c.term_id::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.term_id is not null
 group by 2
union all
select 'term', '__none__', count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_term
 group by 2
union all
select 'source', c.source_id::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.source_id is not null
 group by 2
union all
select 'importance', c.importance::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.importance is not null
 group by 2
union all
select 'importance', '__none__', count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute and c.n_importance
 group by 2

union all
select 'counsellor', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null
 group by 2

-- The roster's two numbers for the current list: who called these last, and
-- who is holding them today.
union all
select 'last_called_by', c.last_called_by::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.last_called_by is not null
 group by 2

union all
select 'last_outcome', c.last_outcome::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.last_outcome is not null
 group by 2

union all
select 'assigned_pending', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null and not c.called_since
 group by 2

union all
select 'assigned_done', c.counsellor_id::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
   and c.counsellor_id is not null and c.called_since
 group by 2

union all
select 'status', c.status::text, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

union all
-- One row per offer the current list touches. Counted like every other facet:
-- every filter except this one, so ticking an offer narrows the list without
-- the offer counts collapsing to the leads already chosen.
select 'offer', o::text, count(distinct c.id)::integer, 0
  from cand c
  cross join lateral unnest(c.offer_ids) as o
 where c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute
 group by 2

-- The guard row: every filter applied, so it must equal the list's total.
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_source and c.m_stage and c.m_assignment
   and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute;
$function$;

revoke all on function public.recommended_facets from public;
grant execute on function public.recommended_facets to authenticated;



-- ---- my_day ------------------------------------------------------------
drop function if exists public.my_day;
CREATE FUNCTION public.my_day(p_date date DEFAULT NULL::date, p_counsellor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_name text, product_text text, next_follow_up_date date, is_overdue boolean, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, called_today boolean, last_call_at timestamp with time zone, last_outcome call_outcome, re_enquired_today boolean, assigned_at timestamp with time zone, assignment_label text, offer_names text[])
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
  off.names
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
  select array_agg(distinct om.offer_name order by om.offer_name) as names
    from public.offer_matches om
   where m.bucket = 'offer'
     and om.enquiry_id = e.id
     and t.d between om.window_from and om.end_date
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

