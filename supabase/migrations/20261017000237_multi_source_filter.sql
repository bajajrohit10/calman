-- §85.1. Source becomes a multi-select.
--
-- "Which sources" is a question with more than one answer — AC and Interakt are two
-- feeds of the same kind of lead and a counsellor comparing them had to look twice.
-- The control already exists: Teacher on the same bar is a MultiSelect, and New Calls
-- has carried `p_source_ids` since Brief 17. This brings Enquiries, the Assignment
-- Desk and Analytics onto the same shape.
--
-- Two different changes below, because the two families are in different states:
--
--   * recommended_calls and recommended_facets — the Assignment Desk — already take
--     both p_source_id and p_source_ids. Nothing to do in SQL; the desk's TS simply
--     was not passing the array. No migration touches them.
--   * enquiries_table and enquiries_called_by_facets take only the singular. They
--     gain p_source_ids at the end of the argument list and a predicate that accepts
--     either, which is the shape recommended_calls already uses — kept identical on
--     purpose so there is one way this reads across the codebase.
--   * The analytics family is replaced outright: p_source_id becomes p_source_ids,
--     because the only callers are this project's own and a legacy parameter nobody
--     passes is a thing to explain later rather than keep.
--
-- Postgres cannot add a parameter with CREATE OR REPLACE, so each of these is a drop
-- and a recreate of the live definition with the predicate patched.

drop function if exists public.enquiries_table(p_type enquiry_type, p_status enquiry_status, p_lost_reason lost_reason, p_close_reason close_reason, p_counsellor_id uuid, p_teacher_ids uuid[], p_course_id uuid, p_subject_id uuid, p_content_ids uuid[], p_term_id uuid, p_source_id uuid, p_importance importance[], p_created_from date, p_created_to date, p_follow_up_from date, p_follow_up_to date, p_discussion text, p_mobile text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_include_archived boolean, p_stages text[], p_last_called_from date, p_last_called_to date, p_called_by uuid[]);

