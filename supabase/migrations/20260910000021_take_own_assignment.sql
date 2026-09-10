-- Let a counsellor take unassigned work for themselves, today.
--
-- assignments_insert was admin-only, which is right for the Assignment Desk:
-- handing someone else's day out is a manager's job. The New Calls pool is the
-- other direction — a counsellor claiming a lead nobody owns — and that has to
-- be possible without a manager standing over them.
--
-- The check is deliberately narrow. A counsellor may create an assignment only
-- for themselves, only for today, and only recording themselves as the person
-- who did it. They cannot assign to a colleague, cannot pre-book tomorrow, and
-- cannot claim work retrospectively. Everything wider stays with is_admin().
--
-- The (enquiry_id, date) unique constraint from §10 decision 9 is what makes
-- the race safe: two counsellors taking the same row at the same instant, one
-- insert succeeds and the other gets 23505, which the application turns into
-- "already taken by X" rather than a silent no-op.

drop policy if exists assignments_insert on public.assignments;

create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    app.is_admin()
    or (
      app.is_staff()
      and counsellor_id = (select auth.uid())
      and assigned_by = (select auth.uid())
      and date = app.ist_today()
    )
  );

comment on policy assignments_insert on public.assignments is
  'Admins assign anyone; a counsellor may only take an unclaimed enquiry for '
  'themselves, today (§5.12 New Calls).';
