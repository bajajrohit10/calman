-- §75.1. The institute reports count a ticket under each institute it carries.

CREATE OR REPLACE FUNCTION support.report_open_by_institute(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_institute_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_assigned_to text[] DEFAULT NULL::text[])
 RETURNS TABLE(institute_id uuid, institute_name text, n integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- §75.1. Once per institute the ticket carries, so one spanning two houses is
  -- a ticket for each of them. The totals therefore exceed the ticket count,
  -- which the screen says in as many words rather than leaving to be noticed.
  select x.institute_id,
         -- A ticket whose faculty text matched nothing is a real and useful
         -- row here: it is the queue of things nobody has filed yet.
         coalesce(i.name, 'Not matched') as institute_name,
         count(*)::integer
    from support.tickets t
    -- LEFT, not CROSS: a ticket carrying nothing still belongs under
    -- "Not matched", and an inner unnest would drop exactly the rows this
    -- report exists to surface.
    left join lateral unnest(
      case when cardinality(t.institute_ids) = 0 then array[null::uuid]
           else t.institute_ids end) as x(institute_id) on true
    left join public.institutes i on i.id = x.institute_id
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
   group by 1, 2
   order by 3 desc, 2;
$function$
;

CREATE OR REPLACE FUNCTION support.report_time_to_resolve(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_institute_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_assigned_to text[] DEFAULT NULL::text[])
 RETURNS TABLE(scope text, institute_id uuid, institute_name text, tickets integer, avg_days numeric, median_days numeric, min_days integer, max_days integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with done as (
  select x.institute_id,
         i.name as institute_name,
         ((t.resolved_at at time zone 'Asia/Kolkata')::date
          - (t.raised_at at time zone 'Asia/Kolkata')::date) as days
    from support.tickets t
    -- §75.1. Once per institute, as report_open_by_institute does.
    left join lateral unnest(
      case when cardinality(t.institute_ids) = 0 then array[null::uuid]
           else t.institute_ids end) as x(institute_id) on true
    left join public.institutes i on i.id = x.institute_id
   where t.parent_ticket_id is null
     and t.status = 'resolved'
     and t.resolved_at is not null
     and (p_from is null or (t.resolved_at at time zone 'Asia/Kolkata')::date >= p_from)
     and (p_to is null or (t.resolved_at at time zone 'Asia/Kolkata')::date <= p_to)
     and (p_institute_id is null or p_institute_id = any (t.institute_ids))
     and (p_teacher_id is null or p_teacher_id = any (t.teacher_ids))
     and (p_assigned_to is null or cardinality(p_assigned_to) = 0
          or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
          or (t.assigned_to is null and 'nobody' = any (p_assigned_to)))
)
select 'overall', null::uuid, null::text,
       count(*)::integer,
       round(avg(days)::numeric, 1),
       -- The median as well as the mean: one ticket that sat for three months
       -- drags an average of twenty a long way, and the team would rather know
       -- both than argue about which is fair.
       round(percentile_cont(0.5) within group (order by days)::numeric, 1),
       min(days)::integer, max(days)::integer
  from done
 having count(*) > 0
union all
select 'institute', d.institute_id, coalesce(d.institute_name, 'Not matched'),
       count(*)::integer,
       round(avg(days)::numeric, 1),
       round(percentile_cont(0.5) within group (order by days)::numeric, 1),
       min(days)::integer, max(days)::integer
  from done d
 group by d.institute_id, d.institute_name
 order by 1 desc, 4 desc, 3;
$function$
;

CREATE OR REPLACE FUNCTION support.report_institute_escalations(p_institute_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid, p_assigned_to text[] DEFAULT NULL::text[])
 RETURNS TABLE(id bigint, institute_id uuid, institute_name text, student_name text, mobile text, order_id text, raised_at timestamp with time zone, age_days integer, follow_up_date date, overdue boolean, assigned_to_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- §75.1. The institute the escalation names, not whichever is first. One row
  -- per ticket: an escalation goes to one house.
  select t.id, coalesce(t.escalated_institute_id, t.institute_ids[1]), i.name,
         t.student_name, t.mobile, coalesce(t.order_id_work, t.order_id),
         t.raised_at, support.age_days(t.raised_at),
         t.follow_up_date,
         (t.follow_up_date is not null and t.follow_up_date < app.ist_today()),
         p.full_name
    from support.tickets t
    left join public.institutes i
           on i.id = coalesce(t.escalated_institute_id, t.institute_ids[1])
    left join public.profiles p on p.id = t.assigned_to
   where t.parent_ticket_id is null
     and t.status = 'escalated'
     and t.escalation_kind = 'institute'
     and (p_institute_id is null or p_institute_id = any (t.institute_ids))
     and (p_teacher_id is null or p_teacher_id = any (t.teacher_ids))
     and (p_assigned_to is null or cardinality(p_assigned_to) = 0
          or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
          or (t.assigned_to is null and 'nobody' = any (p_assigned_to)))
   order by t.raised_at asc, t.id asc;
$function$
;

notify pgrst, 'reload schema';
