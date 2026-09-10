-- One flat row per enquiry, for export (§5.6 "export CSV/XLSX of the current
-- filtered view", and the same button on the Assignment Desk and My Day).
--
-- Addressed by id rather than by filters on purpose. The three screens select
-- their rows in genuinely different ways — the Desk and My Day through
-- recommended_calls() with its §6 bucketing, the Enquiries table through
-- enquiries_table() — so each one collects its own ids and then hands them
-- here. That is what keeps the exported columns identical everywhere instead
-- of three near-copies drifting apart.
--
-- SECURITY INVOKER: passing an id gets you nothing RLS would not already give.

create or replace function public.export_enquiries(p_ids bigint[])
returns table (
  enquiry_id bigint,
  mobile text,
  student_name text,
  type public.enquiry_type,
  status public.enquiry_status,
  lost_reason public.lost_reason,
  close_reason public.close_reason,
  importance public.importance,
  lead_verification public.lead_verification,
  term_name text,
  source_name text,
  product_text text,
  teachers text,
  courses text,
  subjects text,
  contents text,
  item_statuses text,
  order_ids text,
  amount_total numeric,
  next_follow_up_date date,
  fresh_call_date date,
  follow_up_slots_used smallint,
  last_call_at timestamptz,
  last_outcome public.call_outcome,
  last_discussion text,
  assigned_to_name text,
  assigned_date date,
  created_at timestamptz,
  closed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
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
         a.enquiry_id, a.date, a.counsellor_id
    from public.assignments a
   where a.enquiry_id in (select id from wanted)
   order by a.enquiry_id, a.date desc
),
-- Items flattened to one cell each, in a stable order so the columns line up
-- row by row: the third teacher goes with the third subject.
items as (
  select i.enquiry_id,
         string_agg(tch.name, ' | ' order by i.created_at, i.id) as teachers,
         string_agg(crs.name, ' | ' order by i.created_at, i.id) as courses,
         string_agg(coalesce(sub.name, '—'), ' | ' order by i.created_at, i.id) as subjects,
         string_agg(coalesce(cnt.name, '—'), ' | ' order by i.created_at, i.id) as contents,
         string_agg(i.status::text, ' | ' order by i.created_at, i.id) as item_statuses,
         string_agg(distinct i.order_id, ' | ') as order_ids,
         sum(i.amount) as amount_total
    from public.enquiry_items i
    join public.teachers tch on tch.id = i.teacher_id
    join public.courses crs on crs.id = i.course_id
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
$$;

comment on function public.export_enquiries is
  'Flat export shape for one set of enquiry ids. Shared by the Enquiries '
  'table, the Assignment Desk and My Day so all three export the same columns.';

revoke all on function public.export_enquiries(bigint[]) from public;
grant execute on function public.export_enquiries(bigint[]) to authenticated;