CREATE OR REPLACE FUNCTION public.enquiries_table(p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_lost_reason lost_reason DEFAULT NULL::lost_reason, p_close_reason close_reason DEFAULT NULL::close_reason, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_include_archived boolean DEFAULT false, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_called_by uuid[] DEFAULT NULL::uuid[], p_source_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(enquiry_id bigint, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, lost_reason lost_reason, close_reason close_reason, importance importance, lead_verification lead_verification, term_name text, source_name text, product_text text, next_follow_up_date date, fresh_call_date date, follow_up_slots_used smallint, created_at timestamp with time zone, arrived_at timestamp with time zone, closed_at timestamp with time zone, item_count integer, teacher_names text, last_call_at timestamp with time zone, last_outcome call_outcome, last_discussion text, assigned_to_name text, assigned_date date, total_count bigint)
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
  b.last_discussion, b.assigned_to_name, b.assigned_date,
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
$function$;

grant execute on function public.enquiries_table(p_type enquiry_type, p_status enquiry_status, p_lost_reason lost_reason, p_close_reason close_reason, p_counsellor_id uuid, p_teacher_ids uuid[], p_course_id uuid, p_subject_id uuid, p_content_ids uuid[], p_term_id uuid, p_source_id uuid, p_importance importance[], p_created_from date, p_created_to date, p_follow_up_from date, p_follow_up_to date, p_discussion text, p_mobile text, p_sort text, p_dir text, p_limit integer, p_offset integer, p_include_archived boolean, p_stages text[], p_last_called_from date, p_last_called_to date, p_called_by uuid[], uuid[]) to authenticated, service_role;

drop function if exists public.enquiries_called_by_facets(p_type enquiry_type, p_status enquiry_status, p_lost_reason lost_reason, p_close_reason close_reason, p_counsellor_id uuid, p_teacher_ids uuid[], p_course_id uuid, p_subject_id uuid, p_content_ids uuid[], p_term_id uuid, p_source_id uuid, p_importance importance[], p_created_from date, p_created_to date, p_follow_up_from date, p_follow_up_to date, p_discussion text, p_mobile text, p_include_archived boolean, p_stages text[], p_last_called_from date, p_last_called_to date, p_called_by uuid[]);

CREATE OR REPLACE FUNCTION public.enquiries_called_by_facets(p_type enquiry_type DEFAULT NULL::enquiry_type, p_status enquiry_status DEFAULT NULL::enquiry_status, p_lost_reason lost_reason DEFAULT NULL::lost_reason, p_close_reason close_reason DEFAULT NULL::close_reason, p_counsellor_id uuid DEFAULT NULL::uuid, p_teacher_ids uuid[] DEFAULT NULL::uuid[], p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_content_ids uuid[] DEFAULT NULL::uuid[], p_term_id uuid DEFAULT NULL::uuid, p_source_id uuid DEFAULT NULL::uuid, p_importance importance[] DEFAULT NULL::importance[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_follow_up_from date DEFAULT NULL::date, p_follow_up_to date DEFAULT NULL::date, p_discussion text DEFAULT NULL::text, p_mobile text DEFAULT NULL::text, p_include_archived boolean DEFAULT false, p_stages text[] DEFAULT NULL::text[], p_last_called_from date DEFAULT NULL::date, p_last_called_to date DEFAULT NULL::date, p_called_by uuid[] DEFAULT NULL::uuid[], p_source_ids uuid[] DEFAULT NULL::uuid[])
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
$function$;

grant execute on function public.enquiries_called_by_facets(p_type enquiry_type, p_status enquiry_status, p_lost_reason lost_reason, p_close_reason close_reason, p_counsellor_id uuid, p_teacher_ids uuid[], p_course_id uuid, p_subject_id uuid, p_content_ids uuid[], p_term_id uuid, p_source_id uuid, p_importance importance[], p_created_from date, p_created_to date, p_follow_up_from date, p_follow_up_to date, p_discussion text, p_mobile text, p_include_archived boolean, p_stages text[], p_last_called_from date, p_last_called_to date, p_called_by uuid[], uuid[]) to authenticated, service_role;

drop function if exists app.analytics_leads(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_id uuid, p_counsellor_id uuid, p_term_id uuid, p_scope_type text, p_scope_id uuid, p_scope_invert boolean);

CREATE OR REPLACE FUNCTION app.analytics_leads(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_ids uuid[] DEFAULT NULL::uuid[], p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
 RETURNS TABLE(enquiry_id bigint, status enquiry_status, lost_reason lost_reason, close_reason close_reason, term_id uuid, product_text text, called boolean, closed boolean, slots smallint, due date, created_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.id, e.status, e.lost_reason, e.close_reason, e.term_id, e.product_text,
         exists (select 1 from public.calls c where c.enquiry_id = e.id),
         -- §83.1. Null-safe: close_reason is NULL on every open lead, and
         -- `status in (...) or NULL` is NULL rather than false.
         coalesce(e.status in ('won', 'lost') or e.close_reason = 'wrong_number', false),
         coalesce(e.follow_up_slots_used, 0::smallint),
         e.next_follow_up_date,
         (e.created_at at time zone 'Asia/Kolkata')::date
    from public.enquiries e
   where e.type = 'purchase'
     and e.archived_at is null
     and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     and not (e.status = 'closed'
              and e.close_reason in ('handed_to_support', 'superseded'))
     and (p_source_ids is null or cardinality(p_source_ids) = 0
                            or e.source_id = any (p_source_ids))
     and (p_term_id is null or e.term_id = p_term_id)
     and (p_course_id is null or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.course_id = p_course_id))
     and (p_subject_id is null or exists (
           select 1 from public.enquiry_items i
            where i.enquiry_id = e.id and i.subject_id = p_subject_id))
     and (p_counsellor_id is null or exists (
           select 1 from public.calls c
            where c.enquiry_id = e.id and c.called_by = p_counsellor_id))
     -- §84.4. The scope, and its inverse. `<>` on the booleans is xor: invert
     -- flips the test without a second copy of it.
     and (coalesce(p_scope_type, 'all') = 'all'
          or p_scope_id is null
          or (coalesce(p_scope_invert, false) <> case p_scope_type
                when 'teacher' then exists (
                  select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.teacher_id = p_scope_id)
                when 'institute' then exists (
                  select 1 from public.enquiry_items i
                   join public.teachers t on t.id = i.teacher_id
                   where i.enquiry_id = e.id and t.institute_id = p_scope_id)
                when 'course_subject' then exists (
                  select 1 from public.enquiry_items i
                   where i.enquiry_id = e.id and i.subject_id = p_scope_id)
                else true
              end));
$function$;

grant execute on function app.analytics_leads(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_ids uuid[], p_counsellor_id uuid, p_term_id uuid, p_scope_type text, p_scope_id uuid, p_scope_invert boolean) to authenticated, service_role;

drop function if exists app.analytics_totals(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_id uuid, p_counsellor_id uuid, p_term_id uuid, p_scope_type text, p_scope_id uuid, p_scope_invert boolean);

CREATE OR REPLACE FUNCTION app.analytics_totals(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_ids uuid[] DEFAULT NULL::uuid[], p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_ids, p_counsellor_id, p_term_id,
                                      p_scope_type, p_scope_id, p_scope_invert)
  ),
  wonitem as (
    select i.* from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.status = 'won'
  )
  select jsonb_build_object(
    'leads',              (select count(*) from cur),
    'open',               (select count(*) from cur where not closed),
    'closed',             (select count(*) from cur where closed),
    'purchased',          (select count(*) from cur where status = 'won'),
    'lostCompetitor',     (select count(*) from cur where status = 'lost' and lost_reason = 'competitor'),
    'lostNotInterested',  (select count(*) from cur where status = 'lost' and lost_reason = 'not_interested'),
    'lostNoResponse',     (select count(*) from cur where status = 'lost' and lost_reason = 'max_followups'),
    'lostWrongNumber',    (select count(*) from cur where coalesce(close_reason = 'wrong_number', false)),
    'closedOther',        (select count(*) from cur
                            where closed and status <> 'won'
                              and not (status = 'lost' and lost_reason in ('competitor','not_interested','max_followups'))
                              and not coalesce(close_reason = 'wrong_number', false)),
    'revenue',            (select coalesce(sum(i.amount), 0) from wonitem i),
    'wonItems',           (select count(*) from wonitem),
    'wonItemsNoAmount',   (select count(*) from wonitem where amount is null),
    'purchasedAnyLine',   (select count(distinct i.enquiry_id) from wonitem i),
    'atFollowUp1',        (select count(*) from cur where not closed and slots = 0),
    'atFollowUp2',        (select count(*) from cur where not closed and slots = 1),
    'atFollowUp3',        (select count(*) from cur where not closed and slots >= 2),
    'overdue',            (select count(*) from cur where not closed and due < app.ist_today()),
    'oldestOpenDays',     (select coalesce(max(app.ist_today() - created_on), 0) from cur where not closed),
    'called',             (select count(*) from cur where called),
    'uncalled',           (select count(*) from cur where not called),
    'lostTotal',          (select count(*) from cur where status = 'lost')
  );
$function$;

grant execute on function app.analytics_totals(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_ids uuid[], p_counsellor_id uuid, p_term_id uuid, p_scope_type text, p_scope_id uuid, p_scope_invert boolean) to authenticated, service_role;

drop function if exists public.analytics_scope(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_id uuid, p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid);

CREATE OR REPLACE FUNCTION public.analytics_scope(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_ids uuid[] DEFAULT NULL::uuid[], p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid)
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
                                      p_source_ids, p_counsellor_id, p_term_id,
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
                                 p_source_ids, p_counsellor_id, p_term_id,
                                 p_scope_type, p_scope_id, false),
    'prev', case when p_cmp_from is not null and p_cmp_to is not null
                 then app.analytics_totals(p_cmp_from, p_cmp_to, p_course_id, p_subject_id,
                                           p_source_ids, p_counsellor_id, p_term_id,
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

grant execute on function public.analytics_scope(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_ids uuid[], p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid) to authenticated, service_role;

drop function if exists public.analytics_by_teacher(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_id uuid, p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid, p_scope_invert boolean);

CREATE OR REPLACE FUNCTION public.analytics_by_teacher(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_ids uuid[] DEFAULT NULL::uuid[], p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
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

grant execute on function public.analytics_by_teacher(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_ids uuid[], p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid, p_scope_invert boolean) to authenticated, service_role;

drop function if exists public.analytics_by_institute(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_id uuid, p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid, p_scope_invert boolean);

CREATE OR REPLACE FUNCTION public.analytics_by_institute(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_ids uuid[] DEFAULT NULL::uuid[], p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
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

grant execute on function public.analytics_by_institute(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_ids uuid[], p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid, p_scope_invert boolean) to authenticated, service_role;

drop function if exists public.analytics_by_course(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_id uuid, p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid, p_scope_invert boolean);

CREATE OR REPLACE FUNCTION public.analytics_by_course(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_ids uuid[] DEFAULT NULL::uuid[], p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_cmp_from date DEFAULT NULL::date, p_cmp_to date DEFAULT NULL::date, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_scope_invert boolean DEFAULT false)
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
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id, p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
  ),
  prv as (
    select * from app.analytics_leads(
             coalesce(p_cmp_from, date '0001-01-01'),
             coalesce(p_cmp_to, date '0001-01-01'), p_course_id, p_subject_id, p_source_ids, p_counsellor_id, p_term_id, p_scope_type, p_scope_id, p_scope_invert)
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

grant execute on function public.analytics_by_course(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_ids uuid[], p_counsellor_id uuid, p_term_id uuid, p_cmp_from date, p_cmp_to date, p_scope_type text, p_scope_id uuid, p_scope_invert boolean) to authenticated, service_role;

drop function if exists public.analytics_products(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_id uuid, p_counsellor_id uuid, p_term_id uuid, p_scope_type text, p_scope_id uuid, p_limit integer);

CREATE OR REPLACE FUNCTION public.analytics_products(p_from date, p_to date, p_course_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_source_ids uuid[] DEFAULT NULL::uuid[], p_counsellor_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_scope_type text DEFAULT 'all'::text, p_scope_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
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
                                      p_source_ids, p_counsellor_id, p_term_id,
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

grant execute on function public.analytics_products(p_from date, p_to date, p_course_id uuid, p_subject_id uuid, p_source_ids uuid[], p_counsellor_id uuid, p_term_id uuid, p_scope_type text, p_scope_id uuid, p_limit integer) to authenticated, service_role;


notify pgrst, 'reload schema';
