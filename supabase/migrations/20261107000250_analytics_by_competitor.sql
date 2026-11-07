-- §89. Analytics → Competitors.
--
-- Same shape as the other three demand functions: the window, the filters and
-- the comparison arrive identically, the rows come out of app.analytics_leads,
-- and the role check is is_staff() so the gate survives a direct RPC call.
--
-- Two functions rather than one with a grain argument. The table is one row
-- per competitor; the expansion is one row per (competitor, teacher) and per
-- (competitor, institute), and asking for those separately per expanded row
-- would be a read per click. The Competitors tab asks once.

-- Dropped first: both gained a row_key column after the first cut of this
-- migration, and a replace cannot change a returns table.
drop function if exists public.analytics_by_competitor(date, date, uuid, uuid, uuid[], uuid, uuid, date, date, text, uuid, boolean);
drop function if exists public.analytics_competitor_splits(date, date, uuid, uuid, uuid[], uuid, uuid, text, uuid, boolean);

create or replace function public.analytics_by_competitor(
  p_from date,
  p_to date,
  p_course_id uuid default null,
  p_subject_id uuid default null,
  p_source_ids uuid[] default null,
  p_counsellor_id uuid default null,
  p_term_id uuid default null,
  p_cmp_from date default null,
  p_cmp_to date default null,
  p_scope_type text default 'all',
  p_scope_id uuid default null,
  p_scope_invert boolean default false
) returns table (
  row_key text,
  competitor_id uuid,
  competitor_name text,
  other_name text,
  lost_leads integer,
  prev_lost_leads integer
)
language plpgsql
stable security definer
set search_path to ''
as $fn$
begin
  if not app.is_staff() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
             p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id,
             p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
     where p_cmp_from is not null and p_cmp_to is not null
  ),
  -- The competitor is a column on the lead, so unlike the teacher tables there
  -- is no fan-out here: every row counts each lead exactly once, and the column
  -- sums to the window's own competitor losses.
  cur_lost as (
    select e.competitor_id, e.competitor_other
      from cur c join public.enquiries e on e.id = c.enquiry_id
     where c.status = 'lost' and c.lost_reason = 'competitor'
  ),
  prv_lost as (
    select e.competitor_id, e.competitor_other
      from prv p join public.enquiries e on e.id = p.enquiry_id
     where p.status = 'lost' and p.lost_reason = 'competitor'
  ),
  -- One text key per row, because exactly one of the two columns is set. It
  -- exists so the two windows can be joined on plain equality: Postgres will
  -- not plan a FULL JOIN whose condition is `is not distinct from`, and a pair
  -- of nullable columns has no other honest join condition.
  now_n as (
    select coalesce(l.competitor_id::text, 'other:' || l.competitor_other, 'unrecorded') as k,
           l.competitor_id as cid, l.competitor_other as other, count(*) as n
      from cur_lost l group by 1, 2, 3
  ),
  prev_n as (
    select coalesce(l.competitor_id::text, 'other:' || l.competitor_other, 'unrecorded') as k,
           l.competitor_id as cid, l.competitor_other as other, count(*) as n
      from prv_lost l group by 1, 2, 3
  ),
  -- Every key from either window, so a competitor that lost leads only in the
  -- comparison window still gets a row: "was 6, now none" is the move worth
  -- seeing, and an inner join would silently drop it.
  keys as (
    select k,
           (array_agg(cid) filter (where cid is not null))[1] as cid,
           (array_agg(other) filter (where other is not null))[1] as other
      from (
      select k, cid, other from now_n
      union all
      select k, cid, other from prev_n
    ) u group by k
  )
  select k.k,
         k.cid,
         c.name,
         k.other,
         coalesce(n.n, 0)::integer,
         coalesce(p.n, 0)::integer
    from keys k
    left join now_n n on n.k = k.k
    left join prev_n p on p.k = k.k
    left join public.competitors c on c.id = k.cid
   order by coalesce(n.n, 0) desc, coalesce(c.name, k.other);
end $fn$;

grant execute on function public.analytics_by_competitor to authenticated;

/*
 * §89. One competitor row, broken down by teacher and by institute.
 *
 * A lead names one competitor and can name several teachers, so these counts
 * fan out: a lead with two teachers appears under both and the breakdown sums
 * to more than the row it expands. That is the same arithmetic the teacher
 * table has always had, and the screen says so rather than hiding it.
 *
 * A null dim_id is the lead that names nobody — kept rather than dropped, so
 * the expansion accounts for every lead in the row.
 */
create or replace function public.analytics_competitor_splits(
  p_from date,
  p_to date,
  p_course_id uuid default null,
  p_subject_id uuid default null,
  p_source_ids uuid[] default null,
  p_counsellor_id uuid default null,
  p_term_id uuid default null,
  p_scope_type text default 'all',
  p_scope_id uuid default null,
  p_scope_invert boolean default false
) returns table (
  row_key text,
  competitor_id uuid,
  other_name text,
  grain text,
  dim_id uuid,
  dim_name text,
  leads integer
)
language plpgsql
stable security definer
set search_path to ''
as $fn$
begin
  if not app.is_staff() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
             p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  lost as (
    select e.id, e.competitor_id, e.competitor_other
      from cur c join public.enquiries e on e.id = c.enquiry_id
     where c.status = 'lost' and c.lost_reason = 'competitor'
  ),
  by_teacher as (
    select l.competitor_id, l.competitor_other, 'teacher'::text as grain,
           i.teacher_id as dim_id, count(distinct l.id) as n
      from lost l
      left join (select distinct enquiry_id, teacher_id from public.enquiry_items
                  where teacher_id is not null) i on i.enquiry_id = l.id
     group by 1, 2, 3, 4
  ),
  by_institute as (
    select l.competitor_id, l.competitor_other, 'institute'::text as grain,
           i.institute_id as dim_id, count(distinct l.id) as n
      from lost l
      left join (select distinct it.enquiry_id, t.institute_id
                   from public.enquiry_items it
                   join public.teachers t on t.id = it.teacher_id
                  where t.institute_id is not null) i on i.enquiry_id = l.id
     group by 1, 2, 3, 4
  ),
  both_grains as (
    select * from by_teacher union all select * from by_institute
  )
  select coalesce(b.competitor_id::text, 'other:' || b.competitor_other, 'unrecorded'),
         b.competitor_id, b.competitor_other, b.grain, b.dim_id,
         case b.grain
           when 'teacher' then coalesce(t.name, 'No teacher')
           else coalesce(ins.name, 'No institute')
         end,
         b.n::integer
    from both_grains b
    left join public.teachers t on b.grain = 'teacher' and t.id = b.dim_id
    left join public.institutes ins on b.grain = 'institute' and ins.id = b.dim_id
   order by b.grain, b.n desc, 6;
end $fn$;

grant execute on function public.analytics_competitor_splits to authenticated;
