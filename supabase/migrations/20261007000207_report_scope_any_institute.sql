-- §75.1. The report scope matches any institute or teacher the ticket carries.
--
-- One predicate, shared by report_ageing, report_daily, report_open_by_due,
-- report_open_by_institute, report_open_by_issue, report_open_by_status,
-- report_institute_escalations, report_resolved_per_person and
-- report_time_to_resolve — so all nine follow from these two lines.
--
-- CREATE OR REPLACE: the signature is unchanged.

CREATE OR REPLACE FUNCTION support.in_report_scope(t support.tickets, p_from date, p_to date, p_institute_id uuid, p_teacher_id uuid, p_assigned_to text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select
    (p_from is null or (t.raised_at at time zone 'Asia/Kolkata')::date >= p_from)
    and (p_to is null or (t.raised_at at time zone 'Asia/Kolkata')::date <= p_to)
    -- §75.1. Any element, not the first. Nine report functions share this
    -- predicate, so a ticket spanning two houses now appears under both
    -- wherever it is scoped by one.
    and (p_institute_id is null or p_institute_id = any (t.institute_ids))
    and (p_teacher_id is null or p_teacher_id = any (t.teacher_ids))
    and (p_assigned_to is null or cardinality(p_assigned_to) = 0
         or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
         or (t.assigned_to is null and 'nobody' = any (p_assigned_to)));
$function$
;

notify pgrst, 'reload schema';
