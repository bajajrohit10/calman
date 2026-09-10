-- Remembered column mappings for bulk import (§5.7).
--
-- Keyed on a fingerprint of the file's header row rather than on the filename:
-- the same export from Vsmart or Interakt arrives every morning under a
-- different name, but with identical headers. Sorted and case-folded before
-- hashing, so a reordered export still matches.
--
-- Shared rather than per-user: one person maps a source once and everyone who
-- imports it afterwards gets the mapping. That is the whole point — a
-- localStorage copy would be lost the moment someone used another machine.

create table public.import_column_maps (
  fingerprint text primary key,
  -- Kept for the Import screen to show which file shape this belongs to.
  headers text[] not null,
  -- { mobile: "Phone", name: "Customer", source: null, ... } — our field to
  -- their column. jsonb rather than columns so adding an importable field
  -- later does not need a migration.
  mapping jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.import_column_maps enable row level security;

create policy import_column_maps_select on public.import_column_maps
  for select to authenticated using (app.is_staff());
create policy import_column_maps_insert on public.import_column_maps
  for insert to authenticated with check (app.is_staff());
create policy import_column_maps_update on public.import_column_maps
  for update to authenticated using (app.is_staff()) with check (app.is_staff());

-- The blanket revoke in the initial migration only covered the tables that
-- existed then, so a table added later has to narrow its own grants.
revoke all on public.import_column_maps from anon;
grant select, insert, update on public.import_column_maps to authenticated;

comment on table public.import_column_maps is
  'Remembered file-column → field mappings for §5.7, keyed by a hash of the '
  'sorted, case-folded header row.';
