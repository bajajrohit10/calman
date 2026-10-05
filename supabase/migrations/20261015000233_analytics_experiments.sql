-- §84.2. Events become experiments: a scope, a window, and a thing being measured.
--
-- §83 recorded "what changed, and when" as one date and one line, which was enough
-- to annotate a comparison and not enough to answer "did it work". An experiment
-- needs three more things: who it applied to, when it started and stopped, and what
-- was supposed to move.
--
-- `at` stays as the day it was recorded and `start_date` is when the change took
-- effect; on the existing row they are the same day. Keeping both means the events
-- bar on the other tabs goes on working off one date while the Experiments tab reads
-- the window.
alter table public.analytics_events
  add column scope_type  text not null default 'all',
  add column scope_id    uuid,
  add column start_date  date,
  -- Null means still running. The Experiments tab reads that as "to today" and
  -- marks the card live, which is why it is nullable rather than defaulted far out.
  add column end_date    date,
  add column metric_note text;

alter table public.analytics_events
  add constraint analytics_events_scope_type_check
    check (scope_type in ('all', 'teacher', 'institute', 'course_subject'));

-- 'all' carries no id; everything else must name one. A scope that says "teacher"
-- and names nobody would silently become "everyone", which is the opposite of what
-- was meant.
alter table public.analytics_events
  add constraint analytics_events_scope_id_present
    check ((scope_type = 'all') = (scope_id is null));

alter table public.analytics_events
  add constraint analytics_events_window_order
    check (end_date is null or start_date is null or end_date >= start_date);

-- Backfill before start_date is required: every existing row started the day it
-- was recorded, which is true of the one row that exists.
update public.analytics_events set start_date = at where start_date is null;
alter table public.analytics_events alter column start_date set not null;

-- ---------------------------------------------------------------------------
-- §84.2. The existing row becomes a teacher-scoped experiment.
-- ---------------------------------------------------------------------------
--
-- The note reads "Parveen Khatod" and the masters say "Praveen Khatod" — the only
-- Khatod in the list, and the other two Parveens are Jindal and Sharma. Matched on
-- the surname rather than the spelling, and by name rather than by a pasted id so
-- the intent is readable here.
--
-- end_date is left null: it is still running, and Rohit sets the end in the UI.
update public.analytics_events e
   set scope_type = 'teacher',
       scope_id = t.id,
       start_date = date '2026-10-05',
       end_date = null,
       metric_note = 'Conversion and revenue for this teacher'
  from public.teachers t
 where t.name = 'Praveen Khatod'
   and e.note like '%Khatod%';

-- ---------------------------------------------------------------------------
-- §84.2. Reading the list, with the scope resolved to a name.
-- ---------------------------------------------------------------------------
--
-- The name is resolved here rather than in three client joins: a scope is one of
-- four shapes and the label for each lives in a different table, so one function
-- that already knows the shape is the place to turn it into a sentence.
create or replace function public.analytics_experiments()
returns table (
  id          uuid,
  note        text,
  metric_note text,
  scope_type  text,
  scope_id    uuid,
  scope_label text,
  start_date  date,
  end_date    date,
  created_by  uuid,
  author      text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  return query
  select e.id, e.note, e.metric_note, e.scope_type, e.scope_id,
         case e.scope_type
           when 'all' then 'Everyone'
           when 'teacher' then coalesce((select t.name from public.teachers t where t.id = e.scope_id), 'a teacher')
           when 'institute' then coalesce((select i.name from public.institutes i where i.id = e.scope_id), 'an institute')
           -- The subject names the pair: subjects belong to exactly one course, so
           -- one id addresses "CA Final · Audit" without a second column.
           when 'course_subject' then coalesce(
             (select co.name || ' · ' || sj.name
                from public.subjects sj join public.courses co on co.id = sj.course_id
               where sj.id = e.scope_id), 'a course and subject')
         end,
         e.start_date, e.end_date, e.created_by,
         (select p.full_name from public.profiles p where p.id = e.created_by)
    from public.analytics_events e
   order by e.start_date desc, e.created_at desc;
end;
$function$;

grant execute on function public.analytics_experiments() to authenticated, service_role;

notify pgrst, 'reload schema';
