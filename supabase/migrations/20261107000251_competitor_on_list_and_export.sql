-- §89. The Enquiries list, its facets and the export learn the competitor.
--
-- All three DROP and recreate rather than CREATE OR REPLACE: two gain
-- arguments and two gain a returns-table column, and a replace cannot change
-- either. The bodies are otherwise the §87 ones, patched in place.

drop function if exists public.enquiries_table(enquiry_type, enquiry_status, lost_reason, close_reason, uuid, uuid[], uuid, uuid, uuid[], uuid, uuid, importance[], date, date, date, date, text, text, text, text, integer, integer, boolean, text[], date, date, uuid[], uuid[], text);

CREATE OR REPLACE FUNCTION public.enquiries_table(p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_lost_reason lost_reason DEFAULT NULL::lost_reason, p_close_reason close_reason DEFAULT NULL::close_reason, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_include_archived boolean DEFAULT false, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_called_by uuid[] DEFAULT NULL::uuid[], p_source_ids uuid[] DEFAULT NULL::uuid[], p_basis text DEFAULT NULL::text, p_competitor_ids uuid[] DEFAULT NULL::uuid[], p_competitor_other text DEFAULT NULL::text)
 RETURNS TABLE(enquiry_id bigint, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, lost_reason lost_reason, close_reason close_reason, importance importance, lead_verification lead_verification, term_name text, source_name text, product_text text, next_follow_up_date date, fresh_call_date date, follow_up_slots_used smallint, created_at timestamp with time zone, arrived_at timestamp with time zone, closed_at timestamp with time zone, item_count integer, teacher_names text, last_call_at timestamp with time zone, last_outcome call_outcome, last_discussion text, assigned_to_name text, assigned_date date, competitor_name text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with args as (
  -- §54.4. One flag, read in three places, so the two date tests cannot end up
  -- disagreeing about which of them is in force.
  select (p_called_by is not null and cardinality(p_called_by) > 0) as by_caller
),
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.outcome, c.discussion
    from public.calls c
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
last_assignment as (
  select distinct on (a.enquiry_id)
         a.enquiry_id, a.date, a.counsellor_id
    from public.assignments a
   order by a.enquiry_id, a.date desc
),
base as (
  select
    e.id as enquiry_id,
    e.student_id,
    s.mobile,
    s.name as student_name,
    e.type,
    e.status,
    e.lost_reason,
    e.close_reason,
    e.importance,
    e.lead_verification,
    tm.name as term_name,
    src.name as source_name,
    e.product_text,
    e.next_follow_up_date,
    e.fresh_call_date,
    e.follow_up_slots_used,
    e.created_at,
    coalesce(e.arrived_at, e.created_at) as arrived_at,
    e.closed_at,
    (select count(*)::integer from public.enquiry_items i where i.enquiry_id = e.id)
      as item_count,
    (select string_agg(distinct tch.name, ', ' order by tch.name)
       from public.enquiry_items i
       join public.teachers tch on tch.id = i.teacher_id
      where i.enquiry_id = e.id) as teacher_names,
    lc.called_at as last_call_at,
    lc.outcome as last_outcome,
    lc.discussion as last_discussion,
    pr.full_name as assigned_to_name,
    la.date as assigned_date,
    -- §89. "Competitor · SLD" on the list needs the name, not the id, and a
    -- typed name reads the same way — the column says who, however it was
    -- recorded.
    coalesce(cmp.name, e.competitor_other) as competitor_name,
    case p_sort
      when 'id'                  then e.id::numeric
      when 'created_at'          then extract(epoch from coalesce(e.arrived_at, e.created_at))
      when 'next_follow_up_date' then extract(epoch from e.next_follow_up_date::timestamp)
      when 'last_call_at'        then extract(epoch from lc.called_at)
      when 'slots'               then e.follow_up_slots_used::numeric
    end as sort_num,
    case p_sort
      when 'mobile'       then s.mobile
      when 'student_name' then s.name
      when 'status'       then e.status::text
      when 'importance'   then e.importance::text
      when 'type'         then e.type::text
    end as sort_txt
  from public.enquiries e
  cross join args
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  left join last_call lc on lc.enquiry_id = e.id
  left join last_assignment la on la.enquiry_id = e.id
  left join public.profiles pr on pr.id = la.counsellor_id
  left join public.competitors cmp on cmp.id = e.competitor_id
  where (p_include_archived or e.archived_at is null)
    and (p_type is null or e.type = p_type)
    and (p_status is null or e.status = p_status)
    and (p_lost_reason is null or e.lost_reason = p_lost_reason)
    and (p_close_reason is null or e.close_reason = p_close_reason)
    and (p_counsellor_id is null or la.counsellor_id = p_counsellor_id)
    and (p_term_id is null or e.term_id = p_term_id)
                  and (
                   -- §85.1. Either form, so a link carrying the old single source
                   -- keeps working and the new multi-select is additive.
                   (p_source_id is null
                    and (p_source_ids is null or cardinality(p_source_ids) = 0))
                   or (p_source_id is not null and e.source_id = p_source_id)
                   or (p_source_ids is not null and cardinality(p_source_ids) > 0
                       and e.source_id = any (p_source_ids))
                 )
    and (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance))
    and (p_mobile is null or s.mobile like '%' || p_mobile || '%')
    -- §54.4. The arrival window applies only when nobody is named in
    -- "Called by". When somebody is, the window below is the call window and
    -- this one would be a second, contradictory question.
    and (args.by_caller or p_created_from is null
         or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (args.by_caller or p_created_to is null
         or (coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date <= p_created_to)
    -- §89. Which competitor took the lead. Two keys because the answer is one
    -- of two columns: a listed competitor, or a name somebody typed. Both
    -- narrow, and an id list that happens to be empty narrows nothing — the
    -- same shape every other multi-select filter here has.
    and ((p_competitor_ids is null or cardinality(p_competitor_ids) = 0)
         or e.competitor_id = any (p_competitor_ids))
    and (p_competitor_other is null or e.competitor_other = p_competitor_other)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
    and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
    -- §86. The analytics basis, resolved with the same expression app.analytics_leads
    -- uses. Null or 'any' adds no open/closed restriction.
    and (p_basis is null or p_basis = 'any'
         or coalesce(e.status in ('won','lost') or e.close_reason = 'wrong_number', false)
            = (p_basis = 'closed'))
    -- Outside every analytics denominator, so outside every basis — 'any' included,
    -- which is what lets the Total cell tie.
    and (p_basis is null
         or not (e.status = 'closed'
                 and e.close_reason in ('handed_to_support', 'superseded')))
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
    and ((p_stages is null or cardinality(p_stages) = 0) or app.enquiry_stage(e.fresh_call_date, e.follow_up_slots_used, lc.outcome)
         = any (p_stages))
    and (p_last_called_from is null or e.last_slot_date >= p_last_called_from)
    and (p_last_called_to is null or e.last_slot_date <= p_last_called_to)
    and (p_discussion is null or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.discussion ilike '%' || p_discussion || '%'))
    and (not args.by_caller or exists (
          select 1 from public.calls c
           where c.enquiry_id = e.id
             and c.called_by = any (p_called_by)
             and (p_created_from is null or c.call_date >= p_created_from)
             and (p_created_to is null or c.call_date <= p_created_to)))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.type, b.status,
  b.lost_reason, b.close_reason, b.importance, b.lead_verification,
  b.term_name, b.source_name, b.product_text, b.next_follow_up_date,
  b.fresh_call_date, b.follow_up_slots_used, b.created_at, b.arrived_at, b.closed_at,
  b.item_count, b.teacher_names, b.last_call_at, b.last_outcome,
  b.last_discussion, b.assigned_to_name, b.assigned_date, b.competitor_name,
  count(*) over () as total_count
from base b
order by
  case when lower(coalesce(p_dir, 'desc')) = 'asc'  then b.sort_num end asc  nulls last,
  case when lower(coalesce(p_dir, 'desc')) <> 'asc' then b.sort_num end desc nulls last,
  case when lower(coalesce(p_dir, 'desc')) = 'asc'  then b.sort_txt end asc  nulls last,
  case when lower(coalesce(p_dir, 'desc')) <> 'asc' then b.sort_txt end desc nulls last,
  b.enquiry_id desc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$
;

grant execute on function public.enquiries_table to authenticated;

drop function if exists public.enquiries_called_by_facets(enquiry_type, enquiry_status, lost_reason, close_reason, uuid, uuid[], uuid, uuid, uuid[], uuid, uuid, importance[], date, date, date, date, text, text, boolean, text[], date, date, uuid[], uuid[], text);

CREATE OR REPLACE FUNCTION public.enquiries_called_by_facets(p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_lost_reason lost_reason DEFAULT NULL::lost_reason, p_close_reason close_reason DEFAULT NULL::close_reason, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text, p_include_archived boolean DEFAULT false, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_called_by uuid[] DEFAULT NULL::uuid[], p_source_ids uuid[] DEFAULT NULL::uuid[], p_basis text DEFAULT NULL::text, p_competitor_ids uuid[] DEFAULT NULL::uuid[], p_competitor_other text DEFAULT NULL::text)
 RETURNS TABLE(facet text, value_id text, numbers integer, items integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with args as (
  select (p_called_by is not null and cardinality(p_called_by) > 0) as by_caller
),
last_call as (
  select distinct on (c.enquiry_id) c.enquiry_id, c.outcome
    from public.calls c
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
last_assignment as (
  select distinct on (a.enquiry_id) a.enquiry_id, a.counsellor_id
    from public.assignments a
   order by a.enquiry_id, a.date desc
),
in_window as (
  select c.enquiry_id, c.called_by, count(*)::integer as calls
    from public.calls c
   where (p_created_from is null or c.call_date >= p_created_from)
     and (p_created_to is null or c.call_date <= p_created_to)
   group by c.enquiry_id, c.called_by
),
-- Everything except the two date tests and the caller test.
cand as materialized (
  select e.id,
         ((coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date) as arrival
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
                   and (
                   -- §85.1. Either form, so a link carrying the old single source
                   -- keeps working and the new multi-select is additive.
                   (p_source_id is null
                    and (p_source_ids is null or cardinality(p_source_ids) = 0))
                   or (p_source_id is not null and e.source_id = p_source_id)
                   or (p_source_ids is not null and cardinality(p_source_ids) > 0
                       and e.source_id = any (p_source_ids))
                 )
     and (p_importance is null or cardinality(p_importance) = 0 or e.importance = any (p_importance))
     and (p_mobile is null or s.mobile like '%' || p_mobile || '%')
     -- §89. Which competitor took the lead. Two keys because the answer is one
    -- of two columns: a listed competitor, or a name somebody typed. Both
    -- narrow, and an id list that happens to be empty narrows nothing — the
    -- same shape every other multi-select filter here has.
    and ((p_competitor_ids is null or cardinality(p_competitor_ids) = 0)
         or e.competitor_id = any (p_competitor_ids))
    and (p_competitor_other is null or e.competitor_other = p_competitor_other)
    and (p_follow_up_from is null or e.next_follow_up_date >= p_follow_up_from)
     and (p_follow_up_to is null or e.next_follow_up_date <= p_follow_up_to)
     -- §86. The analytics basis, resolved with the same expression app.analytics_leads
    -- uses. Null or 'any' adds no open/closed restriction.
    and (p_basis is null or p_basis = 'any'
         or coalesce(e.status in ('won','lost') or e.close_reason = 'wrong_number', false)
            = (p_basis = 'closed'))
    -- Outside every analytics denominator, so outside every basis — 'any' included,
    -- which is what lets the Total cell tie.
    and (p_basis is null
         or not (e.status = 'closed'
                 and e.close_reason in ('handed_to_support', 'superseded')))
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
),
-- What picking "All" would give: the arrival window back in force.
by_arrival as (
  select c.id from cand c
   where (p_created_from is null or c.arrival >= p_created_from)
     and (p_created_to is null or c.arrival <= p_created_to)
)
select 'called_by'::text, w.called_by::text,
       count(distinct w.enquiry_id)::integer, sum(w.calls)::integer
  from cand c
  join in_window w on w.enquiry_id = c.id
 group by w.called_by
union all
select 'called_by'::text, '__all__'::text, count(*)::integer, count(*)::integer
  from by_arrival
union all
select '_total'::text, null::text, count(*)::integer, count(*)::integer
  from cand c, args
 where case
         when args.by_caller then exists (
           select 1 from in_window w
            where w.enquiry_id = c.id and w.called_by = any (p_called_by))
         else (p_created_from is null or c.arrival >= p_created_from)
              and (p_created_to is null or c.arrival <= p_created_to)
       end;
$function$
;

grant execute on function public.enquiries_called_by_facets to authenticated;

drop function if exists public.export_enquiries(bigint[]);

CREATE OR REPLACE FUNCTION public.export_enquiries(p_ids bigint[])
 RETURNS TABLE(enquiry_id bigint, mobile text, student_name text, type enquiry_type, status enquiry_status, lost_reason lost_reason, close_reason close_reason, importance importance, lead_verification lead_verification, term_name text, source_name text, product_text text, teachers text, courses text, subjects text, contents text, item_statuses text, order_ids text, amount_total numeric, next_follow_up_date date, fresh_call_date date, follow_up_slots_used smallint, last_call_at timestamp with time zone, last_outcome call_outcome, last_discussion text, assigned_to_name text, assigned_date date, assignment_label text, competitor text, arrived_at timestamp with time zone, created_at timestamp with time zone, closed_at timestamp with time zone)
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
  -- §89. Who took the lead, when it was lost to one. Beside the arrival and
  -- creation stamps rather than next to the lost reason, because the sheet's
  -- column order is append-only: a reader with last month's file open should
  -- find the same columns in the same places plus the new one at the end.
  coalesce(cmp.name, e.competitor_other),
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
left join public.competitors cmp on cmp.id = e.competitor_id
left join items it on it.enquiry_id = e.id
left join last_call lc on lc.enquiry_id = e.id
left join last_assignment la on la.enquiry_id = e.id
left join public.profiles pr on pr.id = la.counsellor_id
where e.id in (select id from wanted)
order by e.id;
$function$
;

grant execute on function public.export_enquiries to authenticated;
