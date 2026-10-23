-- Price check, Brief 2a: links from each Zeroinfy (Shopify) variant to the
-- vendor product + vendor variant it resells (23 Oct 2026).
--
-- Per variant, not per product: BB sells a separate product per attempt
-- ("For Nov 26" / "For May 27 & onwards") with batches as variants, while a
-- Zeroinfy listing carries attempt, batch and mode as options of one product.
-- So one Zeroinfy product can point at several BB products, one per attempt.
--
-- Rows are proposed by AI ("suggested") and only count once a person has
-- approved them. Nothing downstream may treat a suggested link as checked.
--
-- Snapshot text columns (titles, labels) are for display and review only; the
-- ids are what later checks resolve against. They go stale when either side
-- renames something, which is fine: the next check re-reads both sides.

create table public.vendor_variant_links (
  id uuid primary key default gen_random_uuid(),

  -- Zeroinfy side (Shopify numeric ids).
  shopify_product_id bigint not null,
  shopify_variant_id bigint not null,
  shopify_product_title text not null,
  shopify_product_handle text,
  shopify_vendor text,
  shopify_variant_title text,

  -- Vendor side. Null slug/variant only for status 'no_match'.
  vendor_site_id uuid not null references public.vendor_sites (id),
  vendor_product_slug text,
  vendor_product_title text,
  vendor_variant_id text,
  vendor_variant_label text,

  status text not null default 'suggested'
    check (status in ('suggested', 'approved', 'rejected', 'no_match')),
  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  reason text,
  review_note text,

  suggested_by text not null default 'ai',
  suggested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint vendor_variant_links_target_present
    check (status = 'no_match' or vendor_product_slug is not null)
);

-- One live link per Zeroinfy variant. Re-suggesting replaces it (upsert).
create unique index vendor_variant_links_variant_key
  on public.vendor_variant_links (shopify_variant_id);
create index vendor_variant_links_product_idx
  on public.vendor_variant_links (shopify_product_id);
create index vendor_variant_links_status_idx
  on public.vendor_variant_links (status, confidence);

alter table public.vendor_variant_links enable row level security;

-- Admin-only, select included, like the vendor registry.
create policy vendor_variant_links_select on public.vendor_variant_links
  for select to authenticated using ((select app.is_admin()));
create policy vendor_variant_links_insert on public.vendor_variant_links
  for insert to authenticated with check ((select app.is_admin()));
create policy vendor_variant_links_update on public.vendor_variant_links
  for update to authenticated using ((select app.is_admin()))
  with check ((select app.is_admin()));
create policy vendor_variant_links_delete on public.vendor_variant_links
  for delete to authenticated using ((select app.is_admin()));

create trigger z_audit_vendor_variant_links
  after insert or update or delete on public.vendor_variant_links
  for each row execute function audit.log_change();
