-- Price check (24 Oct 2026): a Zeroinfy variant whose price is deliberately
-- not the BB rule — e.g. "Google Drive + hard copy" linked to BB's Drive-only
-- option, or a "without books" option BB doesn't sell. Such links are kept
-- but left out of "Price to fix". Additive, default false: nothing changes
-- for existing rows.

alter table public.vendor_variant_links
  add column if not exists keep_price boolean not null default false;

comment on column public.vendor_variant_links.keep_price is
  'True: keep the Zeroinfy price as it is; do not compare it with the vendor rule.';
