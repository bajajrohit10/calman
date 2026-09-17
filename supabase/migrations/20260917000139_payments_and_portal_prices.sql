-- §50F.2-4. Committing a month of payments, and learning a portal price.

-- Item 3 needs somewhere to record that a human has looked at a payment.
alter table accounts.payments
  add column reviewed boolean not null default false,
  add column review_note text;

-- §50F.2. The uniqueness the brief asks for is already there.
--
-- Migration 125 created payments_unique on (batch_id, order_id, amount,
-- transaction_id) with NULLS NOT DISTINCT, which is the semantics that
-- matters: two rows with no transaction id, the same amount and the same
-- order are the same payment entered twice, and a plain unique index would
-- admit both because nulls never conflict. Nothing to add.
--
-- Reconciliation looks payments up by order, which nothing indexed.
create index if not exists payments_order_idx on accounts.payments (order_id);

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'accounts.payments'::regclass
                    and tgname = 'z_audit_payments') then
    create trigger z_audit_payments
      after insert or update or delete on accounts.payments
      for each row execute function audit.log_change();
  end if;
end $$;

-- §50F.2. Commit a month of payments.
--
-- Same shape as commit_sales_batch and for the same reason: replacing a batch,
-- inserting 900 rows and de-duplicating them is not one statement, and a
-- half-applied version is worse than none.
create or replace function accounts.commit_payment_batch(
  p_month date,
  p_file_name text,
  p_uploaded_by uuid,
  p_rows jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_batch    uuid;
  v_existing uuid;
  v_inserted integer;
  v_dupes    integer;
begin
  if not app.is_accounts() then raise exception 'not permitted'; end if;
  p_month := date_trunc('month', p_month)::date;

  select id into v_existing from accounts.payment_batches where month = p_month;
  if v_existing is not null then
    if not p_replace then
      raise exception 'payments for % already imported; pass replace to overwrite', p_month;
    end if;
    delete from accounts.payment_batches where id = v_existing;
  end if;

  insert into accounts.payment_batches (month, file_name, uploaded_by, row_count)
       values (p_month, p_file_name, p_uploaded_by, 0)
    returning id into v_batch;

  with incoming as (
    select nullif(r ->> 'order_id', '')        as order_id,
           nullif(r ->> 'vendor_tab_name', '') as vendor_tab_name,
           nullif(r ->> 'vendor_id', '')::uuid as vendor_id,
           nullif(r ->> 'method', '')          as method,
           nullif(r ->> 'amount', '')::numeric as amount,
           nullif(r ->> 'paid_on', '')::date   as paid_on,
           nullif(r ->> 'transaction_id', '')  as transaction_id,
           r -> 'raw_row'                      as raw_row
      from jsonb_array_elements(p_rows) r
  ), ins as (
    insert into accounts.payments
      (batch_id, order_id, vendor_tab_name, vendor_id, method, amount, paid_on,
       transaction_id, raw_row)
    select v_batch, order_id, vendor_tab_name, vendor_id, method, amount, paid_on,
           transaction_id, raw_row
      from incoming
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  select jsonb_array_length(p_rows) - v_inserted into v_dupes;

  update accounts.payment_batches set row_count = v_inserted where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch, 'month', p_month,
    'inserted', v_inserted, 'duplicates_dropped', v_dupes);
end $$;

grant execute on function accounts.commit_payment_batch(date, text, uuid, jsonb, boolean)
  to authenticated, service_role;

-- §50F.4. Learn a portal price from what was actually paid.
--
-- A portal vendor does not pay a percentage of our list price; it pays a
-- percentage of what the course costs on its own portal, and we never knew
-- that number. Given a line whose rate is agreed and whose payment is not what
-- we expected, the price falls out of the arithmetic: paid = price × (1 −
-- pct/100), so price = paid ÷ (1 − pct/100).
--
-- Saving it rebases every other draft line for the same vendor and product in
-- the month, because the price is a property of the product and not of the one
-- order that revealed it. Lines that are not draft are left alone — ready and
-- paid lines have been acted on, and quietly restating what they earn would
-- change a number somebody has already worked from.
--
-- Center sales are the same product bought through a branch. If a portal price
-- is already known the difference is recorded as center_adjustment rather than
-- overwriting it: both facts are true and the branch discount is the
-- interesting one.
create or replace function accounts.save_portal_price(
  p_line_id uuid,
  p_price numeric,
  p_base_source text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_line     record;
  v_portal   numeric;
  v_adjust   numeric := 0;
  v_rebased  integer;
  v_price_id uuid;
begin
  if not app.is_accounts() then raise exception 'not permitted'; end if;
  if p_base_source not in ('portal_price', 'center_price') then
    raise exception 'base_source must be portal_price or center_price';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price must be positive';
  end if;

  select l.id, l.vendor_id, l.product_key, l.order_id, l.order_date
    into v_line
    from accounts.sales_lines l where l.id = p_line_id;
  if v_line.id is null then raise exception 'line not found'; end if;
  if v_line.vendor_id is null or v_line.product_key is null then
    raise exception 'line has no vendor or product key to learn against';
  end if;

  p_price := round(p_price);

  if p_base_source = 'center_price' then
    select pp.price into v_portal
      from accounts.portal_prices pp
     where pp.vendor_id = v_line.vendor_id
       and pp.product_key = v_line.product_key
     order by pp.effective_from desc limit 1;
    if v_portal is not null then v_adjust := p_price - v_portal; end if;
  end if;

  insert into accounts.portal_prices
    (vendor_id, product_key, price, center_adjustment, learned_from_order_id,
     confirmed, effective_from)
  values
    (v_line.vendor_id, v_line.product_key, p_price, v_adjust, v_line.order_id,
     true, (v_line.order_date at time zone 'Asia/Kolkata')::date)
  returning id into v_price_id;

  -- Rebase this line and its siblings. rate_pct is whatever the line already
  -- resolved to; only the base changes.
  with touched as (
    update accounts.sales_lines l
       set base_amount = p_price,
           base_source = p_base_source,
           calculated_remittance = case
             when l.status in ('cancelled', 'deferred') or l.no_remittance_reason is not null
                  or l.rate_pct is null then 0
             else round(p_price * (1 - l.rate_pct / 100), 2)
           end
     where l.vendor_id = v_line.vendor_id
       and l.product_key = v_line.product_key
       and l.status = 'draft'
    returning 1
  )
  select count(*) into v_rebased from touched;

  return jsonb_build_object(
    'portal_price_id', v_price_id, 'price', p_price,
    'center_adjustment', v_adjust, 'lines_rebased', v_rebased);
end $$;

grant execute on function accounts.save_portal_price(uuid, numeric, text)
  to authenticated, service_role;

-- §50F.4. The sales import now asks portal_prices first.
--
-- Only the base_amount lines change; everything else in the function is as it
-- was. A known portal price is what the vendor actually charges, so it beats
-- the teacher's price we happen to have recorded against the order.
do $$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'accounts' and p.proname = 'commit_sales_batch';

  patched := replace(src,
$old$    -- §50E. base_amount is always teachers_price this month; portal prices
    -- arrive with the payments brief and will make base_source mean something.
    v_base := coalesce((v_row ->> 'teachers_price')::numeric, 0);$old$,
$new$    -- §50F.4. A learned portal price is what this vendor actually charges
    -- for this product, so it is the base; the teacher's price on the order is
    -- the fallback for everything we have not learned yet.
    v_base := coalesce((v_row ->> 'teachers_price')::numeric, 0);
    v_base_source := 'teachers_price';
    if v_vendor is not null and nullif(v_row ->> 'product_key', '') is not null then
      select pp.price into v_portal_price
        from accounts.portal_prices pp
       where pp.vendor_id = v_vendor
         and pp.product_key = v_row ->> 'product_key'
         and pp.effective_from <= coalesce(v_ist, pp.effective_from)
       order by pp.effective_from desc
       limit 1;
      if v_portal_price is not null then
        v_base := v_portal_price;
        v_base_source := 'portal_price';
      end if;
    end if;$new$);
  if patched = src then raise exception 'commit_sales_batch: base_amount block not matched'; end if;
  src := patched;

  patched := replace(src,
    E'  v_prior      record;',
    E'  v_prior      record;\n  v_base_source text;\n  v_portal_price numeric;');
  if patched = src then raise exception 'commit_sales_batch: declare block not matched'; end if;
  src := patched;

  patched := replace(src,
    E'v_source, v_pct, v_base, ''teachers_price'', v_remit, v_reason,',
    E'v_source, v_pct, v_base, v_base_source, v_remit, v_reason,');
  if patched = src then raise exception 'commit_sales_batch: insert values not matched'; end if;

  execute patched;
end $$;

notify pgrst, 'reload schema';
