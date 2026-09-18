-- §54.1. Quick Add has three tabs now, so the remembered one has three values.
--
-- "normal" was the grid of ten; it becomes "multi", which is the same thing
-- under the name the screen now uses. Existing rows are migrated rather than
-- left to fail the new constraint, and the default moves to "one" — a call
-- happening now is the commonest way into this screen, and the tab that fits
-- it should be the one a new counsellor lands on.
alter table public.profiles drop constraint quick_add_tab_known;

update public.profiles set quick_add_tab = 'multi' where quick_add_tab = 'normal';

alter table public.profiles
  alter column quick_add_tab set default 'one';

alter table public.profiles add constraint quick_add_tab_known
  check (quick_add_tab = any (array['one', 'multi', 'ac']));

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
  if p_tab not in ('one', 'multi', 'ac') then
    raise exception 'Unknown Quick Add tab %', p_tab;
  end if;

  update public.profiles set quick_add_tab = p_tab where id = v_id;
  if not found then
    raise exception 'No active profile for this account.';
  end if;
  return p_tab;
end $function$;

notify pgrst, 'reload schema';
