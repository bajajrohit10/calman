-- §10.2 Institutes: who a teacher teaches under.
--
-- A plain master list, same shape as teachers/courses/contents so Settings →
-- Master lists picks it up without a special case. The link is on the teacher
-- and it is optional: the real list arrives as a spreadsheet later, and until
-- then every teacher sits with institute_id null rather than in a placeholder
-- institute nobody chose.
--
-- Phase 2 note, recorded here so the shape is not re-litigated later: offers
-- will target institutes as well as teachers/courses/subjects/contents. The
-- join table already has four siblings (offer_teachers, offer_courses,
-- offer_subjects, offer_contents) and an offer_institutes (offer_id,
-- institute_id) fits beside them unchanged. No offer code now — see
-- docs/calman-spec.md §3.

create table public.institutes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- Case-insensitive uniqueness: the seed script matches on exact name, and two
-- institutes differing only in case would quietly split a teacher roster.
create unique index institutes_name_key on public.institutes (lower(name));

alter table public.institutes enable row level security;

create policy institutes_select on public.institutes
  for select to authenticated using ((select app.is_staff()));
create policy institutes_insert on public.institutes
  for insert to authenticated with check ((select app.is_admin()));
create policy institutes_update on public.institutes
  for update to authenticated using ((select app.is_admin()))
  with check ((select app.is_admin()));

create trigger z_audit_institutes
  after insert or update or delete on public.institutes
  for each row execute function audit.log_change();

alter table public.teachers
  add column institute_id uuid references public.institutes (id);

comment on column public.teachers.institute_id is
  'Optional. Null until the teacher→institute sheet is loaded by '
  'scripts/seed-institutes.mjs.';

-- The facet groups open interest lines by their teacher''s institute, so the
-- path is enquiry_items → teachers → institutes. This index makes the middle
-- hop an index scan rather than a heap read per teacher.
create index teachers_institute_idx on public.teachers (institute_id)
  where institute_id is not null;
