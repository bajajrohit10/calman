-- Let privileged callers through app.profiles_guard().
--
-- The guard exists to stop a signed-in non-admin editing their own role or
-- active flag, because an RLS policy cannot compare against OLD. But it asked
-- app.is_admin(), which reads auth.uid() — and auth.uid() is null for the
-- service role and for any direct database connection. The result was that
-- Settings → Users could not change a role or deactivate an account at all:
-- those actions use the service-role client, so the guard refused them with
-- "only an admin may change a role or account status".
--
-- A caller with no JWT is holding the service role key or a database
-- password, which is strictly stronger than anything this trigger defends.
-- The server actions that use it authorise the human first (see
-- app/(app)/settings/users/actions.ts). What the guard must still cover is the
-- browser-originated PostgREST path, where auth.uid() is always present — and
-- there it is unchanged.
--
-- The column-level grant (update (full_name) only, for `authenticated`)
-- remains the first line of defence; this trigger is the second.

create or replace function app.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No end-user context: service role, migration, or psql. Already trusted.
  if (select auth.uid()) is null then
    return new;
  end if;

  if app.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.id is distinct from old.id then
    raise exception 'only an admin may change a role or account status';
  end if;

  return new;
end;
$$;
