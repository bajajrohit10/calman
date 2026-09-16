-- §48.3. Which Quick Add grid a counsellor last used, remembered per user.
--
-- The brief says per user, not per browser, so it lives on the profile rather
-- than in localStorage — somebody who works a shift on the floor machine and
-- finishes on their own laptop should not have to re-pick the tab. It is also
-- what the theme does (§43), and two preferences kept in two different places
-- is how the second one gets forgotten.
--
-- The writer is a security-definer function for the reason §43 found: RLS
-- cannot restrict an UPDATE to one column, so a self-update policy on profiles
-- would let a counsellor set their own role. This writes one column of one row
-- — the caller's own — and reads the request for nothing else.

alter table public.profiles
  add column if not exists quick_add_tab text not null default 'normal';

alter table public.profiles drop constraint if exists quick_add_tab_known;
alter table public.profiles add constraint quick_add_tab_known
  check (quick_add_tab in ('normal', 'ac'));

comment on column public.profiles.quick_add_tab is
  '§48.3: which Quick Add grid this user last had open.';

create or replace function public.set_my_quick_add_tab(p_tab text)
returns text
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'Not signed in.';
  end if;
  if p_tab not in ('normal', 'ac') then
    raise exception 'Unknown Quick Add tab %', p_tab;
  end if;

  update public.profiles set quick_add_tab = p_tab where id = v_id;
  if not found then
    raise exception 'No active profile for this account.';
  end if;
  return p_tab;
end $function$;

grant execute on function public.set_my_quick_add_tab(text) to authenticated, service_role;
