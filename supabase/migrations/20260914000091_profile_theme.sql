-- §43.2. The theme becomes a setting on the person rather than a guess from
-- the machine.
--
-- Following the OS was the wrong default for this tool. Calman is looked at
-- for eight hours in a room whose lights do not change, on a laptop whose OS
-- theme was set once and never thought about again — and half the desks run
-- the vendor default of light while the people at them would rather not.
-- Dark is now what everybody gets until they say otherwise, and what they say
-- lives on their profile so it follows them to the next machine.
--
-- Not null with a default, so every row that exists has an answer and the
-- layout never has to decide what a missing value means.

alter table public.profiles
  add column if not exists theme text not null default 'dark';

alter table public.profiles
  drop constraint if exists profiles_theme_known;
alter table public.profiles
  add constraint profiles_theme_known check (theme in ('dark', 'light'));

comment on column public.profiles.theme is
  'Which palette this person sees (§43.2). Dark by default; the root layout '
  'stamps it on <html> server-side so there is no flash on first paint.';

-- A person may change their own theme and nothing else about themselves. The
-- existing update policy is about who may administer an account; this is not
-- that, and a counsellor cannot reach Settings to use it.
do $$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'public.profiles'::regclass
       and polname = 'profiles_update_own_theme'
  ) then
    create policy profiles_update_own_theme on public.profiles
      for update
      using (id = (select auth.uid()))
      with check (id = (select auth.uid()));
  end if;
end $$;
