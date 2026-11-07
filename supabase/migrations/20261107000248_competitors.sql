-- §89. Which competitor we lost to.
--
-- "Went to a competitor" has been a lost reason since §4, and the only record
-- of *who* was the counsellor's note. 239 leads carry one; the notes name
-- eighteen-odd places in a hundred and thirty-four spellings, which is why the
-- report the brief asks for could not be built from them.
--
-- The lead-level columns live on enquiries rather than on calls, because the
-- question "who did we lose this student to" is asked of the lead: a lead has
-- one answer, however many calls it took to get it, and app.recompute_enquiry
-- already owns the lost_reason the answer hangs off.

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  -- The row a derived competitor loss falls back to. Exactly one row carries
  -- it, and app.recompute_enquiry looks it up by this rather than by name, so
  -- renaming "Don't know" cannot break the constraint below. See the note on
  -- the items branch in recompute for why a fallback is needed at all.
  is_fallback boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index competitors_one_fallback
  on public.competitors ((true)) where is_fallback;

alter table public.competitors enable row level security;

-- The same three the other master lists carry: every staff member reads them
-- (a counsellor has to pick one), only an admin edits them.
create policy competitors_select on public.competitors
  for select to authenticated using ((select app.is_staff()));
create policy competitors_insert on public.competitors
  for insert to authenticated with check ((select app.is_admin()));
create policy competitors_update on public.competitors
  for update to authenticated using ((select app.is_admin()));

grant select on public.competitors to authenticated;
grant insert, update on public.competitors to authenticated;

-- Audited, unlike the older master lists: this one is edited by hand in
-- Settings *and* re-pointed in bulk by the promote/merge actions below, and a
-- bulk re-point nobody can trace afterwards is not something to ship.
create trigger z_audit_competitors
  after insert or update or delete on public.competitors
  for each row execute function audit.log_change();

-- The brief's order, which is the team's own: the one that is not a competitor
-- at all first, then the resellers by how often they come up, then the people.
insert into public.competitors (name, sort_order, is_fallback) values
  ('Teacher''s own website', 10, false),
  ('Lecturewaala',           20, false),
  ('SLD',                    30, false),
  ('CAPoint',                40, false),
  ('Local Agent',            50, false),
  ('Padai Wale',             60, false),
  ('Edugyan',                70, false),
  ('Conferenza',             80, false),
  ('Shikha',                 90, false),
  ('YOne (Yash)',           100, false),
  ('Sandeep Mundhra',       110, false),
  ('Girish',                120, false),
  ('Legendwala (Aman)',     130, false),
  ('Rishabh Parmar',        140, false),
  ('Kunjan',                150, false),
  ('Shivam',                160, false),
  ('Loukik',                170, false),
  ('Don''t know',           180, true);

alter table public.enquiries
  add column competitor_id uuid references public.competitors(id),
  add column competitor_other text;

create index enquiries_competitor_id_idx on public.enquiries (competitor_id)
  where competitor_id is not null;

-- Half the rule, and the half that is true of every row today: a lead that is
-- not a competitor loss names no competitor. The other half — a competitor
-- loss names exactly one — cannot be added until the 239 existing rows are
-- backfilled, because a check constraint is enforced on every later UPDATE of
-- a row even when added NOT VALID, and app.recompute_enquiry updates those
-- rows whenever a call on them is edited. It arrives with the backfill.
alter table public.enquiries
  add constraint enquiries_competitor_only_when_lost_to_one
  check (
    lost_reason = 'competitor'
    or (competitor_id is null and competitor_other is null)
  );

-- Exactly one of the two, never both. Safe today: both are null everywhere.
alter table public.enquiries
  add constraint enquiries_competitor_not_both
  check (not (competitor_id is not null and competitor_other is not null));

comment on column public.enquiries.competitor_id is
  '§89. Which competitor took this student, when it is one we list.';
comment on column public.enquiries.competitor_other is
  '§89. A name the counsellor typed because it was not on the list. Promoted or merged from Settings → Competitors.';
