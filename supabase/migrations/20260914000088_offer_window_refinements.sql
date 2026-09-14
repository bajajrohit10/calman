-- §42. Four refinements to how an offer chooses and keeps its leads.

-- ---------------------------------------------------------------------------
-- 1. How far back an offer reaches
-- ---------------------------------------------------------------------------
--
-- An offer aimed at "everyone who ever asked about FR" is a different thing
-- from one aimed at "everyone who asked in the last month", and until now only
-- the first was expressible. Null keeps that meaning — reach everybody — so
-- every offer that exists today behaves exactly as it did.
--
-- The window is measured from the offer's start, not from today: an offer
-- starting on the 1st with a 30-day look-back means the same set of leads on
-- the 1st as on the 10th, which is what somebody planning a campaign expects.
-- Its upper edge is today, so a lead that arrives while the offer is running
-- is always in.

alter table public.offers
  add column if not exists lookback_days smallint;

alter table public.offers
  drop constraint if exists offers_lookback_days_sane;
alter table public.offers
  add constraint offers_lookback_days_sane
  check (lookback_days is null or (lookback_days >= 0 and lookback_days <= 3650));

comment on column public.offers.lookback_days is
  'How many days before start_date an enquiry may have arrived and still be '
  'reached (§42.1). Null means no limit. The arrival date is the later of '
  'created_at and re_enquired_at, both read in IST.';

-- ---------------------------------------------------------------------------
-- 2. offer_matches honours it
-- ---------------------------------------------------------------------------
--
-- Patched rather than rewritten: this view carries the whole of §18's target
-- logic plus §23.4's already-won exclusion, and retyping it here would be a
-- second copy to keep in step. The look-back is one conjunct on the enquiry.

do $$
declare
  src text := pg_get_viewdef('public.offer_matches'::regclass, true);
  out text;
begin
  if position('lookback_days' in src) > 0 then
    raise notice 'offer_matches already carries the look-back';
    return;
  end if;
  -- The view joins the enquiry as `pe`; the offer is `o`.
  out := replace(
    src,
    'WHERE o.is_active AND',
    'WHERE o.is_active AND (o.lookback_days IS NULL OR GREATEST('
    || '(pe.created_at AT TIME ZONE ''Asia/Kolkata'')::date, '
    || 'COALESCE((pe.re_enquired_at AT TIME ZONE ''Asia/Kolkata'')::date, '
    || '(pe.created_at AT TIME ZONE ''Asia/Kolkata'')::date)) '
    || 'BETWEEN (o.start_date - o.lookback_days) AND app.ist_today()) AND');
  if out = src then
    raise exception 'offer_matches: the WHERE clause was not found';
  end if;
  execute 'create or replace view public.offer_matches as ' ||
          substring(out from position('SELECT' in out));
end $$;

comment on view public.offer_matches is
  'One row per (offer, enquiry item) an offer reaches: §18''s targets, §23.4''s '
  'already-won exclusion, and §42.1''s optional look-back window.';

-- ---------------------------------------------------------------------------
-- 3. The form's live count asks the same question
-- ---------------------------------------------------------------------------
--
-- The count is answered before the offer exists, so it cannot read the row —
-- it is handed the two numbers the form is holding. Both null keeps the old
-- behaviour, which is what every other caller wants.

create or replace function public.offer_match_count(
  p_teachers uuid[],
  p_institutes uuid[],
  p_courses uuid[],
  p_subjects uuid[],
  p_contents uuid[],
  p_lookback smallint default null,
  p_start_date date default null
)
returns integer
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select count(distinct i.enquiry_id)::integer
    from public.enquiry_items i
    join public.live_enquiries e on e.id = i.enquiry_id
    left join public.teachers tch on tch.id = i.teacher_id
   where i.status <> 'won'
     and e.type = 'purchase'
     and (e.status = 'open'
          or (e.status = 'lost' and e.lost_reason in ('max_followups', 'competitor', 'dropped')))
     -- §42.1, said the same way the view says it.
     and (p_lookback is null or p_start_date is null
          or greatest(
               (e.created_at at time zone 'Asia/Kolkata')::date,
               coalesce((e.re_enquired_at at time zone 'Asia/Kolkata')::date,
                        (e.created_at at time zone 'Asia/Kolkata')::date))
             between (p_start_date - p_lookback) and app.ist_today())
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
$$;

-- ---------------------------------------------------------------------------
-- 4. One offer call per lead per offer
-- ---------------------------------------------------------------------------
--
-- An offer is a reminder, and a reminder that keeps arriving after it has been
-- acted on is a nuisance. Once a lead has been rung under an offer it drops
-- out of that offer's list for the rest of the window, and its ordinary
-- follow-up date takes over — the offer call never counted towards the three
-- slots (§23.2), so nothing about its place in the normal list has changed.
--
-- Strictly before the viewed day, not on or before: the day the call is made
-- the lead has to stay where it was, or My Day's Done half would lose the row
-- somebody just finished.
--
-- The call is matched to the offer by date rather than by an id, because that
-- is what the desk showed the counsellor: a lead in two overlapping offers is
-- one row carrying both names, and the call they made was against all of them.

do $$
declare
  src text := pg_get_functiondef('public.recommended_calls'::regproc);
  out text;
begin
  out := regexp_replace(
    src,
    '(from public\.offer_matches om\s*\n\s*where om\.enquiry_id = e\.id\s*\n\s*and t\.d between om\.window_from and om\.end_date\s*\n\s*and om\.item_status <> ''won'')',
    '\1' || E'\n' ||
    '       and not exists (select 1 from public.calls c' || E'\n' ||
    '                        where c.enquiry_id = e.id and c.is_offer_call' || E'\n' ||
    '                          and c.call_date >= om.window_from' || E'\n' ||
    '                          and c.call_date <= om.end_date' || E'\n' ||
    '                          and c.call_date < t.d)');
  if out = src then
    raise exception 'recommended_calls: the offer lateral was not found';
  end if;
  execute out;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The cross-badge a follow-up row needs
-- ---------------------------------------------------------------------------
--
-- A lead that has left an offer's list is still a lead somebody rang about
-- that offer three days ago, and the next person to call it should know. The
-- desk and My Day ask for this in one batch for the rows they are showing,
-- the way §35.3's Edits column asks about calls: the question is about a
-- handful of leads, and a join into every list that might want it would be a
-- fifth lateral on two already-long functions.
--
-- Only offers that are still running, because "called under an offer that
-- ended last month" is history rather than something to act on.

create or replace function public.offer_calls_for(p_enquiry_ids bigint[])
returns table (
  enquiry_id bigint,
  offer_name text,
  called_on date
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select distinct on (c.enquiry_id)
         c.enquiry_id,
         om.offer_name,
         c.call_date
    from public.calls c
    join public.offer_matches om on om.enquiry_id = c.enquiry_id
    join public.offers o on o.id = om.offer_id
   where app.is_staff()
     and c.enquiry_id = any (p_enquiry_ids)
     and c.is_offer_call
     and o.is_active
     and app.ist_today() between om.window_from and om.end_date
     and c.call_date >= om.window_from
     and c.call_date <= om.end_date
   order by c.enquiry_id, c.call_date desc, c.id desc;
$$;

comment on function public.offer_calls_for(bigint[]) is
  'The most recent offer call on each of these leads, for an offer whose '
  'window is still open (§42.4). Drives the "Offer X · called D" badge on the '
  'ordinary follow-up rows.';

grant execute on function public.offer_calls_for(bigint[]) to authenticated;
