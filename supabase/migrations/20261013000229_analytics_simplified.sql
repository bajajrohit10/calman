-- §82. Analytics, simplified: a metrics strip, a flat Products table, no tickets.
--
-- Three shape changes to what §81 built, and one addition:
--
--   * Every function gains a term filter. §82.2 takes term off the Products tab
--     — a pivot of course × subject × term was a grid nobody could read across —
--     and makes it a filter instead, which is where a dimension belongs when the
--     question is "narrow to this" rather than "compare these".
--   * The ticket columns go. Analytics is about conversion; a ticket count sat in
--     the middle of it inviting a causal reading nothing here supports, and the
--     Support reports already answer it properly.
--   * The pivot function is replaced by one shaped like the demand tables, so the
--     three tables on this page are now the same table with a different grain.
--   * app.analytics_totals is new: the metrics strip needs every headline figure
--     for two windows, and computing it in one function called twice is what
--     stops the strip and the tables disagreeing about what "purchased" means.

drop function if exists public.analytics_scope(date, date, uuid, uuid, uuid, uuid);
drop function if exists public.analytics_by_teacher(date, date, uuid, uuid, uuid, uuid);
drop function if exists public.analytics_by_institute(date, date, uuid, uuid, uuid, uuid);
drop function if exists public.analytics_pivot(date, date, uuid, uuid, uuid, uuid);
drop function if exists public.analytics_products(date, date, uuid, uuid, uuid, uuid, integer);
drop function if exists app.analytics_leads(date, date, uuid, uuid, uuid, uuid);

-- ---------------------------------------------------------------------------
-- 1. The scope, now with a term filter.
-- ---------------------------------------------------------------------------
--
-- Unchanged in every other respect, including the two decisions it carries: the
-- period is the lead's own arrival day in IST, and a lead handed to Support or
-- superseded is bookkeeping rather than demand and is out of every denominator.
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
-- 2. §82.1. Every headline figure for one window.
-- ---------------------------------------------------------------------------
--
-- The metrics strip shows nine numbers and the change in each against the
-- previous equal period, which is the same nine numbers twice. Written once and
-- called twice: a second copy for the comparison is how a strip starts claiming
-- a rise that is really a difference between two definitions.
--
-- Counted in leads throughout, except revenue and the sale counts, which are
-- per won line — money belongs to the line that sold it. Avg sale value is
-- therefore revenue over won lines, and the strip says so.
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
    'called',             (select count(*) from cur where called),
    'uncalled',           (select count(*) from cur where not called),
    -- A lead with at least one won line. Shares its unit with `leads`, so
    -- conversion is a ratio of like with like.
    'purchased',          (select count(distinct i.enquiry_id) from wonitem i),
    'revenue',            (select coalesce(sum(i.amount), 0) from wonitem i),
    'wonItems',           (select count(*) from wonitem),
    'wonItemsNoAmount',   (select count(*) from wonitem where amount is null),
    'openFollowUps',      (select count(*) from cur where status = 'open' and called),
    'lostCompetitor',     (select count(*) from cur where status = 'lost' and lost_reason = 'competitor'),
    'lostNotInterested',  (select count(*) from cur where status = 'lost' and lost_reason = 'not_interested'),
    'lostNoResponse',     (select count(*) from cur where status = 'lost' and lost_reason = 'max_followups'),
    'lostWrongNumber',    (select count(*) from cur where status = 'closed' and close_reason = 'wrong_number'),
    'lostTotal',          (select count(*) from cur where status = 'lost')
  );
$function$;

