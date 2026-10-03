-- §81. Analytics: teacher and institute demand, and product/course/subject/term.
--
-- Read-only. Nothing here writes to a counselling table, and every function
-- refuses a caller who is not a manager or super admin — the route gate is
-- presentation, this is the permission.

-- ---------------------------------------------------------------------------
-- 1. The scope, defined once.
-- ---------------------------------------------------------------------------
--
-- Every figure on the page is a count of leads in a window, narrowed the same
-- five ways, so the window and the narrowing live in one function. Nine separate
-- copies of this predicate is how two cards on one screen start disagreeing
-- about how many leads there were.
--
-- Two decisions are baked in here deliberately, because they have to hold in
-- every denominator on the page:
--
--   * A lead handed to Support or superseded by a newer record is bookkeeping
--     rather than demand. It never wanted a teacher and it never lost to one, so
--     counting it would quietly depress every conversion rate on the page. Their
--     number is shown once in the page footer so the exclusion is visible rather
--     than silent.
--   * The period is the lead's own arrival day in IST, not the day something
--     happened to it. "Enquiries" is the base metric and the comparison column
--     is "the same length of time before this", and both only mean anything if
--     the window is about when the lead came in.
--
-- The counsellor filter means "a lead this person called", not "a lead assigned
-- to them": the question it answers is whose pitch produced which outcome, and
-- an assignment nobody rang says nothing about that.
create or replace function app.analytics_leads(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null
)
returns table (
  enquiry_id   bigint,
  status       public.enquiry_status,
  lost_reason  public.lost_reason,
  close_reason public.close_reason,
  term_id      uuid,
  product_text text,
  called       boolean
)
language sql
stable
security definer
set search_path to ''
as $function$
  select e.id, e.status, e.lost_reason, e.close_reason, e.term_id, e.product_text,
         exists (select 1 from public.calls c where c.enquiry_id = e.id)
    from public.enquiries e
   where e.type = 'purchase'
     and e.archived_at is null
     and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     and not (e.status = 'closed'
              and e.close_reason in ('handed_to_support', 'superseded'))
     and (p_source_id is null or e.source_id = p_source_id)
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

