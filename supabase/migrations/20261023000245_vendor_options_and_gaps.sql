-- Price check: a stored snapshot of every option (batch / mode / attempt) of
-- the vendor products Zeroinfy listings are linked to, plus the team's
-- decisions on options Zeroinfy deliberately doesn't sell (23 Oct 2026).
--
-- Feeds Settings → Links → "Missing on Zeroinfy": vendor options that no
-- variant of a linked listing points to (a new batch to create), and linked
-- options the vendor no longer sells. Reading every vendor page on each page
-- view would take minutes, hence the snapshot, refreshed from the Links page
-- (and later by the scheduled check).

create table public.vendor_options (
  id uuid primary key default gen_random_uuid(),
  vendor_site_id uuid not null references public.vendor_sites (id) on delete cascade,
  product_slug text not null,
  product_title text,
  variant_id text not null,
  label text not null,
  price numeric,
  mrp numeric,
  -- 'live' while the vendor page lists it; 'gone' once a refresh no longer finds it.
  state text not null default 'live' check (state in ('live', 'gone')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (vendor_site_id, product_slug, variant_id)
);

create index vendor_options_product_idx on public.vendor_options (vendor_site_id, product_slug);

-- "We don't sell this": hides one vendor option for one Zeroinfy listing.
create table public.listing_gap_decisions (
  id uuid primary key default gen_random_uuid(),
  shopify_product_id bigint not null,
  vendor_site_id uuid not null references public.vendor_sites (id) on delete cascade,
  product_slug text not null,
  variant_id text not null,
  decision text not null default 'ignore' check (decision in ('ignore')),
  note text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz not null default now(),
  unique (shopify_product_id, vendor_site_id, product_slug, variant_id)
);

alter table public.vendor_options enable row level security;
alter table public.listing_gap_decisions enable row level security;

create policy vendor_options_select on public.vendor_options
  for select to authenticated using ((select app.is_admin()));
create policy vendor_options_insert on public.vendor_options
  for insert to authenticated with check ((select app.is_admin()));
create policy vendor_options_update on public.vendor_options
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy listing_gap_decisions_select on public.listing_gap_decisions
  for select to authenticated using ((select app.is_admin()));
create policy listing_gap_decisions_insert on public.listing_gap_decisions
  for insert to authenticated with check ((select app.is_admin()));
create policy listing_gap_decisions_delete on public.listing_gap_decisions
  for delete to authenticated using ((select app.is_admin()));

create trigger z_audit_listing_gap_decisions
  after insert or update or delete on public.listing_gap_decisions
  for each row execute function audit.log_change();
