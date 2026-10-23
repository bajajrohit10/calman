-- Price check: a log of every change Calman makes to the Zeroinfy Shopify
-- store (23 Oct 2026). First use: adding a vendor's new batch to a listing
-- (Settings → Links → Batches & options). Append-only from the app: rows are
-- inserted by the server action after the Shopify call, success or failure.

create table public.shopify_change_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor uuid references public.profiles (id),
  shopify_product_id bigint not null,
  shopify_product_title text,
  action text not null,            -- e.g. 'add_variants'
  request jsonb not null,          -- what was asked for (option, values, prices)
  result jsonb,                    -- what Shopify returned (new variant ids)
  ok boolean not null,
  error text
);

create index shopify_change_log_product_idx on public.shopify_change_log (shopify_product_id, created_at desc);

alter table public.shopify_change_log enable row level security;

-- Admins read; admins insert (the action itself is super-admin gated). No
-- update or delete policy: the log is not editable from the app.
create policy shopify_change_log_select on public.shopify_change_log
  for select to authenticated using ((select app.is_admin()));
create policy shopify_change_log_insert on public.shopify_change_log
  for insert to authenticated with check ((select app.is_admin()));
