-- §42.1 follow-up. The rewritten offer_match_count lost the defaults the five
-- target arguments used to carry. The form omits an empty target rather than
-- sending an empty array, and an omitted argument with no default is a
-- signature PostgREST cannot find — so the live count answered "Could not
-- count the matching leads" for every offer that targets fewer than five
-- things, which is all of them.
--
-- Defaults on every argument, so any subset of them names this function.

drop function if exists public.offer_match_count(uuid[], uuid[], uuid[], uuid[], uuid[], smallint, date);

create or replace function public.offer_match_count(
  p_teachers uuid[] default null,
  p_institutes uuid[] default null,
  p_courses uuid[] default null,
  p_subjects uuid[] default null,
  p_contents uuid[] default null,
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

grant execute on function public.offer_match_count(uuid[], uuid[], uuid[], uuid[], uuid[], smallint, date) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname = 'offer_match_count') <> 1 then
    raise exception 'offer_match_count: expected exactly one signature';
  end if;
end $$;
