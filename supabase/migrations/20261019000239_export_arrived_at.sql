-- §87. The enquiry export gains the arrival timestamp.
--
-- The list's first column is the arrival — coalesce(arrived_at, created_at) —
-- and since §86 that is also what its date filter windows on. The export
-- carried created_at alone, so a spreadsheet of "leads that came in on 10 Oct"
-- showed an import date of the 12th against rows the list had dated the 10th,
-- with nothing in the file to explain the difference.
--
-- DROP and recreate rather than CREATE OR REPLACE: the returns table gains a
-- column, and a replace cannot change the signature.

drop function if exists public.export_enquiries(bigint[]);

CREATE OR REPLACE FUNCTION public.export_enquiries(p_ids bigint[])
 RETURNS TABLE(enquiry_id bigint, mobile text, student_name text, type enquiry_type, status enquiry_status, lost_reason lost_reason, close_reason close_reason, importance importance, lead_verification lead_verification, term_name text, source_name text, product_text text, teachers text, courses text, subjects text, contents text, item_statuses text, order_ids text, amount_total numeric, next_follow_up_date date, fresh_call_date date, follow_up_slots_used smallint, last_call_at timestamp with time zone, last_outcome call_outcome, last_discussion text, assigned_to_name text, assigned_date date, assignment_label text, arrived_at timestamp with time zone, created_at timestamp with time zone, closed_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with wanted as (
  select unnest(p_ids) as id
),
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.outcome, c.discussion
    from public.calls c
   where c.enquiry_id in (select id from wanted)
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
last_assignment as (
  select distinct on (a.enquiry_id)
         a.enquiry_id, a.date, a.counsellor_id, a.label
    from public.assignments a
   where a.enquiry_id in (select id from wanted)
   order by a.enquiry_id, a.date desc
),
-- Items flattened to one cell each, in a stable order so the columns line up
-- row by row: the third teacher goes with the third subject.
items as (
  select i.enquiry_id,
         string_agg(coalesce(tch.name, 'No teacher'), ' | ' order by i.created_at, i.id) as teachers,
         string_agg(coalesce(crs.name, 'No course'), ' | ' order by i.created_at, i.id) as courses,
         string_agg(coalesce(sub.name, '—'), ' | ' order by i.created_at, i.id) as subjects,
         string_agg(coalesce(cnt.name, '—'), ' | ' order by i.created_at, i.id) as contents,
         string_agg(i.status::text, ' | ' order by i.created_at, i.id) as item_statuses,
         string_agg(distinct i.order_id, ' | ') as order_ids,
         sum(i.amount) as amount_total
    from public.enquiry_items i
    left join public.teachers tch on tch.id = i.teacher_id
    left join public.courses crs on crs.id = i.course_id
    left join public.subjects sub on sub.id = i.subject_id
    left join public.contents cnt on cnt.id = i.content_id
   where i.enquiry_id in (select id from wanted)
   group by i.enquiry_id
)
select
  e.id,
  s.mobile,
  s.name,
  e.type,
  e.status,
  e.lost_reason,
  e.close_reason,
  e.importance,
  e.lead_verification,
  tm.name,
  src.name,
  e.product_text,
  it.teachers,
  it.courses,
  it.subjects,
  it.contents,
  it.item_statuses,
  it.order_ids,
  it.amount_total,
  e.next_follow_up_date,
  e.fresh_call_date,
  e.follow_up_slots_used,
  lc.called_at,
  lc.outcome,
  lc.discussion,
  pr.full_name,
  la.date,
  la.label,
  -- §87. The arrival the list both shows and filters on, which for an
  -- abandoned-checkout lead is the checkout and not the import that wrote the
  -- row. Coalesced rather than raw: arrived_at is null on most rows, and a
  -- column that is blank nine times in ten reads as missing data rather than
  -- as "it arrived when it was created".
  coalesce(e.arrived_at, e.created_at),
  e.created_at,
  e.closed_at
from public.enquiries e
join public.students s on s.id = e.student_id
left join public.terms tm on tm.id = e.term_id
left join public.sources src on src.id = e.source_id
left join items it on it.enquiry_id = e.id
left join last_call lc on lc.enquiry_id = e.id
left join last_assignment la on la.enquiry_id = e.id
left join public.profiles pr on pr.id = la.counsellor_id
where e.id in (select id from wanted)
order by e.id;
$function$
;

grant execute on function public.export_enquiries to authenticated;
