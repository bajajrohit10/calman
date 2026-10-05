-- §83. One basis for every figure: a lead is closed or it is open.
--
-- §81 and §82 counted outcomes without ever saying what the denominator was, so
-- "conversion" was purchases over *all* leads in the window — which falls every
-- time a good week brings in leads nobody has finished working yet. The rate a
-- manager wants is purchases over decided business, and that needs the open/closed
-- split to exist in one place rather than be re-derived per card.
--
-- Three things this file settles, each of which changes a number on screen:
--
-- 1. `closed` is defined once, in app.analytics_leads, as the brief sets it:
--    status in (won, lost) or close_reason = wrong_number. Everything else is
--    open. Bookkeeping — handed to Support, superseded — is excluded before this
--    question is asked, exactly as before.
--
--    Written null-safe. `close_reason = 'wrong_number'` is NULL on every open
--    lead, and `status in (...) or NULL` is NULL, not false — so the bare
--    expression classified all 208 open leads as neither open nor closed. Same
--    trap as §73's tab_matches, found the same way: a count came back zero that
--    could not be zero.
--
-- 2. Purchased, on the closed basis, is a lead whose own outcome is won —
--    status = 'won' — and not "a lead with a won line on it".
--
--    The two differ by five leads in the current window: 115 leads carry a won
--    line, 110 are themselves won, and the other five are open or lost leads with
--    one line sold and others still in play. Counting those five as purchases put
--    them in the numerator without being in the closed denominator, and the five
--    shares summed to 101.5%. The brief requires them to sum to 100% and asks for
--    a tooltip that proves it, so the decomposition wins: 110 + 38 + 87 + 91 + 14
--    = 340 = closed, exactly.
--
--    Revenue is unaffected and still sums won lines wherever they sit, so the
--    page does carry money from leads it does not count as purchases. The footer
--    says so rather than leaving the two to be compared silently.
--
-- 3. Open leads carry the rung they are waiting on. app.analytics_leads returns
--    follow_up_slots_used, the follow-up date and the arrival day, so the open
--    basis can be built without every table re-joining enquiries.
--
--    The rung is named the way My Day names it: slots_used = 0 means the *first*
--    follow-up is the one now due. So the three columns are slots 0, 1 and 2, and
--    they partition the open set exactly — 112 + 40 + 56 = 208 — because a lead
--    that exhausts its third follow-up becomes lost and leaves the open side.

drop function if exists public.analytics_scope(date, date, uuid, uuid, uuid, uuid, uuid);
drop function if exists public.analytics_by_teacher(date, date, uuid, uuid, uuid, uuid, uuid);
drop function if exists public.analytics_by_institute(date, date, uuid, uuid, uuid, uuid, uuid);
drop function if exists public.analytics_by_course(date, date, uuid, uuid, uuid, uuid, uuid);
drop function if exists app.analytics_totals(date, date, uuid, uuid, uuid, uuid, uuid);
drop function if exists app.analytics_leads(date, date, uuid, uuid, uuid, uuid, uuid);

create or replace function app.analytics_leads(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null
)
returns table (
  enquiry_id   bigint,
  status       public.enquiry_status,
  lost_reason  public.lost_reason,
  close_reason public.close_reason,
  term_id      uuid,
  product_text text,
  called       boolean,
  /** §83.1. The one basis. Null-safe; see the note at the top of this file. */
  closed       boolean,
  /** The rung an open lead is waiting on: 0 = its first follow-up is due. */
  slots        smallint,
  due          date,
  created_on   date
)
language sql
stable
security definer
set search_path to ''
as $function$
  select e.id, e.status, e.lost_reason, e.close_reason, e.term_id, e.product_text,
         exists (select 1 from public.calls c where c.enquiry_id = e.id),
         coalesce(e.status in ('won', 'lost') or e.close_reason = 'wrong_number', false),
         coalesce(e.follow_up_slots_used, 0::smallint),
         e.next_follow_up_date,
         (e.created_at at time zone 'Asia/Kolkata')::date
    from public.enquiries e
   where e.type = 'purchase'
     and e.archived_at is null
     and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     and not (e.status = 'closed'
              and e.close_reason in ('handed_to_support', 'superseded'))
     and (p_source_id is null or e.source_id = p_source_id)
     and (p_term_id is null or e.term_id = p_term_id)
     and (p_course_id is null or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.course_id = p_course_id))
     and (p_subject_id is null or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.subject_id = p_subject_id))
     and (p_counsellor_id is null or exists (
           select 1 from public.calls c
            where c.enquiry_id = e.id and c.called_by = p_counsellor_id));
