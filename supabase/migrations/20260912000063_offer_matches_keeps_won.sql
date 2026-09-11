-- An offer must not forget the lead that bought.
--
-- public.offer_matches filtered to open interest lines, which is right for
-- every read that asks "who should we be calling" and wrong for the one that
-- asks "did this offer work". A purchase flips the line to won, the lead stops
-- matching, and offer_performance loses the conversion the offer caused —
-- reached, called and won all fell back to zero the moment somebody bought.
-- Measured on a seeded offer: reached 1 → 0 on the save.
--
-- So the view stops deciding. It carries the line's status and each caller
-- says which lines it means: the bucket and the "matches today" count want
-- open lines only, the performance funnel wants every line that ever matched.
-- One definition of "these targets match this line", two questions asked of
-- it.

create or replace view public.offer_matches with (security_invoker = true) as
select
  o.id   as offer_id,
  o.name as offer_name,
  greatest(o.start_date, o.end_date - o.reminder_days) as window_from,
  o.end_date,
  o.start_date,
  i.enquiry_id,
  i.id as item_id,
  -- Not a filter any more. A won line is what a working offer leaves behind.
  i.status as item_status
from public.offers o
join public.enquiry_items i on true
left join public.teachers tch on tch.id = i.teacher_id
where o.is_active
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
  'One row per offer and matching interest line (Brief 18). An offer with no '
  'targets in a dimension matches anything in it; teacher and institute are '
  'one dimension satisfied by either. item_status is carried rather than '
  'filtered: the bucket wants open lines, the performance funnel wants the '
  'won ones too.';

-- The three readers that mean "still to sell" say so for themselves.
do $$
declare
  fn record;
  src text;
  patched text;
begin
  for fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('recommended_calls', 'recommended_facets', 'my_day')
  loop
    src := pg_get_functiondef(fn.oid);
    patched := regexp_replace(
      src,
      '(and t\.d between om\.window_from and om\.end_date)',
      E'\\1\n       and om.item_status = ''open''',
      'g');

    if patched = src then
      raise exception 'no offer window predicate found in %', fn.proname;
    end if;

    execute patched;
  end loop;
end $$;

-- "Matches today" is about leads still to sell, so it keeps the open filter.
-- reached/called/won deliberately do not: they are the record of what the
-- offer did, and a lead that bought is the point.
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
      where om.offer_id = o.id
        and om.item_status = 'open'
        and e.status = 'open' and e.type = 'purchase'),
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

revoke all on function public.offer_performance from public;
grant execute on function public.offer_performance to authenticated;
