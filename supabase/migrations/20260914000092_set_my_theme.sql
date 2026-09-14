-- §43.2, corrected. The policy added a moment ago let a person update their
-- own profiles row, and RLS cannot restrict that to one column: it would have
-- let any counsellor set their own role to super_admin. Postgres has no
-- column-level clause in a policy, so the write goes through a function that
-- can only reach the one column instead.

drop policy if exists profiles_update_own_theme on public.profiles;

create or replace function public.set_my_theme(p_theme text)
returns text
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'Not signed in.';
  end if;
  if p_theme not in ('dark', 'light') then
    raise exception 'Unknown theme %', p_theme;
  end if;

  -- One column, one row, the caller's own. Nothing here reads the request for
  -- anything else, so there is nothing else this can be talked into writing.
  update public.profiles set theme = p_theme where id = v_id;
  if not found then
    raise exception 'No active profile for this account.';
  end if;
  return p_theme;
end $$;

comment on function public.set_my_theme(text) is
  'Sets the caller''s own palette (§43.2). Security definer because RLS cannot '
  'restrict an update to a single column, and a self-service update policy on '
  'profiles would also expose role.';

revoke all on function public.set_my_theme(text) from public;
grant execute on function public.set_my_theme(text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policy
     where polrelid = 'public.profiles'::regclass
       and polname = 'profiles_update_own_theme'
  ) then
    raise exception 'the self-update policy is still in place';
  end if;
end $$;