grant execute on function app.analytics_leads(date, date, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The page's own totals, for the header, the footer and the insights.
-- ---------------------------------------------------------------------------
--
-- One round trip for every number that is about the whole page rather than one
-- row: the reconciliation footer, the uncalled line, the bookkeeping count, the
-- team-average conversion the insight rules compare against, and the two
-- data-quality figures.
create or replace function public.analytics_scope(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_len  integer := (p_to - p_from) + 1;
  v_out  jsonb;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id)
  ),
  pair as (
    select distinct i.enquiry_id, i.teacher_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null
  ),
  cell as (
    select distinct i.enquiry_id, i.course_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null
  ),
  wonitem as (
    select i.* from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.status = 'won'
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_len,
    'prevFrom', p_from - v_len, 'prevTo', p_from - 1,
    -- The reconciliation: untagged + tagged = leads, and the row count above it.
    'leads',        (select count(*) from cur),
    'taggedLeads',  (select count(distinct enquiry_id) from pair),
    'teacherRows',  (select count(*) from pair),
    'untagged',     (select count(*) from cur c
                      where not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
    'courseLeads',  (select count(distinct enquiry_id) from cell),
    'pivotCells',   (select count(*) from cell),
    'untaggedCourse', (select count(*) from cur c
                        where not exists (select 1 from cell x where x.enquiry_id = c.enquiry_id)),
    -- §81. Said once in the header: the column it replaces could only ever read
    -- 100%, because a teacher tag is written during the call that creates it.
    'uncalled',     (select count(*) from cur where not called),
    'uncalledUntagged', (select count(*) from cur c
                          where not c.called
                            and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
    -- Excluded from every denominator above; shown so the exclusion is visible.
    'bookkeeping', (select jsonb_build_object(
        'handedToSupport', count(*) filter (where e.close_reason = 'handed_to_support'),
        'superseded',      count(*) filter (where e.close_reason = 'superseded'))
      from public.enquiries e
     where e.type = 'purchase' and e.archived_at is null
       and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
       and e.status = 'closed'
       and e.close_reason in ('handed_to_support', 'superseded')),
    -- What the "low conversion" rule compares a row against.
    'purchasedLeads', (select count(distinct i.enquiry_id) from wonitem i),
    'teamConversion', case when (select count(*) from cur) = 0 then 0
      else round((select count(distinct i.enquiry_id) from wonitem i)::numeric
                 / (select count(*) from cur), 4) end,
    'revenue',      (select coalesce(sum(i.amount), 0) from wonitem i),
    'wonItems',     (select count(*) from wonitem),
    'wonItemsNoAmount', (select count(*) from wonitem where amount is null),
    'lostTotal',    (select count(*) from cur where status = 'lost'),
    'lostNoResponse', (select count(*) from cur
                        where status = 'lost' and lost_reason = 'max_followups')
  ) into v_out;

  return v_out;
end;
$function$;

grant execute on function public.analytics_scope(date, date, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Demand by teacher.
-- ---------------------------------------------------------------------------
--
-- The grain is one row per (lead, teacher) pair, taken distinct from
-- enquiry_items — which is the only place a lead's teacher is recorded.
-- enquiries.teacher_id exists but is non-null on five rows in the whole table,
-- all of them after-sale, so it says nothing about demand.
--
-- A lead naming two teachers therefore counts under both, and the column does
-- not sum to the lead total. That is the honest shape of the question "how many
-- people asked about this teacher", and the page says so in its footer rather
-- than quietly presenting a total that is larger than the enquiry list.
--
-- Purchased is counted in *leads*, not won items, so that it shares a unit with
-- Enquiries and Conversion % is a ratio of like with like. Amount is the
-- opposite — it sums the teacher's own won items — because money belongs to the
-- line that was sold, not to the lead that carried it. The two columns are
-- deliberately in different units and the header says which.
create or replace function public.analytics_by_teacher(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null
)
returns table (
  teacher_id            uuid,
  teacher_name          text,
  institute_id          uuid,
  institute_name        text,
  enquiries             integer,
  prev_enquiries        integer,
  in_progress           integer,
  purchased             integer,
  amount                numeric,
  lost_competitor       integer,
  lost_not_interested   integer,
  lost_no_response      integer,
  lost_wrong_number     integer,
  items_lost_competitor integer,
  tickets               integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_len       integer := (p_to - p_from) + 1;
  v_prev_to   date := p_from - 1;
  v_prev_from date := p_from - v_len;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id)
  ),
  prv as (
    select * from app.analytics_leads(v_prev_from, v_prev_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id)
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
  -- Per teacher, counted on the lead.
  base as (
    select p.teacher_id as tid,
           count(distinct p.enquiry_id) as enquiries,
           count(distinct p.enquiry_id) filter (where c.status = 'open' and c.called) as in_progress,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where c.status = 'closed' and c.close_reason = 'wrong_number') as lost_wrong_number
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.teacher_id
  ),
  prevn as (select pp.teacher_id as tid, count(distinct pp.enquiry_id) as n from pair_prev pp group by pp.teacher_id),
  won as (
    select i.teacher_id as tid, count(distinct i.enquiry_id) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null and i.status = 'won'
     group by i.teacher_id
  ),
  money as (
    select i.teacher_id as tid, sum(i.amount) as a
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null and i.status = 'won'
     group by i.teacher_id
  ),
  -- §81. The narrower signal: this teacher's own line went to a competitor,
  -- rather than the lead as a whole having been lost to one. Counted in items,
  -- so it will not tie to the column beside it — which is the point of having
  -- both.
  compitem as (
    select i.teacher_id as tid, count(*) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null and i.status = 'competitor'
     group by i.teacher_id
  ),
  tix as (
    select u.tid, count(*) as n from (
      select unnest(t.teacher_ids) as tid
        from support.tickets t
       where t.parent_ticket_id is null
         and (t.raised_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ) u group by u.tid
  ),
  -- The leads that named no teacher at all, as one row.
  untag as (
    select count(*) as enquiries,
           count(*) filter (where c.status = 'open' and c.called) as in_progress,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(*) filter (where c.status = 'closed' and c.close_reason = 'wrong_number') as lost_wrong_number
      from cur c
     where not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)
  )
  select t.id, t.name, ins.id, ins.name,
         b.enquiries::integer, coalesce(pn.n, 0)::integer, b.in_progress::integer,
         coalesce(w.n, 0)::integer, coalesce(m.a, 0)::numeric,
         b.lost_competitor::integer, b.lost_not_interested::integer,
         b.lost_no_response::integer, b.lost_wrong_number::integer,
         coalesce(ci.n, 0)::integer, coalesce(x.n, 0)::integer
    from base b
    join public.teachers t on t.id = b.tid
    left join public.institutes ins on ins.id = t.institute_id
    left join prevn pn on pn.tid = b.tid
    left join won w on w.tid = b.tid
    left join money m on m.tid = b.tid
    left join compitem ci on ci.tid = b.tid
    left join tix x on x.tid = b.tid
  union all
  select null::uuid, 'Untagged', null::uuid, null::text,
         u.enquiries::integer,
         (select count(*)::integer from prv p2
           where not exists (select 1 from pair_prev pp where pp.enquiry_id = p2.enquiry_id)),
         u.in_progress::integer,
         -- A lead with no teacher can still have been bought; the sale simply
         -- cannot be credited to anybody here.
         (select count(distinct i.enquiry_id)::integer
            from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
           where i.status = 'won' and i.teacher_id is null
             and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
         (select coalesce(sum(i.amount), 0)::numeric
            from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
           where i.status = 'won' and i.teacher_id is null
             and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
         u.lost_competitor::integer, u.lost_not_interested::integer,
         u.lost_no_response::integer, u.lost_wrong_number::integer,
         0, 0
    from untag u
   where u.enquiries > 0;
end;
$function$;

grant execute on function public.analytics_by_teacher(date, date, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The same, by institute.
-- ---------------------------------------------------------------------------
--
-- An institute is reached through its teachers: enquiry_items names a teacher
-- and teachers.institute_id names the house. Every one of the 111 teachers has
-- an institute, so institute coverage is exactly teacher coverage and the
-- Untagged row is the same set of leads.
--
-- Tickets come from support.tickets.institute_ids rather than through the
-- teacher, because §75 made a ticket able to name an institute directly.
create or replace function public.analytics_by_institute(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null
)
returns table (
  institute_id          uuid,
  institute_name        text,
  enquiries             integer,
  prev_enquiries        integer,
  in_progress           integer,
  purchased             integer,
  amount                numeric,
  lost_competitor       integer,
  lost_not_interested   integer,
  lost_no_response      integer,
  lost_wrong_number     integer,
  items_lost_competitor integer,
  tickets               integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_len       integer := (p_to - p_from) + 1;
  v_prev_to   date := p_from - 1;
  v_prev_from date := p_from - v_len;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id)
  ),
  prv as (
    select * from app.analytics_leads(v_prev_from, v_prev_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id)
  ),
  pair as (
    select distinct i.enquiry_id, t.institute_id as iid
      from public.enquiry_items i
      join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where t.institute_id is not null
  ),
  pair_prev as (
    select distinct i.enquiry_id, t.institute_id as iid
      from public.enquiry_items i
      join prv p on p.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where t.institute_id is not null
  ),
  base as (
    select p.iid,
           count(distinct p.enquiry_id) as enquiries,
           count(distinct p.enquiry_id) filter (where c.status = 'open' and c.called) as in_progress,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where c.status = 'closed' and c.close_reason = 'wrong_number') as lost_wrong_number
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.iid
  ),
  prevn as (select pp.iid, count(distinct pp.enquiry_id) as n from pair_prev pp group by pp.iid),
  won as (
    select t.institute_id as iid, count(distinct i.enquiry_id) as n
      from public.enquiry_items i
      join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where i.status = 'won' and t.institute_id is not null
     group by t.institute_id
  ),
  money as (
    select t.institute_id as iid, sum(i.amount) as a
      from public.enquiry_items i
      join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where i.status = 'won' and t.institute_id is not null
     group by t.institute_id
  ),
  compitem as (
    select t.institute_id as iid, count(*) as n
      from public.enquiry_items i
      join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where i.status = 'competitor' and t.institute_id is not null
     group by t.institute_id
  ),
  tix as (
    select u.iid, count(*) as n from (
      select unnest(t.institute_ids) as iid
        from support.tickets t
       where t.parent_ticket_id is null
         and (t.raised_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ) u group by u.iid
  ),
  untag as (
    select count(*) as enquiries,
           count(*) filter (where c.status = 'open' and c.called) as in_progress,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(*) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(*) filter (where c.status = 'closed' and c.close_reason = 'wrong_number') as lost_wrong_number
      from cur c
     where not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)
  )
  select ins.id, ins.name,
         b.enquiries::integer, coalesce(pn.n, 0)::integer, b.in_progress::integer,
         coalesce(w.n, 0)::integer, coalesce(m.a, 0)::numeric,
         b.lost_competitor::integer, b.lost_not_interested::integer,
         b.lost_no_response::integer, b.lost_wrong_number::integer,
         coalesce(ci.n, 0)::integer, coalesce(x.n, 0)::integer
    from base b
    join public.institutes ins on ins.id = b.iid
    left join prevn pn on pn.iid = b.iid
    left join won w on w.iid = b.iid
    left join money m on m.iid = b.iid
    left join compitem ci on ci.iid = b.iid
    left join tix x on x.iid = b.iid
  union all
  select null::uuid, 'Untagged',
         u.enquiries::integer,
         (select count(*)::integer from prv p2
           where not exists (select 1 from pair_prev pp where pp.enquiry_id = p2.enquiry_id)),
         u.in_progress::integer,
         (select count(distinct i.enquiry_id)::integer
            from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
           where i.status = 'won'
             and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
         (select coalesce(sum(i.amount), 0)::numeric
            from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
           where i.status = 'won'
             and not exists (select 1 from pair p where p.enquiry_id = c.enquiry_id)),
         u.lost_competitor::integer, u.lost_not_interested::integer,
         u.lost_no_response::integer, u.lost_wrong_number::integer,
         0, 0
    from untag u
   where u.enquiries > 0;
end;
$function$;

grant execute on function public.analytics_by_institute(date, date, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The pivot: course × subject, by term.
-- ---------------------------------------------------------------------------
--
-- "Level" is the course: the masters already read CA Final / CA Inter / CMA
-- Final, so the level is inside the name and there is no separate column to
-- read. A row is therefore course × subject — "CA Inter · Costing" — and the
-- columns are the lead's own term, with Unknown for the 27% that carry none.
--
-- The same fan-out as the teacher table and for the same reason: a lead naming
-- two subjects appears in two cells, so the cells total more than the leads.
-- Returned long rather than pivoted, because the set of terms on screen depends
-- on the period and the client is where that belongs.
create or replace function public.analytics_pivot(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null
)
returns table (
  course_id      uuid,
  course_name    text,
  course_sort    smallint,
  subject_id     uuid,
  subject_name   text,
  subject_sort   smallint,
  term_id        uuid,
  term_name      text,
  term_sort      smallint,
  enquiries      integer,
  prev_enquiries integer,
  purchased      integer,
  revenue        numeric
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_len       integer := (p_to - p_from) + 1;
  v_prev_to   date := p_from - 1;
  v_prev_from date := p_from - v_len;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id)
  ),
  prv as (
    select * from app.analytics_leads(v_prev_from, v_prev_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id)
  ),
  -- One row per (lead, course, subject). A null subject is its own cell rather
  -- than being dropped: "CA Final, subject not said" is a real thing a lead is.
  cell as (
    select distinct i.enquiry_id, i.course_id, i.subject_id, c.term_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null
  ),
  cell_prev as (
    select distinct i.enquiry_id, i.course_id, i.subject_id, p.term_id
      from public.enquiry_items i join prv p on p.enquiry_id = i.enquiry_id
     where i.course_id is not null
  ),
  wonc as (
    select distinct i.enquiry_id, i.course_id, i.subject_id, c.term_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null and i.status = 'won'
  ),
  rev as (
    select i.course_id, i.subject_id, c.term_id, sum(i.amount) as a
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null and i.status = 'won'
     group by i.course_id, i.subject_id, c.term_id
  ),
  agg as (
    select x.course_id, x.subject_id, x.term_id,
           count(*) as enquiries,
           (select count(*) from wonc w
             where w.course_id = x.course_id
               and w.subject_id is not distinct from x.subject_id
               and w.term_id is not distinct from x.term_id) as purchased,
           (select coalesce(r.a, 0) from rev r
             where r.course_id = x.course_id
               and r.subject_id is not distinct from x.subject_id
               and r.term_id is not distinct from x.term_id) as revenue,
           (select count(*) from cell_prev cp
             where cp.course_id = x.course_id
               and cp.subject_id is not distinct from x.subject_id
               and cp.term_id is not distinct from x.term_id) as prev_enquiries
      from cell x
     group by x.course_id, x.subject_id, x.term_id
  )
  select co.id, co.name, co.sort_order,
         sj.id, coalesce(sj.name, 'Not said'), coalesce(sj.sort_order, 32767::smallint),
         tm.id, coalesce(tm.name, 'Unknown'), coalesce(tm.sort_order, 32767::smallint),
         a.enquiries::integer, a.prev_enquiries::integer,
         a.purchased::integer, coalesce(a.revenue, 0)::numeric
    from agg a
    join public.courses co on co.id = a.course_id
    left join public.subjects sj on sj.id = a.subject_id
    left join public.terms tm on tm.id = a.term_id;
end;
$function$;

grant execute on function public.analytics_pivot(date, date, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. What students actually type.
-- ---------------------------------------------------------------------------
--
-- product_text is the free line a counsellor transcribes from the call, and it
-- is the only place the student's own words survive — "DT Full by Bhanwar" and
-- "DT Fast Track" are two different asks that both tag to the same teacher.
-- Grouped on the trimmed text with case folded, because the same ask typed on
-- two days differs by a capital letter more often than not.
create or replace function public.analytics_products(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_limit         integer default 20
)
returns table (
  product   text,
  enquiries integer,
  purchased integer,
  revenue   numeric
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
                                      p_source_id, p_counsellor_id)
  ),
  typed as (
    select c.enquiry_id, btrim(c.product_text) as raw, lower(btrim(c.product_text)) as key
      from cur c
     where coalesce(btrim(c.product_text), '') <> ''
  )
  select (array_agg(t.raw order by t.raw))[1] as product,
         count(*)::integer,
         count(*) filter (where exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = t.enquiry_id and i.status = 'won'))::integer,
         coalesce((select sum(i.amount) from public.enquiry_items i
                    where i.enquiry_id in (select enquiry_id from typed t2 where t2.key = t.key)
                      and i.status = 'won'), 0)::numeric
    from typed t
   group by t.key
   order by count(*) desc, product
   limit greatest(coalesce(p_limit, 20), 1);
end;
$function$;

grant execute on function public.analytics_products(date, date, uuid, uuid, uuid, uuid, integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';
