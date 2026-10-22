-- Price check, Brief 1: the vendor registry.
--
-- Zeroinfy resells other faculties' courses on its Shopify store. Prices are
-- typed in by hand and drift from the vendors' own sites. This is the first
-- table of the module that checks them: which vendor WEBSITE each Shopify
-- vendor name is sold from, and how that website's prices can be read.
--
-- Shape, decided in the Brief 1 investigation (22 Oct 2026):
--   * A website is not a Shopify vendor name. bbvirtuals.com alone carries
--     BB Virtuals, CA Bhanwar Borana, CA Aakash Kandoi, CA Shubham Keswani and
--     more, so aliases are many names → one site.
--   * A name can also sit on more than one site: CA Shubham Singhal is sold on
--     vsmartacademy.com and on shubhamsinghal.com. So the alias key is
--     (site, name), not name alone. Which site a given product is compared
--     against is a product-level decision for Brief 2.
--   * Some vendor names are deliberately not checked (Zeroinfy Kolkata: centre
--     copies with their own pricing). Those live in an exclusion list so the
--     "unassigned" list on the screen stays honest.
--
-- Nothing here is read by any counsellor screen, and every table is admin-only
-- for SELECT as well as writes: counsellors do not see vendor pricing config.
-- Text columns with CHECK constraints rather than enums, so adding a read
-- method later is a constraint change, not an enum migration.

create table public.vendor_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  website_url text not null check (website_url ~* '^https?://'),
  read_method text not null default 'manual'
    check (read_method in ('edportal_feed', 'shopify_feed', 'vsmart_page', 'letscommerce_page', 'manual')),
  -- The edportal project id ('onr' for bbvirtuals.com). Null for other methods.
  platform_key text,
  -- Which price counts as "the vendor price". 'after_auto_coupon' = the total
  -- the site shows after its automatically applied coupon (Vsmart, decided
  -- 22 Oct 2026). 'listed' = the selling price as shown.
  price_basis text not null default 'listed'
    check (price_basis in ('listed', 'after_auto_coupon')),
  sitemap_url text,
  status text not null default 'needs_review'
    check (status in ('working', 'blocked', 'needs_review', 'manual')),
  notes text,
  is_active boolean not null default true,
  last_checked_at timestamptz,
  last_check_result text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint vendor_sites_edportal_needs_key
    check (read_method <> 'edportal_feed' or platform_key is not null)
);

create unique index vendor_sites_name_key on public.vendor_sites (lower(name));

