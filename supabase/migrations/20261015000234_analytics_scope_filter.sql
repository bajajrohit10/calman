-- §84.4. One basis, now with a scope.
--
-- The experiment maths must reconcile with the strip for the same slice, so it runs
-- through app.analytics_leads rather than beside it: Before, During and Rest of team
-- are the same function over three (window, scope) pairs. Anything else and the
-- verdict sentence on an experiment card would be arguing with the tables below it.
--
-- Three new parameters do the whole job:
--
--   p_scope_type   all | teacher | institute | course_subject
--   p_scope_id     the teacher, the institute, or the *subject*
--   p_scope_invert "everything outside that scope", which is Rest of team
--
-- The subject names a course·subject pair on its own, because a subject belongs to
-- exactly one course. That keeps the events table's scope_id a single uuid and keeps
-- this predicate to one `exists`. It cannot address "course, subject not said", which
-- is not a thing anybody would run an experiment on.
drop function if exists public.analytics_scope(date, date, uuid, uuid, uuid, uuid, uuid, date, date);
drop function if exists public.analytics_by_teacher(date, date, uuid, uuid, uuid, uuid, uuid, date, date);
drop function if exists public.analytics_by_institute(date, date, uuid, uuid, uuid, uuid, uuid, date, date);
drop function if exists public.analytics_by_course(date, date, uuid, uuid, uuid, uuid, uuid, date, date);
drop function if exists public.analytics_products(date, date, uuid, uuid, uuid, uuid, uuid, integer);
drop function if exists app.analytics_totals(date, date, uuid, uuid, uuid, uuid, uuid);
drop function if exists app.analytics_leads(date, date, uuid, uuid, uuid, uuid, uuid);

create or replace function app.analytics_leads(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_scope_type    text default 'all',
  p_scope_id      uuid default null,
  p_scope_invert  boolean default false
)
returns table (
  enquiry_id   bigint,
  status       public.enquiry_status,
  lost_reason  public.lost_reason,
  close_reason public.close_reason,
  term_id      uuid,
  product_text text,
  called       boolean,
  closed       boolean,
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
         -- §83.1. Null-safe: close_reason is NULL on every open lead, and
         -- `status in (...) or NULL` is NULL rather than false.
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
            where c.enquiry_id = e.id and c.called_by = p_counsellor_id))
     -- §84.4. The scope, and its inverse. `<>` on the booleans is xor: invert
     -- flips the test without a second copy of it.
     and (coalesce(p_scope_type, 'all') = 'all'
          or p_scope_id is null
          or (coalesce(p_scope_invert, false) <> case p_scope_type
                when 'teacher' then exists (
                  select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.teacher_id = p_scope_id)
                when 'institute' then exists (
                  select 1 from public.enquiry_items i
                   join public.teachers t on t.id = i.teacher_id
                   where i.enquiry_id = e.id and t.institute_id = p_scope_id)
                when 'course_subject' then exists (
                  select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.subject_id = p_scope_id)
                else true
              end));
$function$;

grant execute on function app.analytics_leads(
  date, date, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean)
  to authenticated, service_role;