$function$;

grant execute on function app.analytics_leads(date, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The strip's figures, for one window.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_totals(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id, p_term_id)
  ),
  wonitem as (
    select i.* from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.status = 'won'
  )
  select jsonb_build_object(
    'leads',              (select count(*) from cur),
    'open',               (select count(*) from cur where not closed),
    'closed',             (select count(*) from cur where closed),
    -- §83.1. The lead's own outcome, so the five shares below sum to `closed`.
    'purchased',          (select count(*) from cur where status = 'won'),
    'lostCompetitor',     (select count(*) from cur where status = 'lost' and lost_reason = 'competitor'),
    'lostNotInterested',  (select count(*) from cur where status = 'lost' and lost_reason = 'not_interested'),
    'lostNoResponse',     (select count(*) from cur where status = 'lost' and lost_reason = 'max_followups'),
    'lostWrongNumber',    (select count(*) from cur where coalesce(close_reason = 'wrong_number', false)),
    -- Anything closed that is none of the five. Zero on today's data; carried so
    -- the tooltip's check can show a shortfall rather than hide one.
    'closedOther',        (select count(*) from cur
                            where closed
                              and status <> 'won'
                              and not (status = 'lost' and lost_reason in ('competitor','not_interested','max_followups'))
                              and not coalesce(close_reason = 'wrong_number', false)),
    -- Money is per won line wherever it sits, including on leads not counted as
    -- purchases above. See the note at the top of this file.
    'revenue',            (select coalesce(sum(i.amount), 0) from wonitem i),
    'wonItems',           (select count(*) from wonitem),
    'wonItemsNoAmount',   (select count(*) from wonitem where amount is null),
    'purchasedAnyLine',   (select count(distinct i.enquiry_id) from wonitem i),
    -- The open side, split by the rung now due.
    'atFollowUp1',        (select count(*) from cur where not closed and slots = 0),
    'atFollowUp2',        (select count(*) from cur where not closed and slots = 1),
    'atFollowUp3',        (select count(*) from cur where not closed and slots >= 2),
    'overdue',            (select count(*) from cur where not closed and due < app.ist_today()),
    'oldestOpenDays',     (select coalesce(max(app.ist_today() - created_on), 0) from cur where not closed),
    'called',             (select count(*) from cur where called),
    'uncalled',           (select count(*) from cur where not called),
    'lostTotal',          (select count(*) from cur where status = 'lost')
  );
$function$;

