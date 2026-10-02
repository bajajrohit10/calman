-- §79. Working ahead: follow-ups counted from the day the lead was due, and a
-- closed day that was worked anyway.

-- ---------------------------------------------------------------------------
-- 1. The follow-up calendar, anchored on the day the lead was due.
-- ---------------------------------------------------------------------------
--
-- A counsellor doing tomorrow's list tonight, or clearing a holiday's work the
-- day before, was being offered follow-up dates counted from today. On a lead
-- due the 3rd, called on the 2nd, "+3 days" meant three days from the 2nd — so
-- the ladder ran a day early and kept running early, and every lead touched
-- ahead of its date drifted.
--
-- The anchor is the later of today and the day the lead was already due, which
-- leaves every ordinary call exactly as it was: when the date is today or past,
-- `greatest` returns today and this function answers what working_day_info
-- always answered.
--
-- Purchase leads only. An after-sale ticket's date is a reminder rather than a
-- rung on a ladder, and §65.4 deliberately defaults it from today; a ticket read
-- here returns a null scheduled date and so anchors on today like anything else.
--
-- The arithmetic stays in SQL for the §54.2 reason: the chips a counsellor
-- clicks and the trigger that snaps the saved date have to agree about a Sunday,
-- and a second implementation in TypeScript is how they would come to disagree.
--
-- Deliberately not SECURITY DEFINER. It reads one enquiry row, and RLS deciding
-- what comes back is the behaviour we want: an enquiry the viewer cannot see
-- yields no scheduled date, and the answer falls back to today.
create or replace function public.follow_up_calendar(
  p_enquiry_id bigint    default null,
  p_offsets    integer[] default array[1, 3, 7]
)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with a as (
    select app.ist_today() as today,
           (select e.next_follow_up_date
              from public.enquiries e
             where e.id = p_enquiry_id
               and e.type = 'purchase') as scheduled
  ),
  anchored as (
    select a.today,
           a.scheduled,
           greatest(a.today, coalesce(a.scheduled, a.today)) as from_date,
           coalesce(a.scheduled, a.today) > a.today as early
      from a
  )
  select jsonb_build_object(
    'from', n.from_date,
    -- What the lead was already due, so the hint can name it.
    'scheduled', n.scheduled,
    'calledEarly', n.early,
    'offsets', (
      select coalesce(jsonb_object_agg(o::text,
               app.add_working_days(n.from_date, o)), '{}'::jsonb)
        from unnest(coalesce(p_offsets, '{}'::integer[])) o
    ),
    -- add_working_days(d, 1) is the next working day strictly after d, which is
    -- what working_day_info's own nextWorkingDay already resolves to. Said once
    -- here so the default and the first chip cannot disagree.
    'nextWorkingDay', app.add_working_days(n.from_date, 1),
    'closed', (
      -- From today rather than from the anchor: the counsellor can type any
      -- date, and the window has to reach past the furthest chip the anchor
      -- produces, which is why it runs to the anchor and not to today + 45.
      select coalesce(jsonb_object_agg(g::date::text, jsonb_build_object(
               'reason', case when extract(isodow from g::date) = 7
                              then 'sunday' else 'holiday' end,
               'name', (select h.name from public.holidays h
                         where h.date = g::date
                           and h.is_active and not h.is_working_override)
             )), '{}'::jsonb)
        from generate_series(n.today, n.from_date + 45, interval '1 day') g
       where not app.is_working_day(g::date)
    )
  )
    from anchored n;
$function$;

grant execute on function public.follow_up_calendar(bigint, integer[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. A closed day can be asked about twice, because there are two questions.
-- ---------------------------------------------------------------------------
--
-- calendar_nudges was keyed on the date alone, which was right while there was
-- only one question: "will the team work this closed day?", asked before it.
-- §79 adds a second, asked after: "the team *did* work it — should the calendar
-- say so?" Those are different questions with different answers, and 2 Oct 2026
-- is the case that proves it: the forward question was answered No, and then 125
-- calls were logged on it anyway. Keyed on the date alone, the second question
-- could never be asked.
alter table public.calendar_nudges
  add column kind text not null default 'planned';

alter table public.calendar_nudges
  add constraint calendar_nudges_kind_check check (kind in ('planned', 'worked'));

alter table public.calendar_nudges drop constraint calendar_nudges_pkey;
alter table public.calendar_nudges add primary key (date, kind);

-- ---------------------------------------------------------------------------
-- 3. The nudge gains the backward-looking question.
-- ---------------------------------------------------------------------------
create or replace function public.pending_calendar_nudge()
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with today as (select app.ist_today() as d),
  candidates as (
    -- The next Sunday, visible from the Thursday before it. isodow 4 = Thu.
    select (t.d + ((7 - extract(isodow from t.d)::integer) % 7))::date as date,
           'sunday'::text as kind,
           null::text as name,
           'planned'::text as answer_kind,
           null::bigint as calls
      from today t
     where extract(isodow from t.d) between 4 and 7
    union all
    -- A listed closed day, from three days before it.
    select h.date, 'holiday'::text, h.name, 'planned'::text, null::bigint
      from public.holidays h, today t
     where h.is_active and not h.is_working_override
       and h.date between t.d and t.d + 3
    union all
    -- §79. A closed day somebody worked. Asked for the week behind us as well as
    -- today, because the calls land before anybody looks at My Day and a day's
    -- work recorded against a day the calendar calls shut is worth correcting
    -- after the fact. Bounded at a week: an unanswered question about a holiday
    -- last quarter is noise, not a decision anybody is still making.
    select h.date, 'worked'::text, h.name, 'worked'::text,
           (select count(*) from public.calls c where c.call_date = h.date)
      from public.holidays h, today t
     where h.is_active and not h.is_working_override
       and h.date between t.d - 7 and t.d
       and exists (select 1 from public.calls c where c.call_date = h.date)
  )
  select coalesce(
    (select jsonb_build_object('date', c.date, 'kind', c.kind, 'name', c.name,
                               'answerKind', c.answer_kind, 'calls', c.calls)
       from candidates c
      -- Per question, not per date: answering the forward one does not answer
      -- the backward one. This is the whole point of the key change above.
      where not exists (
              select 1 from public.calendar_nudges n
               where n.date = c.date and n.kind = c.answer_kind)
        -- A day already marked working has been answered by other means.
        and not exists (
          select 1 from public.holidays h
           where h.date = c.date and h.is_active and h.is_working_override)
      -- §79. The day that was actually worked comes first: it describes
      -- something that has already happened, so it is the more answerable of the
      -- two, and on a closed day being worked today both questions match.
      order by case when c.kind = 'worked' then 0 else 1 end, c.date
      limit 1),
    'null'::jsonb);
$function$;

notify pgrst, 'reload schema';
