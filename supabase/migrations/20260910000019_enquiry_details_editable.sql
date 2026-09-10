-- Any active staff may correct an enquiry's grading fields, at any time.
--
-- enquiries_update allowed only an admin, or the row's creator on the IST day
-- they created it. That made re-grading impossible in practice: a lead
-- imported overnight becomes an A the moment a counsellor speaks to them, and
-- the counsellor is neither the creator nor working on the creation day. §5.8
-- counts "PLI issued" from exactly that change, and until now there was no way
-- to make it.
--
-- Two layers, as with students.name and profiles.full_name. The column grant
-- is the real restriction: `authenticated` may write these four columns and
-- nothing else, so no wording of a policy can expose `status`, `lost_reason`,
-- `close_reason`, `next_follow_up_date` or any of the trigger-derived columns.
-- Those belong to app.recompute_enquiry() and to the two definer functions
-- that own the transitions the application is allowed to make.
--
-- This is strictly tighter than what came before: the previous policy let a
-- same-day creator write *every* column on the row.
--
-- Auditing is unchanged — z_audit_enquiries already records each update with
-- its old and new values and the actor, which is what makes the PLI metric
-- attributable.

drop policy if exists enquiries_update on public.enquiries;

create policy enquiries_update on public.enquiries
  for update to authenticated
  using (app.is_staff())
  with check (app.is_staff());

revoke update on public.enquiries from authenticated;
grant update (importance, term_id, source_id, lead_verification)
  on public.enquiries to authenticated;

comment on policy enquiries_update on public.enquiries is
  'Any active staff member may re-grade an enquiry (§5.3). The column grant '
  'limits the update to importance, term, source and lead verification; '
  'status and every derived column stay with the trigger.';