grant execute on function app.analytics_totals(date, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The page's totals: this window, the comparison window, the reconciliation.
-- ---------------------------------------------------------------------------
--
-- §83.3. The comparison window is now given rather than derived. "Previous
-- period" is computed by the caller and passed in, which is what lets the same
-- function serve None, Previous period and a custom range without three code
-- paths — and what stops the strip and the tables disagreeing about which window
-- they are comparing against.
create or replace function public.analytics_scope(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_out jsonb;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id, p_term_id)
  ),
  pair as (
    select distinct i.enquiry_id, i.teacher_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null
  ),
  cell as (
    select distinct i.enquiry_id, i.course_id, i.subject_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'cmpFrom', p_cmp_from, 'cmpTo', p_cmp_to,
    'now',  app.analytics_totals(p_from, p_to, p_course_id, p_subject_id,
                                 p_source_id, p_counsellor_id, p_term_id),
    -- Null when no comparison was asked for, so the client renders no deltas at
    -- all rather than deltas against zero.
    'prev', case when p_cmp_from is not null and p_cmp_to is not null
                 then app.analytics_totals(p_cmp_from, p_cmp_to, p_course_id, p_subject_id,
                                           p_source_id, p_counsellor_id, p_term_id)
            end,
    'taggedLeads',    (select count(distinct enquiry_id) from pair),
    'teacherRows',    (select count(*) from pair),
    'untagged',       (select count(*) from cur c
                        where not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
    'courseLeads',    (select count(distinct enquiry_id) from cell),
    'courseRows',     (select count(*) from cell),
    'untaggedCourse', (select count(*) from cur c
                        where not exists (select 1 from cell x where x.enquiry_id = c.enquiry_id)),
    'bookkeeping', (select jsonb_build_object(
        'handedToSupport', count(*) filter (where e.close_reason = 'handed_to_support'),
        'superseded',      count(*) filter (where e.close_reason = 'superseded'))
      from public.enquiries e
     where e.type = 'purchase' and e.archived_at is null
       and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and e.status = 'closed'
       and e.close_reason in ('handed_to_support', 'superseded'))
  ) into v_out;

  return v_out;
end;
$function$;

grant execute on function public.analytics_scope(
  date, date, uuid, uuid, uuid, uuid, uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The three demand tables, now carrying both bases.
-- ---------------------------------------------------------------------------
--
-- One shape, three grains, generated from one template — the §82 arrangement,
-- extended with the closed/open split and the open side's follow-up rungs so the
-- basis toggle is a column choice rather than three different queries.


create or replace function public.analytics_by_teacher(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null
)
returns table (
  teacher_id            uuid,
  teacher_name          text,
  institute_id          uuid,
  institute_name        text,
  leads                 integer,
  prev_leads            integer,
  closed                integer,
  open_leads            integer,
  purchased             integer,
  revenue               numeric,
  lost_competitor       integer,
  lost_not_interested   integer,
  lost_no_response      integer,
  lost_wrong_number     integer,
  items_lost_competitor integer,
  at_fu1                integer,
  at_fu2                integer,
  at_fu3                integer,
  overdue               integer,
  oldest_open_days      integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
  ),
  -- Empty when no comparison was asked for, which makes every prev_* column zero
  -- and the client render no delta.
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
     where p_cmp_from is not null and p_cmp_to is not null
  ),
  pair as (
    select distinct i.enquiry_id, i.teacher_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null
  ),
  pair_prev as (
    select distinct i.enquiry_id, i.teacher_id
      from public.enquiry_items i join prv p on p.enquiry_id = i.enquiry_id
     where i.teacher_id is not null
  ),
  base as (
    select p.teacher_id,
           count(distinct p.enquiry_id) as leads,
           count(distinct p.enquiry_id) filter (where c.closed) as closed,
           count(distinct p.enquiry_id) filter (where not c.closed) as open_n,
           count(distinct p.enquiry_id) filter (where c.status = 'won') as purchased,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where coalesce(c.close_reason = 'wrong_number', false)) as lost_wrong_number,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots = 0) as at_fu1,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots = 1) as at_fu2,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots >= 2) as at_fu3,
           count(distinct p.enquiry_id) filter (where not c.closed and c.due < app.ist_today()) as overdue,
           coalesce(max(app.ist_today() - c.created_on) filter (where not c.closed), 0) as oldest_open_days
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.teacher_id
  ),
  prevn as (select pp.teacher_id, count(distinct pp.enquiry_id) as n
              from pair_prev pp group by pp.teacher_id),
  money as (
    select i.teacher_id, sum(i.amount) as a
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null and i.status = 'won' group by i.teacher_id
  ),
  compitem as (
    select i.teacher_id, count(*) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null and i.status = 'competitor' group by i.teacher_id
  ),
  untag as (
    select count(*) as leads,
           count(*) filter (where c.closed) as closed,
           count(*) filter (where not c.closed) as open_n,
           count(*) filter (where c.status = 'won') as purchased,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(*) filter (where coalesce(c.close_reason = 'wrong_number', false)) as lost_wrong_number,
           count(*) filter (where not c.closed and c.slots = 0) as at_fu1,
           count(*) filter (where not c.closed and c.slots = 1) as at_fu2,
           count(*) filter (where not c.closed and c.slots >= 2) as at_fu3,
           count(*) filter (where not c.closed and c.due < app.ist_today()) as overdue,
           coalesce(max(app.ist_today() - c.created_on) filter (where not c.closed), 0) as oldest_open_days
      from cur c
     where not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)
  )
  select t.id, t.name, ins.id, ins.name,
         b.leads::integer, coalesce(pn.n, 0)::integer,
         b.closed::integer, b.open_n::integer, b.purchased::integer,
         coalesce(m.a, 0)::numeric,
         b.lost_competitor::integer, b.lost_not_interested::integer,
         b.lost_no_response::integer, b.lost_wrong_number::integer,
         coalesce(ci.n, 0)::integer,
         b.at_fu1::integer, b.at_fu2::integer, b.at_fu3::integer,
         b.overdue::integer, b.oldest_open_days::integer
    from base b
    join public.teachers t on t.id = b.teacher_id
    left join public.institutes ins on ins.id = t.institute_id
    left join prevn pn on pn.teacher_id = b.teacher_id
    left join money m on m.teacher_id = b.teacher_id
    left join compitem ci on ci.teacher_id = b.teacher_id
  union all
  select null::uuid, 'Untagged', null::uuid, null::text,
         u.leads::integer,
         (select count(*)::integer from prv p2
           where not exists (select 1 from pair_prev pp where pp.enquiry_id = p2.enquiry_id)),
         u.closed::integer, u.open_n::integer, u.purchased::integer,
         (select coalesce(sum(i.amount), 0)::numeric
            from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
           where i.status = 'won'
             and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
         u.lost_competitor::integer, u.lost_not_interested::integer,
         u.lost_no_response::integer, u.lost_wrong_number::integer,
         0,
         u.at_fu1::integer, u.at_fu2::integer, u.at_fu3::integer,
         u.overdue::integer, u.oldest_open_days::integer
    from untag u
   where u.leads > 0;
end;
$function$;

grant execute on function public.analytics_by_teacher(
  date, date, uuid, uuid, uuid, uuid, uuid, date, date) to authenticated, service_role;


create or replace function public.analytics_by_institute(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null
)
returns table (
  institute_id          uuid,
  institute_name        text,
  leads                 integer,
  prev_leads            integer,
  closed                integer,
  open_leads            integer,
  purchased             integer,
  revenue               numeric,
  lost_competitor       integer,
  lost_not_interested   integer,
  lost_no_response      integer,
  lost_wrong_number     integer,
  items_lost_competitor integer,
  at_fu1                integer,
  at_fu2                integer,
  at_fu3                integer,
  overdue               integer,
  oldest_open_days      integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
  ),
  -- Empty when no comparison was asked for, which makes every prev_* column zero
  -- and the client render no delta.
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
     where p_cmp_from is not null and p_cmp_to is not null
  ),
  pair as (
    select distinct i.enquiry_id, t.institute_id
      from public.enquiry_items i
      join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where t.institute_id is not null
  ),
  pair_prev as (
    select distinct i.enquiry_id, t.institute_id
      from public.enquiry_items i
      join prv p on p.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where t.institute_id is not null
  ),
  base as (
    select p.institute_id,
           count(distinct p.enquiry_id) as leads,
           count(distinct p.enquiry_id) filter (where c.closed) as closed,
           count(distinct p.enquiry_id) filter (where not c.closed) as open_n,
           count(distinct p.enquiry_id) filter (where c.status = 'won') as purchased,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where coalesce(c.close_reason = 'wrong_number', false)) as lost_wrong_number,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots = 0) as at_fu1,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots = 1) as at_fu2,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots >= 2) as at_fu3,
           count(distinct p.enquiry_id) filter (where not c.closed and c.due < app.ist_today()) as overdue,
           coalesce(max(app.ist_today() - c.created_on) filter (where not c.closed), 0) as oldest_open_days
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.institute_id
  ),
  prevn as (select pp.institute_id, count(distinct pp.enquiry_id) as n
              from pair_prev pp group by pp.institute_id),
  money as (
    select t.institute_id, sum(i.amount) as a
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where i.status = 'won' and t.institute_id is not null group by t.institute_id
  ),
  compitem as (
    select t.institute_id, count(*) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where i.status = 'competitor' and t.institute_id is not null group by t.institute_id
  ),
  untag as (
    select count(*) as leads,
           count(*) filter (where c.closed) as closed,
           count(*) filter (where not c.closed) as open_n,
           count(*) filter (where c.status = 'won') as purchased,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(*) filter (where coalesce(c.close_reason = 'wrong_number', false)) as lost_wrong_number,
           count(*) filter (where not c.closed and c.slots = 0) as at_fu1,
           count(*) filter (where not c.closed and c.slots = 1) as at_fu2,
           count(*) filter (where not c.closed and c.slots >= 2) as at_fu3,
           count(*) filter (where not c.closed and c.due < app.ist_today()) as overdue,
           coalesce(max(app.ist_today() - c.created_on) filter (where not c.closed), 0) as oldest_open_days
      from cur c
     where not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)
  )
  select ins.id, ins.name,
         b.leads::integer, coalesce(pn.n, 0)::integer,
         b.closed::integer, b.open_n::integer, b.purchased::integer,
         coalesce(m.a, 0)::numeric,
         b.lost_competitor::integer, b.lost_not_interested::integer,
         b.lost_no_response::integer, b.lost_wrong_number::integer,
         coalesce(ci.n, 0)::integer,
         b.at_fu1::integer, b.at_fu2::integer, b.at_fu3::integer,
         b.overdue::integer, b.oldest_open_days::integer
    from base b
    join public.institutes ins on ins.id = b.institute_id
    left join prevn pn on pn.institute_id = b.institute_id
    left join money m on m.institute_id = b.institute_id
    left join compitem ci on ci.institute_id = b.institute_id
  union all
  select null::uuid, 'Untagged',
         u.leads::integer,
         (select count(*)::integer from prv p2
           where not exists (select 1 from pair_prev pp where pp.enquiry_id = p2.enquiry_id)),
         u.closed::integer, u.open_n::integer, u.purchased::integer,
         (select coalesce(sum(i.amount), 0)::numeric
            from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
           where i.status = 'won'
             and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
         u.lost_competitor::integer, u.lost_not_interested::integer,
         u.lost_no_response::integer, u.lost_wrong_number::integer,
         0,
         u.at_fu1::integer, u.at_fu2::integer, u.at_fu3::integer,
         u.overdue::integer, u.oldest_open_days::integer
    from untag u
   where u.leads > 0;
end;
$function$;

grant execute on function public.analytics_by_institute(
  date, date, uuid, uuid, uuid, uuid, uuid, date, date) to authenticated, service_role;


create or replace function public.analytics_by_course(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null
)
returns table (
  course_id             uuid,
  course_name           text,
  subject_id            uuid,
  subject_name          text,
  leads                 integer,
  prev_leads            integer,
  closed                integer,
  open_leads            integer,
  purchased             integer,
  revenue               numeric,
  lost_competitor       integer,
  lost_not_interested   integer,
  lost_no_response      integer,
  lost_wrong_number     integer,
  items_lost_competitor integer,
  at_fu1                integer,
  at_fu2                integer,
  at_fu3                integer,
  overdue               integer,
  oldest_open_days      integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
  ),
  -- Empty when no comparison was asked for, which makes every prev_* column zero
  -- and the client render no delta.
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
     where p_cmp_from is not null and p_cmp_to is not null
  ),
  pair as (
    select distinct i.enquiry_id, i.course_id, i.subject_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null
  ),
  pair_prev as (
    select distinct i.enquiry_id, i.course_id, i.subject_id
      from public.enquiry_items i join prv p on p.enquiry_id = i.enquiry_id
     where i.course_id is not null
  ),
  base as (
    select p.course_id, p.subject_id,
           count(distinct p.enquiry_id) as leads,
           count(distinct p.enquiry_id) filter (where c.closed) as closed,
           count(distinct p.enquiry_id) filter (where not c.closed) as open_n,
           count(distinct p.enquiry_id) filter (where c.status = 'won') as purchased,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where coalesce(c.close_reason = 'wrong_number', false)) as lost_wrong_number,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots = 0) as at_fu1,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots = 1) as at_fu2,
           count(distinct p.enquiry_id) filter (where not c.closed and c.slots >= 2) as at_fu3,
           count(distinct p.enquiry_id) filter (where not c.closed and c.due < app.ist_today()) as overdue,
           coalesce(max(app.ist_today() - c.created_on) filter (where not c.closed), 0) as oldest_open_days
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.course_id, p.subject_id
  ),
  prevn as (select pp.course_id, pp.subject_id, count(distinct pp.enquiry_id) as n
              from pair_prev pp group by pp.course_id, pp.subject_id),
  money as (
    select i.course_id, i.subject_id, sum(i.amount) as a
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null and i.status = 'won' group by i.course_id, i.subject_id
  ),
  compitem as (
    select i.course_id, i.subject_id, count(*) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null and i.status = 'competitor' group by i.course_id, i.subject_id
  ),
  untag as (
    select count(*) as leads,
           count(*) filter (where c.closed) as closed,
           count(*) filter (where not c.closed) as open_n,
           count(*) filter (where c.status = 'won') as purchased,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(*) filter (where coalesce(c.close_reason = 'wrong_number', false)) as lost_wrong_number,
           count(*) filter (where not c.closed and c.slots = 0) as at_fu1,
           count(*) filter (where not c.closed and c.slots = 1) as at_fu2,
           count(*) filter (where not c.closed and c.slots >= 2) as at_fu3,
           count(*) filter (where not c.closed and c.due < app.ist_today()) as overdue,
           coalesce(max(app.ist_today() - c.created_on) filter (where not c.closed), 0) as oldest_open_days
      from cur c
     where not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)
  )
  select co.id, co.name, sj.id, coalesce(sj.name, 'Not said'),
         b.leads::integer, coalesce(pn.n, 0)::integer,
         b.closed::integer, b.open_n::integer, b.purchased::integer,
         coalesce(m.a, 0)::numeric,
         b.lost_competitor::integer, b.lost_not_interested::integer,
         b.lost_no_response::integer, b.lost_wrong_number::integer,
         coalesce(ci.n, 0)::integer,
         b.at_fu1::integer, b.at_fu2::integer, b.at_fu3::integer,
         b.overdue::integer, b.oldest_open_days::integer
    from base b
    join public.courses co on co.id = b.course_id
    left join public.subjects sj on sj.id = b.subject_id
    left join prevn pn on pn.course_id = b.course_id
                      and pn.subject_id is not distinct from b.subject_id
    left join money m on m.course_id = b.course_id
                      and m.subject_id is not distinct from b.subject_id
    left join compitem ci on ci.course_id = b.course_id
                      and ci.subject_id is not distinct from b.subject_id
  union all
  select null::uuid, 'Untagged', null::uuid, null::text,
         u.leads::integer,
         (select count(*)::integer from prv p2
           where not exists (select 1 from pair_prev pp where pp.enquiry_id = p2.enquiry_id)),
         u.closed::integer, u.open_n::integer, u.purchased::integer,
         (select coalesce(sum(i.amount), 0)::numeric
            from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
           where i.status = 'won'
             and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
         u.lost_competitor::integer, u.lost_not_interested::integer,
         u.lost_no_response::integer, u.lost_wrong_number::integer,
         0,
         u.at_fu1::integer, u.at_fu2::integer, u.at_fu3::integer,
         u.overdue::integer, u.oldest_open_days::integer
    from untag u
   where u.leads > 0;
end;
$function$;

grant execute on function public.analytics_by_course(
  date, date, uuid, uuid, uuid, uuid, uuid, date, date) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- What students typed, with the comparison window threaded through.
-- ---------------------------------------------------------------------------
drop function if exists public.analytics_products(date, date, uuid, uuid, uuid, uuid, uuid, integer);

create or replace function public.analytics_products(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_limit         integer default 20
)
returns table (
  product   text,
  enquiries integer,
  purchased integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id, p_term_id)
  ),
  typed as (
    select c.enquiry_id, c.status, btrim(c.product_text) as raw,
           lower(btrim(c.product_text)) as key
      from cur c
     where coalesce(btrim(c.product_text), '') <> ''
  )
  select (array_agg(t.raw order by t.raw))[1] as product,
         count(*)::integer,
         -- §83.1. The lead's own outcome, as everywhere else on the page.
         count(*) filter (where t.status = 'won')::integer
    from typed t
   group by t.key
   order by count(*) desc, product
   limit greatest(coalesce(p_limit, 20), 1);
end;
$function$;

grant execute on function public.analytics_products(
  date, date, uuid, uuid, uuid, uuid, uuid, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
