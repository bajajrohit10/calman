-- §50A. The Accounts module: teacher commission remittance.
--
-- Everything here is in its own schema. The counselling product and this share
-- a database, a login and a profiles table, and nothing else — no foreign key
-- from accounts into a counselling table, no counselling reader touching
-- accounts. Two products that will be worked by different people on different
-- days, and a seam between them is cheaper to keep than to introduce later.

create schema if not exists accounts;

-- The role holds the schema, not individual grants per table: every table
-- below is reachable by the same two roles under the same rule, and a
-- per-table grant list is a list somebody forgets to add to.
grant usage on schema accounts to authenticated, service_role;

-------------------------------------------------------------------- guard --
-- is_staff() means "staff of the counselling product", and the accounts role
-- is not that. See the previous migration for why this matters.
create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select app.role() is not null and app.role() <> 'accounts'::public.user_role;
$$;

/** Who may read and write accounts.*: the two roles, and nobody else. */
create or replace function app.is_accounts()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select app.role() in ('super_admin'::public.user_role, 'accounts'::public.user_role);
$$;

grant execute on function app.is_accounts() to authenticated, service_role;

------------------------------------------------------------------ vendors --
create table accounts.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Text, not a foreign key. It names the teacher or house a books arm
  -- belongs to, and several of those names are people who are not themselves
  -- payees; a constraint here would force inventing vendor rows to satisfy it.
  institute text,
  kind text not null check (kind in ('teacher', 'institute', 'books', 'zeroinfy_internal')),
  default_payment_mode text not null default 'later'
    check (default_payment_mode in ('portal_balance', 'online_instant', 'later')),
  tracks_portal_balance boolean not null default false,
  -- §50A.4. Rates are per teacher-vendor; the wallet belongs to the institute.
  -- A self-reference rather than a second table: the owner is itself a vendor,
  -- with its own rates and its own ledger.
  portal_owner_vendor_id uuid references accounts.vendors (id),
  opening_balance numeric(12, 2) not null default 0,
  opening_balance_date date,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create index vendors_kind_idx on accounts.vendors (kind) where is_active;
create index vendors_portal_owner_idx on accounts.vendors (portal_owner_vendor_id)
  where portal_owner_vendor_id is not null;

create table accounts.vendor_aliases (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounts.vendors (id) on delete cascade,
  alias text not null unique,
  created_at timestamptz not null default now()
);

create index vendor_aliases_vendor_idx on accounts.vendor_aliases (vendor_id);

--------------------------------------------------------------------- rates --
create table accounts.rate_grid (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounts.vendors (id) on delete cascade,
  level text not null,
  product_type text not null,
  pct numeric(5, 2) not null,
  effective_from date not null,
  effective_to date,
  -- null means every state. An empty array would mean "no states", which is a
  -- different and useless thing, so the coalesce in the index below maps null
  -- to '{}' only to make the uniqueness comparable.
  state_scope text[],
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index rate_grid_unique
  on accounts.rate_grid (vendor_id, level, product_type, effective_from,
                         (coalesce(state_scope, '{}'::text[])));
create index rate_grid_lookup
  on accounts.rate_grid (vendor_id, level, product_type, effective_from desc);

create table accounts.combo_rates (
  id uuid primary key default gen_random_uuid(),
  -- The payee, which for a combo is often one house rather than the several
  -- teachers the title names.
  vendor_id uuid not null references accounts.vendors (id) on delete cascade,
  combo_key text not null,
  display_title text,
  pct numeric(5, 2) not null,
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index combo_rates_unique on accounts.combo_rates (combo_key, effective_from);

create table accounts.portal_prices (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounts.vendors (id) on delete cascade,
  product_key text not null,
  price numeric(12, 2) not null,
  center_adjustment numeric(12, 2) not null default 0,
  -- Where the price was observed, when it was inferred from a real order
  -- rather than typed in from the portal.
  learned_from_order_id text,
  confirmed boolean not null default false,
  effective_from date not null,
  created_at timestamptz not null default now()
);

create unique index portal_prices_unique
  on accounts.portal_prices (vendor_id, product_key, effective_from);

--------------------------------------------------------------------- sales --
create table accounts.sales_batches (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  file_name text not null,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  row_count integer not null default 0,
  check (month = date_trunc('month', month)::date)
);

create table accounts.sales_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references accounts.sales_batches (id) on delete cascade,
  -- With the A/B suffix a multi-line order carries. order_number is the same
  -- value without it, so one order's lines can be found together.
  order_id text not null,
  order_number text,
  order_date timestamptz,
  student_name text,
  contact text,
  state text,
  course_title text,
  course_medium text,
  faculty_name text,
  list_price numeric(12, 2),
  teachers_price numeric(12, 2),
  actual_received numeric(12, 2),
  payment_option text,
  remarks text,
  -- Nullable and editable: the parser resolves it, a person overrules it.
  vendor_id uuid references accounts.vendors (id),
  level text,
  product_type text,
  is_combo boolean not null default false,
  -- §50A.7. "Combo" in the stripped suffix means a books add-on, not a combo
  -- product — the line keeps its own type and rate and is flagged instead.
  has_books_addon boolean not null default false,
  combo_key text,
  product_key text,
  rate_source text check (rate_source in
    ('grid', 'combo', 'line_override', 'state_rule', 'manual', 'none')),
  rate_pct numeric(5, 2),
  base_amount numeric(12, 2),
  base_source text check (base_source in
    ('teachers_price', 'portal_price', 'center_price', 'manual')),
  calculated_remittance numeric(12, 2),
  override_pct numeric(5, 2),
  override_note text,
  no_remittance_reason text check (no_remittance_reason in
    ('cancelled', 'serial_key', 'replacement', 'internal', 'other')),
  payment_mode text check (payment_mode in ('portal_balance', 'online_instant', 'later')),
  -- §50A.1. 'deferred' is a row carried to a later month: kept so that month's
  -- import can match the order again, and excluded from every list, export and
  -- total in this one.
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'paid', 'disputed', 'deferred')),
  created_at timestamptz not null default now()
);

