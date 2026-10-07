-- §85.2. Reports, Analytics and Support reports open to every staff role.
--
-- These screens were manager-and-above since §62.1, on the reasoning that numbers
-- about the team are a management view. The reasoning holds for *managing* the team
-- and not for reading the work: a counsellor who cannot see which teachers convert
-- is being asked to sell without the one report that would tell them what sells.
--
-- `app.is_staff()` is already exactly the set this brief wants — every role except
-- accounts — so the change is a swap, not a new predicate. Nine functions carried
-- `app.is_admin()`; eight of them are listed below and the ninth, public.call_report,
-- needed nothing: it has gated on is_staff() since Brief 5 and uses is_admin() only
-- to decide whether the counsellor picker may name somebody else, which is the
-- "keep the counsellor default as me" the brief asks to preserve.
--
-- Writing stays admin-only everywhere: the experiment form's own actions re-check it,
-- and the analytics_events write policy below is untouched.

CREATE OR REPLACE FUNCTION public.analytics_by_course(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
 RETURNS TABLE(course_id uuid, course_name text, subject_id uuid, subject_name text, leads integer, prev_leads integer, prev_closed integer, prev_purchased integer, prev_lost_competitor integer, closed integer, open_leads integer, purchased integer, revenue numeric, lost_competitor integer, lost_not_interested integer, lost_no_response integer, lost_wrong_number integer, items_lost_competitor integer, at_fu1 integer, at_fu2 integer, at_fu3 integer, overdue integer, oldest_open_days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- §85.2. Every staff role except accounts, which is what is_staff() already is.
  if not app.is_staff() then
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

CREATE OR REPLACE FUNCTION public.analytics_by_institute(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
 RETURNS TABLE(institute_id uuid, institute_name text, leads integer, prev_leads integer, prev_closed integer, prev_purchased integer, prev_lost_competitor integer, closed integer, open_leads integer, purchased integer, revenue numeric, lost_competitor integer, lost_not_interested integer, lost_no_response integer, lost_wrong_number integer, items_lost_competitor integer, at_fu1 integer, at_fu2 integer, at_fu3 integer, overdue integer, oldest_open_days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- §85.2. Every staff role except accounts, which is what is_staff() already is.
  if not app.is_staff() then
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

CREATE OR REPLACE FUNCTION public.analytics_by_teacher(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
 RETURNS TABLE(teacher_id uuid, teacher_name text, institute_id uuid, institute_name text, leads integer, prev_leads integer, prev_closed integer, prev_purchased integer, prev_lost_competitor integer, closed integer, open_leads integer, purchased integer, revenue numeric, lost_competitor integer, lost_not_interested integer, lost_no_response integer, lost_wrong_number integer, items_lost_competitor integer, at_fu1 integer, at_fu2 integer, at_fu3 integer, overdue integer, oldest_open_days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- §85.2. Every staff role except accounts, which is what is_staff() already is.
  if not app.is_staff() then
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

CREATE OR REPLACE FUNCTION public.analytics_products(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(product text, enquiries integer, purchased integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- §85.2. Every staff role except accounts, which is what is_staff() already is.
  if not app.is_staff() then
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

CREATE OR REPLACE FUNCTION public.analytics_scope(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out jsonb;
begin
  -- §85.2. Every staff role except accounts, which is what is_staff() already is.
  if not app.is_staff() then
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

CREATE OR REPLACE FUNCTION public.analytics_experiments()
 RETURNS TABLE(id uuid, note text, metric_note text, scope_type text, scope_id uuid, scope_label text, start_date date, end_date date, created_by uuid, author text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- §85.2. Every staff role except accounts, which is what is_staff() already is.
  if not app.is_staff() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  select e.id, e.note, e.metric_note, e.scope_type, e.scope_id,
         case e.scope_type
           when 'all' then 'Everyone'
           when 'teacher' then coalesce((select t.name from public.teachers t where t.id = e.scope_id), 'a teacher')
           when 'institute' then coalesce((select i.name from public.institutes i where i.id = e.scope_id), 'an institute')
           -- The subject names the pair: subjects belong to exactly one course, so
           -- one id addresses "CA Final · Audit" without a second column.
           when 'course_subject' then coalesce(
             (select co.name || ' · ' || sj.name
                from public.subjects sj join public.courses co on co.id = sj.course_id
               where sj.id = e.scope_id), 'a course and subject')
         end,
         e.start_date, e.end_date, e.created_by,
         (select p.full_name from public.profiles p where p.id = e.created_by)
    from public.analytics_events e
   order by e.start_date desc, e.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.analytics_experiment_result(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_e      record;
  v_start  date;
  v_end    date;
  v_len    integer;
  v_bfrom  date;
  v_bto    date;
begin
  -- §85.2. Every staff role except accounts, which is what is_staff() already is.
  if not app.is_staff() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  select * into v_e from public.analytics_events where id = p_id;
  if v_e.id is null then return 'null'::jsonb; end if;

  v_start := v_e.start_date;
  v_end   := least(coalesce(v_e.end_date, app.ist_today()), app.ist_today());
  -- A start in the future has no elapsed window at all; one day, so the card can
  -- say "nothing yet" rather than divide by a negative length.
  v_end   := greatest(v_end, v_start);
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
    'live', v_e.end_date is null or v_e.end_date >= app.ist_today(),
    'dayN', greatest((app.ist_today() - v_start) + 1, 0),
    'dayM', case when v_e.end_date is not null then (v_e.end_date - v_start) + 1 end,
    'beforeFrom', v_bfrom, 'beforeTo', v_bto,
    'duringFrom', v_start, 'duringTo', v_end,
    'before', app.analytics_totals(v_bfrom, v_bto, null, null, null, null, null,
                                   v_e.scope_type, v_e.scope_id, false),
    'during', app.analytics_totals(v_start, v_end, null, null, null, null, null,
                                   v_e.scope_type, v_e.scope_id, false),
    'rest',   case when v_e.scope_type <> 'all'
                   then app.analytics_totals(v_start, v_end, null, null, null, null, null,
                                             v_e.scope_type, v_e.scope_id, true) end,
    'restBefore', case when v_e.scope_type <> 'all'
                   then app.analytics_totals(v_bfrom, v_bto, null, null, null, null, null,
                                             v_e.scope_type, v_e.scope_id, true) end
  );
end;
$function$;


-- §85.2. The events bar follows the page that shows it.
--
-- analytics_events was admin-only to read, which would have left every counsellor
-- looking at a comparison with no sight of what changed during it — the one thing the
-- bar exists to supply. Reading widens with the page; writing does not, and
-- Settings → Analytics events keeps its own admin gate on the route and in both
-- actions.
drop policy if exists analytics_events_select on public.analytics_events;
create policy analytics_events_select on public.analytics_events
  for select using ((select app.is_staff()));

-- ---------------------------------------------------------------------------
-- §85.3. Ageing ignores future-dated tickets.
-- ---------------------------------------------------------------------------
--
-- A ticket parked to a later date is not ageing — somebody decided it waits, and
-- counting the wait as age made the over-3-days roll-up read as a backlog when part
-- of it was a plan. The four bands and the roll-up now exclude status 'future', and
-- the count of those tickets comes back as its own bucket so the page can show it
-- beside the bands rather than silently dropping them.
--
-- 'future-dated' is deliberately not a fifth band: the four still partition the
-- tickets they describe and still sum to the open total less this number, which is
-- what the section's note now says.
create or replace function support.report_ageing(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (bucket text, n integer)
language sql
stable
set search_path to ''
as $function$
with open as (
  select support.age_days(t.raised_at) as age, t.status
    from support.tickets t
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
),
ageing as (select age from open where status <> 'future')
select b.bucket, count(o.age)::integer
  from (values ('0-3'), ('4-5'), ('6-10'), ('over-10')) as b(bucket)
  left join ageing o
    on b.bucket = case
                    when o.age <= 3  then '0-3'
                    when o.age <= 5  then '4-5'
                    when o.age <= 10 then '6-10'
                    else 'over-10'
                  end
 group by b.bucket
union all
-- The roll-up the team chases. Deliberately overlaps the bands above, and like
-- them it is about tickets nobody has parked.
select 'over-3', count(*)::integer from ageing where age > 3
union all
-- §85.3. Not a band: the tickets the bands exclude, counted so the exclusion is
-- visible on screen rather than only true in the SQL.
select 'future-dated', count(*)::integer from open where status = 'future';
$function$;

grant execute on function support.report_ageing(date, date, uuid, uuid, text[])
  to authenticated, service_role;

notify pgrst, 'reload schema';