create table public.vendor_site_aliases (
  id uuid primary key default gen_random_uuid(),
  vendor_site_id uuid not null references public.vendor_sites (id) on delete cascade,
  -- Exactly as Shopify spells it: matching against product.vendor is exact.
  shopify_vendor text not null check (length(trim(shopify_vendor)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create unique index vendor_site_aliases_key
  on public.vendor_site_aliases (vendor_site_id, lower(shopify_vendor));
create index vendor_site_aliases_name_idx
  on public.vendor_site_aliases (lower(shopify_vendor));

create table public.price_check_excluded_vendors (
  id uuid primary key default gen_random_uuid(),
  shopify_vendor text not null check (length(trim(shopify_vendor)) > 0),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create unique index price_check_excluded_vendors_key
  on public.price_check_excluded_vendors (lower(shopify_vendor));

alter table public.vendor_sites enable row level security;
alter table public.vendor_site_aliases enable row level security;
alter table public.price_check_excluded_vendors enable row level security;

-- Admin-only throughout, SELECT included. (select …) form so the check runs
-- once per statement (InitPlan), per migration 0027.
create policy vendor_sites_select on public.vendor_sites
  for select to authenticated using ((select app.is_admin()));
create policy vendor_sites_insert on public.vendor_sites
  for insert to authenticated with check ((select app.is_admin()));
create policy vendor_sites_update on public.vendor_sites
  for update to authenticated using ((select app.is_admin()))
  with check ((select app.is_admin()));
create policy vendor_sites_delete on public.vendor_sites
  for delete to authenticated using ((select app.is_admin()));

create policy vendor_site_aliases_select on public.vendor_site_aliases
  for select to authenticated using ((select app.is_admin()));
create policy vendor_site_aliases_insert on public.vendor_site_aliases
  for insert to authenticated with check ((select app.is_admin()));
create policy vendor_site_aliases_delete on public.vendor_site_aliases
  for delete to authenticated using ((select app.is_admin()));

create policy price_check_excluded_vendors_select on public.price_check_excluded_vendors
  for select to authenticated using ((select app.is_admin()));
create policy price_check_excluded_vendors_insert on public.price_check_excluded_vendors
  for insert to authenticated with check ((select app.is_admin()));
create policy price_check_excluded_vendors_delete on public.price_check_excluded_vendors
  for delete to authenticated using ((select app.is_admin()));

create trigger z_audit_vendor_sites
  after insert or update or delete on public.vendor_sites
  for each row execute function audit.log_change();
create trigger z_audit_vendor_site_aliases
  after insert or update or delete on public.vendor_site_aliases
  for each row execute function audit.log_change();
create trigger z_audit_price_check_excluded_vendors
  after insert or update or delete on public.price_check_excluded_vendors
  for each row execute function audit.log_change();

-- Seed: the approved top-5 websites plus shubhamsinghal.com, with the
-- groupings the owner confirmed on 22 Oct 2026. Idempotent: re-running adds
-- nothing that is already there and never overwrites an edited row.
insert into public.vendor_sites (name, website_url, read_method, platform_key, price_basis, status, notes)
values
  ('BB Virtuals', 'https://www.bbvirtuals.com', 'edportal_feed', 'onr', 'listed', 'working',
   'Multi-faculty platform. Feed gives the default variant only; Mode variants (e.g. Live at Home) need the product page. Many titles omit the faculty name.'),
  ('Vsmart Academy', 'https://vsmartacademy.com', 'vsmart_page', null, 'after_auto_coupon', 'working',
   'Remix site; product loader JSON has all variants in paise. Shown total = price - Rs 1 - auto coupon (seen on 2 products, 22 Oct 2026).'),
  ('AKG Classes (CA Akshansh Garg)', 'https://www.akgclasses.com', 'edportal_feed', 'sf9', 'listed', 'working', null),
  ('FAST Education', 'https://www.fast.edu.in', 'shopify_feed', null, 'listed', 'working',
   'Shopify store; also sells Adish Jain, Riddhi Baghmar, Rahul Satija, Amit Sharma.'),
  ('Let''s Commerce (CA Rishabhh Jainn)', 'https://letscommerce.co.in', 'letscommerce_page', null, 'listed', 'working',
   'A missing course URL still returns 200 - a page without the coursePricing table is a failure.'),
  ('CA Shubham Singhal', 'https://www.shubhamsinghal.com', 'edportal_feed', 'kdn', 'listed', 'working',
   'Also sold via Vsmart Academy.')
on conflict do nothing;

insert into public.vendor_site_aliases (vendor_site_id, shopify_vendor)
select s.id, a.vendor
from (values
  ('BB Virtuals', 'BB Virtuals'),
  ('BB Virtuals', 'BB Virtual Books'),
  ('BB Virtuals', 'CA Bhanwar Borana'),
  ('BB Virtuals', 'Bhanwar Borana Books'),
  ('BB Virtuals', 'CA Aakash Kandoi'),
  ('BB Virtuals', 'Aakash Kandoi Books'),
  ('BB Virtuals', 'CA Shubham Keswani'),
  ('BB Virtuals', 'CA Shubham Keswani Books'),
  ('BB Virtuals', 'CA Sankalp Kanstiya'),
  ('BB Virtuals', 'CA Sankalp Kanstiya Books'),
  ('BB Virtuals', 'Sankalp Kanstiya Books'),
  ('BB Virtuals', 'CA Amit Mahajan'),
  ('BB Virtuals', 'CA Amit Mahajan Books'),
  ('BB Virtuals', 'CA Mohnish Vora'),
  ('Vsmart Academy', 'Vsmart Academy'),
  ('Vsmart Academy', 'Vsmart Academy Books'),
  ('Vsmart Academy', 'CA Shubham Singhal'),
  ('Vsmart Academy', 'CA Shubham Singhal Sir'),
  ('AKG Classes (CA Akshansh Garg)', 'CA Akshansh Garg'),
  ('FAST Education', 'Fast Education'),
  ('FAST Education', 'CA Sarthak Jain'),
  ('Let''s Commerce (CA Rishabhh Jainn)', 'CA Rishabhh Jainn'),
  ('CA Shubham Singhal', 'CA Shubham Singhal'),
  ('CA Shubham Singhal', 'CA Shubham Singhal Sir')
) as a (site, vendor)
join public.vendor_sites s on lower(s.name) = lower(a.site)
on conflict do nothing;

insert into public.price_check_excluded_vendors (shopify_vendor, reason)
values ('Zeroinfy Kolkata', 'Kolkata centre copies of Vsmart/BB courses; own pricing, not checked (owner, 22 Oct 2026).')
on conflict do nothing;
