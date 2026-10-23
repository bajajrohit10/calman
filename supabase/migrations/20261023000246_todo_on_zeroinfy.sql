-- Price check: data for the "To do on Zeroinfy" list (23 Oct 2026).
--
-- 1. The Zeroinfy (Shopify) price of every linked variant, as last read, so
--    the list can show price fixes without calling Shopify on every view.
-- 2. listing_vendor_products: for each Zeroinfy listing, every vendor product
--    that sells the same course for a current or future attempt (its
--    "siblings"). An attempt the vendor sells and the listing doesn't shows up
--    as "add attempt".
-- 3. link_alternatives: for listings where the attempt is unclear, the vendor
--    option each variant would link to under each candidate vendor product, so
--    "It's Jan 27" re-links every variant in one click.

alter table public.vendor_variant_links
  add column shopify_price numeric,
  add column shopify_compare_at numeric,
  add column shopify_seen_at timestamptz;

create table public.listing_vendor_products (
  id uuid primary key default gen_random_uuid(),
  shopify_product_id bigint not null,
  vendor_site_id uuid not null references public.vendor_sites (id) on delete cascade,
  product_slug text not null,
  product_title text,
  attempts text,
  created_at timestamptz not null default now(),
  unique (shopify_product_id, vendor_site_id, product_slug)
);

create table public.link_alternatives (
  id uuid primary key default gen_random_uuid(),
  shopify_product_id bigint not null,
  shopify_variant_id bigint not null,
  vendor_site_id uuid not null references public.vendor_sites (id) on delete cascade,
  product_slug text not null,
  product_title text,
  attempts text,
  vendor_variant_id text not null,
  vendor_variant_label text,
  vendor_price numeric,
  unique (shopify_variant_id, vendor_site_id, product_slug)
);
create index link_alternatives_product_idx on public.link_alternatives (shopify_product_id);

alter table public.listing_vendor_products enable row level security;
alter table public.link_alternatives enable row level security;

create policy listing_vendor_products_all on public.listing_vendor_products
  for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy link_alternatives_all on public.link_alternatives
  for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
