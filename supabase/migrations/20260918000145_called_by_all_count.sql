-- §7.2. A count behind "All".
--
-- The option was the only one in the list without one, so it read as empty
-- while being the widest thing you could pick. Emitted from the facet query
-- itself rather than derived in the page, because the number has to be the
-- candidate set this function saw and not one the client recomputed.
create or replace function public.enquiries_called_by_facets(
  p_type public.enquiry_type default null,
  p_status public.enquiry_status default null,
  p_lost_reason public.lost_reason default null,
  p_close_reason public.close_reason default null,
  p_counsellor_id uuid default null,
  p_teacher_ids uuid[] default null,
  p_course_id uuid default null,
  p_subject_id uuid default null,
  p_content_ids uuid[] default null,
  p_term_id uuid default null,
  p_source_id uuid default null,
  p_importance public.importance[] default null,
  p_created_from date default null,
  p_created_to date default null,
  p_follow_up_from date default null,
  p_follow_up_to date default null,
  p_discussion text default null,
  p_mobile text default null,
  p_include_archived boolean default false,
  p_stages text[] default null,
  p_last_called_from date default null,
  p_last_called_to date default null,
  p_called_by uuid[] default null
)
returns table (facet text, value_id text, numbers integer, items integer)
language sql
stable
set search_path to ''
as $function$
with last_call as (
  select distinct on (c.enquiry_id) c.enquiry_id, c.outcome
    from public.calls c
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
last_assignment as (
  select distinct on (a.enquiry_id) a.enquiry_id, a.counsellor_id
    from public.assignments a
   order by a.enquiry_id, a.date desc
),
-- Every (enquiry, caller) pair inside the window, once each. Counted as
-- "numbers" by distinct enquiry and as "items" by the calls themselves, so a
-- reader who wants "how many calls" can still have it.
in_window as (
  select c.enquiry_id, c.called_by, count(*)::integer as calls
    from public.calls c
   where (p_created_from is null or c.call_date >= p_created_from)
     and (p_created_to is null or c.call_date <= p_created_to)
   group by c.enquiry_id, c.called_by
),
cand as materialized (
  select e.id,
         ((p_called_by is null or cardinality(p_called_by) = 0) or exists (
            select 1 from in_window w
             where w.enquiry_id = e.id and w.called_by = any (p_called_by))) as m_called_by
    from public.enquiries e
    join public.students s on s.id = e.student_id
    left join last_call lc on lc.enquiry_id = e.id
    left join last_assignment la on la.enquiry_id = e.id
   where (p_include_archived or e.archived_at is null)
     and (p_type is null or e.type = p_type)
     and (p_status is null or e.status = p_status)
     and (p_lost_reason is null or e.lost_reason = p_lost_reason)
     and (p_close_reason is null or e.close_reason = p_close_reason)
     and (p_counsellor_id is null or la.counsellor_id = p_counsellor_id)
     and (p_term_id is null or e.term_id = p_term_id)
     and (p_source_id is null or e.source_id = p_source_id)
     and (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance))
     and (p_mobile is null or s.mobile like '%' || p_mobile || '%')
     and (p_created_from is null
          or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date >= p_created_from)
     and (p_created_to is null
          or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date <= p_created_to)
     and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
     and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
     and ((p_teacher_ids is null or cardinality(p_teacher_ids) = 0) or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.teacher_id = any (p_teacher_ids)))
     and (p_course_id is null or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.course_id = p_course_id))
     and (p_subject_id is null or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.subject_id = p_subject_id))
     and ((p_content_ids is null or cardinality(p_content_ids) = 0) or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.content_id = any (p_content_ids)))
     and ((p_stages is null or cardinality(p_stages) = 0)
          or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome) = any (p_stages))
     and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
     and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
     and (p_discussion is null or exists (
           select 1 from public.calls c
            where c.enquiry_id = e.id
              and c.discussion ilike '%' || p_discussion || '%'))
)
select 'called_by'::text, w.called_by::text,
       count(distinct w.enquiry_id)::integer, sum(w.calls)::integer
  from cand c
  join in_window w on w.enquiry_id = c.id
 group by w.called_by
union all
-- §7.2. "All" is an option like any other, so it carries a count like any
-- other: the candidate set with every filter except this one applied, which
-- is exactly what picking it would give you.
select 'called_by'::text, '__all__'::text, count(*)::integer, count(*)::integer
  from cand c
union all
select '_total'::text, null::text, count(*)::integer, count(*)::integer
  from cand c
 where c.m_called_by;
$function$;


notify pgrst, 'reload schema';
