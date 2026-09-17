-- §50B. Let everyone read their own profile row.
--
-- Touches the public schema, which Brief 50A and 50B both fenced off, and it
-- is here because the fence was hiding a defect rather than preventing one.
--
-- What was broken. profiles had exactly one select policy, app.is_staff().
-- Migration 124 narrowed is_staff() to exclude the new `accounts` role, on
-- purpose and correctly — that role has no business reading counselling data.
-- But profiles is not counselling data for the person it describes: the app
-- shell reads the signed-in user's own row to find out who they are. With
-- is_staff() false, an accounts user could not read themselves, getViewer()
-- returned a null profile, and every page answered "Account not activated —
-- contact admin". The role has been unusable in the UI since 50A shipped; the
-- vendors page was verified as super_admin and the boundary through API
-- tokens, and neither path goes through the shell, so nothing caught it.
--
-- Why this is the right fix rather than widening is_staff(). Putting accounts
-- back into is_staff() would hand it every enquiry, call and ticket, which is
-- the opposite of what the role is for. Reading your own row is a different
-- permission from reading the staff directory, and it should be a different
-- policy.
--
-- What it grants. Policies are OR'd, so this adds one row — yours — to what
-- each caller can see, and nothing else. Staff keep the directory through
-- is_staff(); an accounts user goes from zero rows to exactly one, their own,
-- which is their name and role, which the shell already displays to them.
-- Anonymous callers are unaffected: auth.uid() is null and `id = null` is
-- null, never true, and anon has no grant on the table in any case.
--
-- `(select auth.uid())` rather than a bare call so the planner treats it as
-- one initplan per statement instead of re-evaluating it per row, which is the
-- same shape the existing profiles_update policy uses.
create policy profiles_select_self on public.profiles
  for select using (id = (select auth.uid()));

notify pgrst, 'reload schema';