grant execute on function app.analytics_totals(date, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The page's totals: this window, the one before it, and the reconciliation.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_scope(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_len integer := (p_to - p_from) + 1;
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
    select distinct i.enquiry_id, i.course_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_len,
    'prevFrom', p_from - v_len, 'prevTo', p_from - 1,
    -- §82.1. The strip reads these two; everything else on the page reads `now`.
    'now',  app.analytics_totals(p_from, p_to, p_course_id, p_subject_id,
                                 p_source_id, p_counsellor_id, p_term_id),
    'prev', app.analytics_totals(p_from - v_len, p_from - 1, p_course_id, p_subject_id,
                                 p_source_id, p_counsellor_id, p_term_id),
    -- The reconciliation footer.
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

grant execute on function public.analytics_scope(date, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The three demand tables: by teacher, by institute, by course and subject.
-- ---------------------------------------------------------------------------
--
-- One shape, three grains. §82.2 made the Products tab a table rather than a
-- pivot, which means all three now answer the same question of a different
-- dimension, and they carry the same columns in the same units so a reader
-- moving between them is not also changing definitions.
--
-- The grain is always distinct (lead, dimension) taken from enquiry_items, so a
-- lead naming two teachers — or two subjects — counts under both and the column
-- does not sum to the lead total. The footer says so; see §81 for why that is the
-- honest shape rather than a bug.
--
-- No ticket columns: §82.3 took them out. A ticket count beside a conversion
-- rate invited a causal reading that nothing here supports, and Support reports
-- answer it with the context it needs.


create or replace function public.analytics_by_teacher(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null
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
  items_lost_competitor integer
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
  ),
  prv as (
    select * from app.analytics_leads(v_prev_from, v_prev_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
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
           count(distinct p.enquiry_id) as enquiries,
           count(distinct p.enquiry_id) filter (where c.status = 'open' and c.called) as in_progress,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where c.status = 'closed' and c.close_reason = 'wrong_number') as lost_wrong_number
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.teacher_id
  ),
  prevn as (select pp.teacher_id, count(distinct pp.enquiry_id) as n
              from pair_prev pp group by pp.teacher_id),
  won as (
    select i.teacher_id, count(distinct i.enquiry_id) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null and i.status = 'won' group by i.teacher_id
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
           count(*) as enquiries,
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
         coalesce(ci.n, 0)::integer
    from base b
    join public.teachers t on t.id = b.teacher_id
    left join public.institutes ins on ins.id = t.institute_id
    left join prevn pn on pn.teacher_id = b.teacher_id
    left join won w on w.teacher_id = b.teacher_id
    left join money m on m.teacher_id = b.teacher_id
    left join compitem ci on ci.teacher_id = b.teacher_id
  union all
  select null::uuid, 'Untagged', null::uuid, null::text,
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
         0
    from untag u
   where u.enquiries > 0;
end;
$function$;

grant execute on function public.analytics_by_teacher(date, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;


create or replace function public.analytics_by_institute(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null
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
  items_lost_competitor integer
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
  ),
  prv as (
    select * from app.analytics_leads(v_prev_from, v_prev_to, p_course_id, p_subject_id, p_source_id, p_counsellor_id, p_term_id)
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
           count(distinct p.enquiry_id) as enquiries,
           count(distinct p.enquiry_id) filter (where c.status = 'open' and c.called) as in_progress,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where c.status = 'closed' and c.close_reason = 'wrong_number') as lost_wrong_number
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.institute_id
  ),
  prevn as (select pp.institute_id, count(distinct pp.enquiry_id) as n
              from pair_prev pp group by pp.institute_id),
  won as (
    select t.institute_id, count(distinct i.enquiry_id) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
      join public.teachers t on t.id = i.teacher_id
     where i.status = 'won' and t.institute_id is not null group by t.institute_id
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
           count(*) as enquiries,
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
         coalesce(ci.n, 0)::integer
    from base b
    join public.institutes ins on ins.id = b.institute_id
    left join prevn pn on pn.institute_id = b.institute_id
    left join won w on w.institute_id = b.institute_id
    left join money m on m.institute_id = b.institute_id
    left join compitem ci on ci.institute_id = b.institute_id
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
         0
    from untag u
   where u.enquiries > 0;
end;
$function$;

grant execute on function public.analytics_by_institute(date, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. §82.2. By course and subject — the Products tab, now a plain table.
-- ---------------------------------------------------------------------------
--
-- A composite grain, so it is written out rather than generated with the two
-- above: the key is (course, subject) and a null subject is its own row, because
-- "CA Final, subject not said" is a real thing a lead is and dropping it would
-- quietly shrink the table's total.
--
-- Term is gone from the grain entirely. It survives as a filter on the bar, which
-- is the right home for a dimension you want to narrow by rather than read
-- across: the old pivot put eleven term columns on screen, most of them empty,
-- and the one number anybody wanted was the row total.
create or replace function public.analytics_by_course(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null
)
returns table (
  course_id             uuid,
  course_name           text,
  subject_id            uuid,
  subject_name          text,
  enquiries             integer,
  prev_enquiries        integer,
  in_progress           integer,
  purchased             integer,
  amount                numeric,
  lost_competitor       integer,
  lost_not_interested   integer,
  lost_no_response      integer,
  lost_wrong_number     integer,
  items_lost_competitor integer
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
                                      p_source_id, p_counsellor_id, p_term_id)
  ),
  prv as (
    select * from app.analytics_leads(v_prev_from, v_prev_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id, p_term_id)
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
           count(distinct p.enquiry_id) as enquiries,
           count(distinct p.enquiry_id) filter (where c.status = 'open' and c.called) as in_progress,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'competitor') as lost_competitor,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'not_interested') as lost_not_interested,
           count(distinct p.enquiry_id) filter (where c.status = 'lost' and c.lost_reason = 'max_followups') as lost_no_response,
           count(distinct p.enquiry_id) filter (where c.status = 'closed' and c.close_reason = 'wrong_number') as lost_wrong_number
      from pair p join cur c on c.enquiry_id = p.enquiry_id
     group by p.course_id, p.subject_id
  ),
  prevn as (
    select pp.course_id, pp.subject_id, count(distinct pp.enquiry_id) as n
      from pair_prev pp group by pp.course_id, pp.subject_id
  ),
  won as (
    select i.course_id, i.subject_id, count(distinct i.enquiry_id) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null and i.status = 'won'
     group by i.course_id, i.subject_id
  ),
  money as (
    select i.course_id, i.subject_id, sum(i.amount) as a
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null and i.status = 'won'
     group by i.course_id, i.subject_id
  ),
  compitem as (
    select i.course_id, i.subject_id, count(*) as n
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null and i.status = 'competitor'
     group by i.course_id, i.subject_id
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
  select co.id, co.name, sj.id, coalesce(sj.name, 'Not said'),
         b.enquiries::integer, coalesce(pn.n, 0)::integer, b.in_progress::integer,
         coalesce(w.n, 0)::integer, coalesce(m.a, 0)::numeric,
         b.lost_competitor::integer, b.lost_not_interested::integer,
         b.lost_no_response::integer, b.lost_wrong_number::integer,
         coalesce(ci.n, 0)::integer
    from base b
    join public.courses co on co.id = b.course_id
    left join public.subjects sj on sj.id = b.subject_id
    -- `is not distinct from` throughout, because a null subject is a real key
    -- here and `=` would drop every "Not said" row's sales and comparison.
    left join prevn pn on pn.course_id = b.course_id
                      and pn.subject_id is not distinct from b.subject_id
    left join won w on w.course_id = b.course_id
                   and w.subject_id is not distinct from b.subject_id
    left join money m on m.course_id = b.course_id
                     and m.subject_id is not distinct from b.subject_id
    left join compitem ci on ci.course_id = b.course_id
                         and ci.subject_id is not distinct from b.subject_id
  union all
  select null::uuid, 'Untagged', null::uuid, null::text,
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
         0
    from untag u
   where u.enquiries > 0;
end;
$function$;

grant execute on function public.analytics_by_course(date, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. What students typed. Trimmed, per §82.2, to what the block is read for.
-- ---------------------------------------------------------------------------
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
    select c.enquiry_id, btrim(c.product_text) as raw, lower(btrim(c.product_text)) as key
      from cur c
     where coalesce(btrim(c.product_text), '') <> ''
  )
  select (array_agg(t.raw order by t.raw))[1] as product,
         count(*)::integer,
         count(*) filter (where exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = t.enquiry_id and i.status = 'won'))::integer
    from typed t
   group by t.key
   order by count(*) desc, product
   limit greatest(coalesce(p_limit, 20), 1);
end;
$function$;

grant execute on function public.analytics_products(
  date, date, uuid, uuid, uuid, uuid, uuid, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