create unique index sales_lines_order_unique on accounts.sales_lines (batch_id, order_id);
create index sales_lines_batch_idx on accounts.sales_lines (batch_id);
create index sales_lines_vendor_idx on accounts.sales_lines (vendor_id, status);
create index sales_lines_order_number_idx on accounts.sales_lines (order_number);
-- Every list and total in a month reads the non-deferred rows, so that is the
-- index rather than a filter applied after the fact.
create index sales_lines_live_idx on accounts.sales_lines (batch_id, vendor_id)
  where status <> 'deferred';

------------------------------------------------------------------ payments --
create table accounts.payment_batches (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  file_name text not null,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  row_count integer not null default 0,
  check (month = date_trunc('month', month)::date)
);

create table accounts.payments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references accounts.payment_batches (id) on delete cascade,
  order_id text,
  -- The tab the row came off, kept verbatim: it is how a payment is traced
  -- back to the sheet, and it resolves to a vendor through the alias table.
  vendor_tab_name text,
  vendor_id uuid references accounts.vendors (id),
  method text,
  amount numeric(12, 2),
  paid_on date,
  transaction_id text,
  raw_row jsonb,
  created_at timestamptz not null default now()
);

-- Nulls are distinct by default, which would let the same blank-transaction
-- row in twice; NULLS NOT DISTINCT makes the guard mean what it says.
create unique index payments_unique
  on accounts.payments (batch_id, order_id, amount, transaction_id) nulls not distinct;
create index payments_vendor_idx on accounts.payments (vendor_id);

--------------------------------------------------------------- adjustments --
create table accounts.adjustments (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounts.vendors (id) on delete cascade,
  month date not null,
  -- Negative is a deduction. One signed column rather than a kind plus a
  -- magnitude: a sum is then a sum, and no reader has to know the convention.
  amount numeric(12, 2) not null,
  reason text,
  linked_order_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (month = date_trunc('month', month)::date)
);

create index adjustments_vendor_month_idx on accounts.adjustments (vendor_id, month);

-------------------------------------------------------------------- ledger --
create table accounts.portal_ledger (
  id uuid primary key default gen_random_uuid(),
  -- §50A.4: always the wallet's owner, never the teacher whose sale it was.
  vendor_id uuid not null references accounts.vendors (id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('top_up', 'deduction', 'adjustment', 'opening')),
  amount numeric(12, 2) not null,
  order_id text,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index portal_ledger_vendor_date_idx on accounts.portal_ledger (vendor_id, entry_date);

/**
 * The running balance, as a view.
 *
 * Not a column on the ledger: a stored running total is a number that is right
 * until somebody inserts a row out of order, and then it is wrong everywhere
 * after that point with nothing to say so. Computed, it cannot drift.
 */
create or replace view accounts.portal_balances as
  select
    l.vendor_id,
    v.name as vendor_name,
    l.id,
    l.entry_date,
    l.kind,
    l.amount,
    l.order_id,
    l.note,
    sum(l.amount) over (
      partition by l.vendor_id
      order by l.entry_date, l.created_at, l.id
      rows between unbounded preceding and current row
    ) as balance_after
  from accounts.portal_ledger l
  join accounts.vendors v on v.id = l.vendor_id;

----------------------------------------------------------------- audit ------
-- The same trigger the counselling tables use, so an accounts edit is
-- recorded the way every other edit in this database is.
create trigger z_audit_sales_lines
  after insert or delete or update on accounts.sales_lines
  for each row execute function audit.log_change();

create trigger z_audit_vendors
  after insert or delete or update on accounts.vendors
  for each row execute function audit.log_change();

create trigger z_audit_rate_grid
  after insert or delete or update on accounts.rate_grid
  for each row execute function audit.log_change();

create trigger z_audit_combo_rates
  after insert or delete or update on accounts.combo_rates
  for each row execute function audit.log_change();

------------------------------------------------------------------- policies --
-- One rule for every table: the accounts role and super_admin, nobody else.
-- Written as a loop so a table added later cannot be given a subtly different
-- policy by hand.
do $$
declare
  t text;
begin
  foreach t in array array[
    'vendors', 'vendor_aliases', 'rate_grid', 'combo_rates', 'portal_prices',
    'sales_batches', 'sales_lines', 'payment_batches', 'payments',
    'adjustments', 'portal_ledger'
  ] loop
    execute format('alter table accounts.%I enable row level security', t);
    execute format('drop policy if exists accounts_all on accounts.%I', t);
    execute format(
      'create policy accounts_all on accounts.%I for all to authenticated '
      'using (app.is_accounts()) with check (app.is_accounts())', t);
    execute format(
      'grant select, insert, update, delete on accounts.%I to authenticated', t);
  end loop;
end $$;

grant select on accounts.portal_balances to authenticated;