create or replace function app.analytics_totals(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_scope_type    text default 'all',
  p_scope_id      uuid default null,
  p_scope_invert  boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id, p_term_id,
                                      p_scope_type, p_scope_id, p_scope_invert)
  ),
  wonitem as (
    select i.* from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.status = 'won'
  )
  select jsonb_build_object(
    'leads',              (select count(*) from cur),
    'open',               (select count(*) from cur where not closed),
    'closed',             (select count(*) from cur where closed),
    'purchased',          (select count(*) from cur where status = 'won'),
    'lostCompetitor',     (select count(*) from cur where status = 'lost' and lost_reason = 'competitor'),
    'lostNotInterested',  (select count(*) from cur where status = 'lost' and lost_reason = 'not_interested'),
    'lostNoResponse',     (select count(*) from cur where status = 'lost' and lost_reason = 'max_followups'),
    'lostWrongNumber',    (select count(*) from cur where coalesce(close_reason = 'wrong_number', false)),
    'closedOther',        (select count(*) from cur
                            where closed and status <> 'won'
                              and not (status = 'lost' and lost_reason in ('competitor','not_interested','max_followups'))
                              and not coalesce(close_reason = 'wrong_number', false)),
    'revenue',            (select coalesce(sum(i.amount), 0) from wonitem i),
    'wonItems',           (select count(*) from wonitem),
    'wonItemsNoAmount',   (select count(*) from wonitem where amount is null),
    'purchasedAnyLine',   (select count(distinct i.enquiry_id) from wonitem i),
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

grant execute on function app.analytics_totals(
  date, date, uuid, uuid, uuid, uuid, uuid, text, uuid, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §84.3. One experiment's three windows, plus the rest of the team.
-- ---------------------------------------------------------------------------
--
-- Before is the equal-length period immediately before the start, on the same scope.
-- During runs to the end date or to today. Rest is the same During window with the
-- scope inverted — which is the whole point of the card: a conversion rise that
-- happened to everybody is not evidence about this experiment.
--
-- Every one of the four is app.analytics_totals, so all four reconcile with the
-- strip for the same filters. §84.4 asks for exactly that and this is where it is
-- true rather than nearly true.
create or replace function public.analytics_experiment_result(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_e      record;
  v_start  date;
  v_end    date;
  v_len    integer;
  v_bfrom  date;
  v_bto    date;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  select * into v_e from public.analytics_events where id = p_id;
  if v_e.id is null then return 'null'::jsonb; end if;

  v_start := v_e.start_date;
  -- A running experiment is measured to today; a finished one to its end date.
  v_end   := coalesce(v_e.end_date, app.ist_today());
  v_len   := greatest((v_end - v_start) + 1, 1);
  v_bto   := v_start - 1;
  v_bfrom := v_bto - (v_len - 1);

  return jsonb_build_object(
    'id', v_e.id,
    'note', v_e.note,
    'metricNote', v_e.metric_note,
    'scopeType', v_e.scope_type,
    'scopeId', v_e.scope_id,
    'startDate', v_start,
    'endDate', v_e.end_date,
    'live', v_e.end_date is null,
    -- "day N of M" while live: N counts from the start, M is the planned length,
    -- which for a running experiment is the same number — so the client shows N
    -- alone until an end date exists.
    'dayN', (app.ist_today() - v_start) + 1,
    'dayM', case when v_e.end_date is not null then (v_e.end_date - v_start) + 1 end,
    'beforeFrom', v_bfrom, 'beforeTo', v_bto,
    'duringFrom', v_start, 'duringTo', v_end,
    'before', app.analytics_totals(v_bfrom, v_bto, null, null, null, null, null,
                                   v_e.scope_type, v_e.scope_id, false),
    'during', app.analytics_totals(v_start, v_end, null, null, null, null, null,
                                   v_e.scope_type, v_e.scope_id, false),
    -- Everything outside the scope, over the During window. On an 'all' scope there
    -- is no outside, and the client hides the column rather than showing a copy.
    'rest',   case when v_e.scope_type <> 'all'
                   then app.analytics_totals(v_start, v_end, null, null, null, null, null,
                                             v_e.scope_type, v_e.scope_id, true) end,
    'restBefore', case when v_e.scope_type <> 'all'
                   then app.analytics_totals(v_bfrom, v_bto, null, null, null, null, null,
                                             v_e.scope_type, v_e.scope_id, true) end
  );
end;
$function$;

grant execute on function public.analytics_experiment_result(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The three demand tables, with the scope threaded through.
-- ---------------------------------------------------------------------------
--
-- The filter bar gains Teacher and Institute in §84, which is what makes §84.4's
-- reconciliation checkable: "the strip filtered to Praveen Khatod" has to be a view
-- somebody can actually open.


create or replace function public.analytics_by_teacher(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null,
  p_scope_type    text default 'all',
  p_scope_id      uuid default null,
  p_scope_invert  boolean default false
)
returns table (
  teacher_id            uuid,
  teacher_name          text,
  institute_id          uuid,
  institute_name        text,
  leads                 integer,
  prev_leads            integer,
  prev_closed           integer,
  prev_purchased        integer,
  prev_lost_competitor  integer,
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
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
  -- §84.1. The comparison needs more than lead counts now: the Demand head reads
  -- enquiries, and the Competitor and Conversion heads read their own rates on both
  -- sides, so the previous window's closed, purchased and competitor come back too.
  prevn as (
    select pp.teacher_id,
           count(distinct pp.enquiry_id) as leads,
           count(distinct pp.enquiry_id) filter (where p2.closed) as closed,
           count(distinct pp.enquiry_id) filter (where p2.status = 'won') as purchased,
           count(distinct pp.enquiry_id) filter (where p2.status = 'lost' and p2.lost_reason = 'competitor') as lost_competitor
      from pair_prev pp join prv p2 on p2.enquiry_id = pp.enquiry_id
     group by pp.teacher_id
  ),
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
    select
           count(*) as leads,
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
         b.leads::integer,
         coalesce(pn.leads, 0)::integer, coalesce(pn.closed, 0)::integer,
         coalesce(pn.purchased, 0)::integer, coalesce(pn.lost_competitor, 0)::integer,
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
         0, 0, 0,
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

grant execute on function public.analytics_by_teacher(date, date, uuid, uuid, uuid, uuid, uuid, date, date, text, uuid, boolean) to authenticated, service_role;


create or replace function public.analytics_by_institute(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null,
  p_scope_type    text default 'all',
  p_scope_id      uuid default null,
  p_scope_invert  boolean default false
)
returns table (
  institute_id          uuid,
  institute_name        text,
  leads                 integer,
  prev_leads            integer,
  prev_closed           integer,
  prev_purchased        integer,
  prev_lost_competitor  integer,
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
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
  -- §84.1. The comparison needs more than lead counts now: the Demand head reads
  -- enquiries, and the Competitor and Conversion heads read their own rates on both
  -- sides, so the previous window's closed, purchased and competitor come back too.
  prevn as (
    select pp.institute_id,
           count(distinct pp.enquiry_id) as leads,
           count(distinct pp.enquiry_id) filter (where p2.closed) as closed,
           count(distinct pp.enquiry_id) filter (where p2.status = 'won') as purchased,
           count(distinct pp.enquiry_id) filter (where p2.status = 'lost' and p2.lost_reason = 'competitor') as lost_competitor
      from pair_prev pp join prv p2 on p2.enquiry_id = pp.enquiry_id
     group by pp.institute_id
  ),
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
    select
           count(*) as leads,
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
         b.leads::integer,
         coalesce(pn.leads, 0)::integer, coalesce(pn.closed, 0)::integer,
         coalesce(pn.purchased, 0)::integer, coalesce(pn.lost_competitor, 0)::integer,
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
         0, 0, 0,
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

grant execute on function public.analytics_by_institute(date, date, uuid, uuid, uuid, uuid, uuid, date, date, text, uuid, boolean) to authenticated, service_role;


create or replace function public.analytics_by_course(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null,
  p_scope_type    text default 'all',
  p_scope_id      uuid default null,
  p_scope_invert  boolean default false
)
returns table (
  course_id             uuid,
  course_name           text,
  subject_id            uuid,
  subject_name          text,
  leads                 integer,
  prev_leads            integer,
  prev_closed           integer,
  prev_purchased        integer,
  prev_lost_competitor  integer,
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
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
  -- §84.1. The comparison needs more than lead counts now: the Demand head reads
  -- enquiries, and the Competitor and Conversion heads read their own rates on both
  -- sides, so the previous window's closed, purchased and competitor come back too.
  prevn as (
    select pp.course_id, pp.subject_id,
           count(distinct pp.enquiry_id) as leads,
           count(distinct pp.enquiry_id) filter (where p2.closed) as closed,
           count(distinct pp.enquiry_id) filter (where p2.status = 'won') as purchased,
           count(distinct pp.enquiry_id) filter (where p2.status = 'lost' and p2.lost_reason = 'competitor') as lost_competitor
      from pair_prev pp join prv p2 on p2.enquiry_id = pp.enquiry_id
     group by pp.course_id, pp.subject_id
  ),
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
    select
           count(*) as leads,
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
         b.leads::integer,
         coalesce(pn.leads, 0)::integer, coalesce(pn.closed, 0)::integer,
         coalesce(pn.purchased, 0)::integer, coalesce(pn.lost_competitor, 0)::integer,
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
         0, 0, 0,
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

grant execute on function public.analytics_by_course(date, date, uuid, uuid, uuid, uuid, uuid, date, date, text, uuid, boolean) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- What students typed. §84.1 drops the product-text insight card; the block stays.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_products(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_scope_type    text default 'all',
  p_scope_id      uuid default null,
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
                                      p_source_id, p_counsellor_id, p_term_id,
                                      p_scope_type, p_scope_id, false)
  ),
  typed as (
    select c.enquiry_id, c.status, btrim(c.product_text) as raw,
           lower(btrim(c.product_text)) as key
      from cur c
     where coalesce(btrim(c.product_text), '') <> ''
  )
  select (array_agg(t.raw order by t.raw))[1] as product,
         count(*)::integer,
         count(*) filter (where t.status = 'won')::integer
    from typed t
   group by t.key
   order by count(*) desc, product
   limit greatest(coalesce(p_limit, 20), 1);
end;
$function$;

grant execute on function public.analytics_products(
  date, date, uuid, uuid, uuid, uuid, uuid, text, uuid, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The page's totals, with the scope threaded through.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_scope(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null,
  p_cmp_from      date default null,
  p_cmp_to        date default null,
  p_scope_type    text default 'all',
  p_scope_id      uuid default null
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
                                      p_source_id, p_counsellor_id, p_term_id,
                                      p_scope_type, p_scope_id, false)
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
                                 p_source_id, p_counsellor_id, p_term_id,
                                 p_scope_type, p_scope_id, false),
    'prev', case when p_cmp_from is not null and p_cmp_to is not null
                 then app.analytics_totals(p_cmp_from, p_cmp_to, p_course_id, p_subject_id,
                                           p_source_id, p_counsellor_id, p_term_id,
                                           p_scope_type, p_scope_id, false)
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
  date, date, uuid, uuid, uuid, uuid, uuid, date, date, text, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
