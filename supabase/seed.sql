-- Calman — master list seed.
--
-- Values come from spec §3. Runs automatically on `supabase db reset` and is
-- idempotent (every insert is ON CONFLICT DO NOTHING against a unique name),
-- so it can also be applied to a hosted project without duplicating rows.
--
-- It seeds no students, enquiries or calls: this is reference data only.

-- ---------------------------------------------------------------------------
-- Sources (§3 enquiries.source_id)
--
-- The spec's list ends in "…", so these are the five it names. The rest get
-- added in Settings (§5.9).
-- ---------------------------------------------------------------------------

insert into public.sources (name) values
  ('AC (Abandoned Checkout)'),
  ('Indv WhatsApp'),
  ('Knowlarity'),
  ('Interakt'),
  ('Vsmart')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Contents (§3, with the §6 priority order: Full -> FT -> EO -> Test Series
-- -> Books). Priority drives the second sort key of the recommended list.
-- ---------------------------------------------------------------------------

insert into public.contents (name, priority) values
  ('Full', 1),
  ('FT', 2),
  ('EO', 3),
  ('Test Series', 4),
  ('Books', 5)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Terms — exam attempts (§3). sort_order is chronological, so the newest
-- attempt is not simply whatever sorts last alphabetically.
-- ---------------------------------------------------------------------------

insert into public.terms (name, sort_order) values
  ('May-26', 1),
  ('Sep-26', 2),
  ('Jan-27', 3)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Courses, teachers and subjects
--
-- The spec does not enumerate these anywhere. What follows is only the
-- examples the spec itself names — "Teacher = Bhanwar Borana, Course = CA
-- Final" in §5.5, and "a student asking BB for DT and IDT" in §3 — so the
-- schema can be exercised end to end. The real lists have to come from
-- Zeroinfy and be loaded through Settings.
-- ---------------------------------------------------------------------------

insert into public.courses (name) values
  ('CA Final')
on conflict (name) do nothing;

insert into public.teachers (name) values
  ('Bhanwar Borana')
on conflict (name) do nothing;

insert into public.subjects (course_id, name)
select c.id, s.name
  from public.courses c
 cross join (values ('DT'), ('IDT')) as s(name)
 where c.name = 'CA Final'
on conflict (course_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- WhatsApp templates (§5.10)
--
-- Placeholders {name} and {course} are filled from the enquiry. The picker
-- surfaces the first three by sort_order (§10 decision 15). Wording is a
-- placeholder — replace it with Zeroinfy's actual copy before go-live.
-- ---------------------------------------------------------------------------

insert into public.whatsapp_templates (name, body, sort_order) values
  ('Intro',
   'Hi {name}, this is Zeroinfy about your {course} enquiry. When would be a good time to talk?',
   1),
  ('Follow-up',
   'Hi {name}, following up on your {course} enquiry. Shall I share the details?',
   2),
  ('Offer reminder',
   'Hi {name}, the current offer on {course} closes shortly. Would you like me to hold your seat?',
   3)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Holidays
--
-- Deliberately empty. Sundays are skipped by rule (app.is_working_day);
-- Saturday is a working day (§10 decision 12). The Zeroinfy holiday calendar
-- is admin-managed and has not been supplied.
-- ---------------------------------------------------------------------------
