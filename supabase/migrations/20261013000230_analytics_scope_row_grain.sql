-- §82.2. The footer's row count must be the grain the table actually groups by.
--
-- analytics_scope counted distinct (lead, course) and the footer printed it as
-- "N rows", but the Products table groups by (course, subject) — "CA Final ·
-- Direct Tax" and "CA Final · Audit" are two rows of one course. So the footer
-- claimed 413 while the column it was describing summed to 499, which is the
-- same class of mistake as the §81 footer that stopped its reconciliation one
-- step short: a number that does not describe the thing beside it.
--
-- courseLeads is unchanged and still correct — it counts leads, not rows, and
-- leads + untagged has always tied to the period's total.
create or replace function public.analytics_scope(
  p_from          date,
  p_to            date,
  p_course_id     uuid default null,
  p_subject_id    uuid default null,
  p_source_id     uuid default null,
  p_counsellor_id uuid default null,
  p_term_id       uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_len integer := (p_to - p_from) + 1;
  v_out jsonb;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  with cur as (
    select * from app.analytics_leads(p_from, p_to, p_course_id, p_subject_id,
                                      p_source_id, p_counsellor_id, p_term_id)
  ),
  pair as (
    select distinct i.enquiry_id, i.teacher_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.teacher_id is not null
  ),
  -- The Products table's own grain: course *and* subject, a null subject being a
  -- real key rather than a row to drop.
  cell as (
    select distinct i.enquiry_id, i.course_id, i.subject_id
      from public.enquiry_items i join cur c on c.enquiry_id = i.enquiry_id
     where i.course_id is not null
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_len,
    'prevFrom', p_from - v_len, 'prevTo', p_from - 1,
    'now',  app.analytics_totals(p_from, p_to, p_course_id, p_subject_id,
                                 p_source_id, p_counsellor_id, p_term_id),
    'prev', app.analytics_totals(p_from - v_len, p_from - 1, p_course_id, p_subject_id,
                                 p_source_id, p_counsellor_id, p_term_id),
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

notify pgrst, 'reload schema';
