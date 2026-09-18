-- §55.2. The Shopify abandoned-checkout import.
--
-- Two things the existing import has nowhere to put.
--
-- The checkout reference, on both tables that record an arrival. Shopify's own
-- "Id" where it has one, and the "Name" column with its leading "#" stripped
-- where it does not — one blank Id in the first day's file, and that row still
-- has to be skippable tomorrow. The same column name on both tables on purpose:
-- when somebody later asks "did this checkout ever reach us", the answer is one
-- query shape whether they look at the import log or at the enquiry.
alter table public.import_rows add column checkout_ref text;
alter table public.enquiry_sources add column checkout_ref text;

comment on column public.import_rows.checkout_ref is
  'Shopify checkout Id, or the Name column without its leading "#" when the '
  'Id is blank. The key cross-batch dedupe reads.';

-- Partial, because only the Shopify rows carry one and every other import is
-- the overwhelming majority of this table.
create index import_rows_checkout_ref_idx
  on public.import_rows (checkout_ref) where checkout_ref is not null;
create index enquiry_sources_checkout_ref_idx
  on public.enquiry_sources (checkout_ref) where checkout_ref is not null;

-- §55.3. Checkouts with no usable phone number.
--
-- A checkout with no number is not a failed row to be re-uploaded tomorrow —
-- the file will carry it again every day until it ages out, and skipping it
-- silently loses a real person who got as far as a cart. So it is held: kept
-- whole, shown on its own tab, and finished by hand when somebody finds the
-- number.
--
-- It is deliberately not an enquiry. An enquiry without a number cannot be
-- called, cannot be deduplicated and would sit in every list as work nobody
-- can do. This table is the waiting room, and a row leaves it in one
-- direction: filled in and imported, or discarded with a reason.
create table public.held_checkouts (
  id uuid primary key default gen_random_uuid(),
  checkout_ref text not null unique,
  batch_id uuid references public.import_batches (id) on delete set null,
  name text,
  email text,
  product_text text,
  /** The Created at from the file, already an instant. */
  arrived_at timestamptz,
  /** Every phone cell the file offered, so a human can see what was wrong. */
  raw_phones jsonb not null default '[]'::jsonb,
  vendor text,
  created_at timestamptz not null default now(),
  /** Set when it leaves: 'imported' or 'discarded'. */
  resolution text check (resolution in ('imported', 'discarded')),
  resolution_note text,
  resolved_enquiry_id bigint references public.enquiries (id) on delete set null,
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz
);

create index held_checkouts_open_idx on public.held_checkouts (created_at)
  where resolution is null;

alter table public.held_checkouts enable row level security;

-- §55.3. Counsellors fill these in, which is the point of the tab: the person
-- who recognises the name is usually not an admin.
create policy held_checkouts_select on public.held_checkouts
  for select using (app.is_staff());
create policy held_checkouts_write on public.held_checkouts
  for all using (app.is_staff()) with check (app.is_staff());

grant select, insert, update, delete on public.held_checkouts to authenticated;

create trigger z_audit_held_checkouts
  after insert or update or delete on public.held_checkouts
  for each row execute function audit.log_change();

-- §55.2(c). Which of these checkout references have been seen before.
--
-- Asked once per upload with the whole file's keys, rather than a query per
-- row: the answer is a set, and the browser only needs to know which of its
-- own keys are in it.
create or replace function public.seen_checkout_refs(p_refs text[])
returns table (checkout_ref text)
language sql
stable
set search_path to ''
as $$
  select distinct r.checkout_ref
    from public.import_rows r
   where r.checkout_ref = any (p_refs)
  union
  select distinct h.checkout_ref
    from public.held_checkouts h
   where h.checkout_ref = any (p_refs);
$$;

grant execute on function public.seen_checkout_refs(text[]) to authenticated, service_role;

-- §55.3. The badge on the Import rail item.
create or replace function public.held_checkouts_count()
returns integer
language sql
stable
set search_path to ''
as $$
  select count(*)::integer from public.held_checkouts where resolution is null;
$$;

grant execute on function public.held_checkouts_count() to authenticated, service_role;

notify pgrst, 'reload schema';
