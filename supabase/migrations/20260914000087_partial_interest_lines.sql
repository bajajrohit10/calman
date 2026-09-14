-- §39.2. An interest line is worth keeping before it is complete.
--
-- A counsellor learns "CA Final, FR" before they learn whose FR. Until now the
-- table refused that: teacher_id and course_id were both NOT NULL, so the only
-- way to record half an interest was to record none of it — and half an
-- interest thrown away is a lead nobody can follow up on the strength of.
--
-- So the rule moves from "a teacher and a course" to "at least one of the
-- four", and the missing parts get filled in on a later call.
--
-- What a null teacher already means elsewhere, checked rather than assumed:
--   * recommended_facets / new_calls_facets already emit the teacher facet with
--     `and i.teacher_id is not null`, and already file an enquiry whose lines
--     name no teacher under the "no detail" option — which is exactly where a
--     partial line belongs.
--   * every `join public.teachers` outside the facets sits inside a
--     string_agg building a list of names, where a line with no teacher simply
--     contributes no name.
--   * offer_matches already LEFT JOINs teachers, so a partial line still
--     matches an unrestricted offer and correctly fails to match a
--     teacher-restricted or institute-restricted one.
--   * RLS on enquiry_items is app.is_staff() on all three policies; it does not
--     read any of these columns.
-- The one place that did not survive a null is export_enquiries, patched below.

alter table public.enquiry_items alter column teacher_id drop not null;
alter table public.enquiry_items alter column course_id  drop not null;

-- A line still has to say *something*. Without this the table would accept a
-- row that is nothing but an enquiry id.
alter table public.enquiry_items
  add constraint enquiry_items_has_detail
  check (
    teacher_id is not null or course_id is not null
    or subject_id is not null or content_id is not null
  );

-- A subject belongs to a course, and the composite FK (subject_id, course_id)
-- is MATCH SIMPLE: with course_id null it passes unchecked, which would let a
-- subject be recorded under no course at all. The UI already asks for the
-- course first; this makes the table agree.
alter table public.enquiry_items
  add constraint enquiry_items_subject_needs_course
  check (subject_id is null or course_id is not null);

-- export_enquiries: the item columns are aggregated row by row so the third
-- teacher lines up with the third subject. Both joins were inner, so a line
-- with no teacher would have dropped out of the export entirely — taking its
-- course, subject, content and amount with it, and silently shortening every
-- other column by one. Left joins keep the row and name the gap.
do $$
declare
  src text := pg_get_functiondef('public.export_enquiries'::regproc);
  out text;
begin
  out := replace(src,
    'string_agg(tch.name, '' | ''',
    'string_agg(coalesce(tch.name, ''No teacher''), '' | ''');
  out := replace(out,
    'string_agg(crs.name, '' | ''',
    'string_agg(coalesce(crs.name, ''No course''), '' | ''');
  out := regexp_replace(out,
    '(\n\s*)join\s+public\.teachers\s+tch\s+on\s+tch\.id\s*=\s*i\.teacher_id',
    '\1left join public.teachers tch on tch.id = i.teacher_id');
  out := regexp_replace(out,
    '(\n\s*)join\s+public\.courses\s+crs\s+on\s+crs\.id\s*=\s*i\.course_id',
    '\1left join public.courses crs on crs.id = i.course_id');

  if out = src then
    raise exception 'export_enquiries: the item joins were not found';
  end if;
  execute out;
end $$;
