-- Any active staff may correct a student's name, at any time.
--
-- The original policy allowed an update only to an admin, or to the row's
-- creator on the IST day they created it. In practice a name arrives after the
-- number does: an enquiry is bulk-imported overnight with no name, the
-- counsellor learns it on the call the next morning, and could not record it —
-- the row was created yesterday, by the import, not by them.
--
-- Two layers, as with profiles.full_name:
--
--   * the column grant is the real restriction. `authenticated` may write
--     `name` and nothing else, so no policy wording can accidentally expose
--     `mobile` — the one identifier the entire product is keyed on, and the
--     thing an edit could use to hijack another student's history.
--   * the row policy decides *which* rows, and is now simply "active staff".
--
-- Auditing is already in place: z_audit_students logs every update with the
-- old and new values and the actor.

drop policy if exists students_update on public.students;

create policy students_update on public.students
  for update to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- Column-level grant, mirroring `grant update (full_name) on public.profiles`.
revoke update on public.students from authenticated;
grant update (name) on public.students to authenticated;

comment on policy students_update on public.students is
  'Any active staff member may correct a name (§2). The column grant limits '
  'the update to students.name; mobile is never writable from the Data API.';
