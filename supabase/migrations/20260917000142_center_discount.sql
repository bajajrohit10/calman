-- §50H.2. The centre (CFC) rule.
--
-- A "Copy From Center" sale is collected from a branch rather than shipped, so
-- the house knocks a fixed amount off what it charges us above a threshold.
-- That is a property of the arrangement, not of the order, so it belongs on
-- the vendor: two numbers, and a rule that reads them.
--
-- Nulls mean "no centre arrangement", which is most vendors. A discount is not
-- assumed for anybody.
alter table accounts.vendors
  add column center_discount_amount numeric(12, 2) null,
  add column center_discount_threshold numeric(12, 2) null;

comment on column accounts.vendors.center_discount_amount is
  'Flat amount taken off teachers_price for a Copy From Center sale above the '
  'threshold. Null means this vendor has no centre arrangement.';

-- §50H.2(b). Whether this line was collected from a branch.
alter table accounts.sales_lines
  add column is_center boolean not null default false;

create index sales_lines_center_idx on accounts.sales_lines (vendor_id) where is_center;

-- §50H.2(a). The two houses that run centres, and the ownership that was
-- missing. Zeroinfy Kolkata - BB already pointed at BB Virtuals; its Vsmart
-- sibling pointed at nothing, so the rule would have reached 40 of the 50
-- eligible August lines and silently missed the other 10.
update accounts.vendors
   set center_discount_amount = 500, center_discount_threshold = 3999
 where name in ('BB Virtuals', 'Vsmart Academy');

update accounts.vendors
   set portal_owner_vendor_id = (select id from accounts.vendors where name = 'Vsmart Academy')
 where name = 'Zeroinfy Kolkata - Vsmart'
   and portal_owner_vendor_id is null;

-- §50H.2(b). center_adjustment goes.
--
-- It recorded the gap between a centre price and a portal price, learned one
-- order at a time from whatever somebody happened to be paid. The vendor-level
-- rule states the same thing once and applies it everywhere, so the column is
-- now a second answer waiting to disagree with the first.
alter table accounts.portal_prices drop column center_adjustment;

-- save_portal_price loses its centre branch for the same reason: a centre base
-- is computed from the rule, never learned from a payment.
drop function if exists accounts.save_portal_price(uuid, numeric, text);

create function accounts.save_portal_price(
  p_line_id uuid,
  p_price numeric
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_line     record;
  v_rebased  integer;
  v_price_id uuid;
begin
  if not app.is_accounts() then raise exception 'not permitted'; end if;
  if p_price is null or p_price <= 0 then raise exception 'price must be positive'; end if;

  select l.id, l.vendor_id, l.product_key, l.order_id, l.order_date
    into v_line from accounts.sales_lines l where l.id = p_line_id;
  if v_line.id is null then raise exception 'line not found'; end if;
  if v_line.vendor_id is null or v_line.product_key is null then
    raise exception 'line has no vendor or product key to learn against';
  end if;

  p_price := round(p_price);

  insert into accounts.portal_prices
    (vendor_id, product_key, price, learned_from_order_id, confirmed, effective_from)
  values
    (v_line.vendor_id, v_line.product_key, p_price, v_line.order_id, true,
     (v_line.order_date at time zone 'Asia/Kolkata')::date)
  returning id into v_price_id;

  with touched as (
    update accounts.sales_lines l
       set base_amount = p_price,
           base_source = 'portal_price',
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
    'portal_price_id', v_price_id, 'price', p_price, 'lines_rebased', v_rebased);
end $fn$;

grant execute on function accounts.save_portal_price(uuid, numeric)
  to authenticated, service_role;

-- §50H.2(b). What a line is based on, in one place.
--
-- The precedence is the whole rule: a confirmed portal price is what the
-- vendor actually charges and beats everything; failing that, a centre sale
-- above the threshold gets the flat discount; failing that, the teacher's
-- price as recorded. Shared by the importer and by any later re-resolution, so
-- the two cannot reach different answers.
create or replace function accounts.resolve_base(
  p_vendor_id uuid,
  p_product_key text,
  p_teachers_price numeric,
  p_is_center boolean,
  p_order_date date
)
returns table (base_amount numeric, base_source text)
language plpgsql
stable
set search_path to ''
as $fn$
declare
  v_portal numeric;
  v_amount numeric;
  v_thresh numeric;
begin
  if p_vendor_id is not null and p_product_key is not null then
    select pp.price into v_portal
      from accounts.portal_prices pp
     where pp.vendor_id = p_vendor_id
       and pp.product_key = p_product_key
       and pp.confirmed
       and pp.effective_from <= coalesce(p_order_date, pp.effective_from)
     order by pp.effective_from desc
     limit 1;
    if v_portal is not null then
      return query select v_portal, 'portal_price'::text;
      return;
    end if;
  end if;

  -- The discount is the vendor's, or the house's if the vendor sells through
  -- one: a branch of Zeroinfy Kolkata is spending BB Virtuals' arrangement.
  if coalesce(p_is_center, false) and p_vendor_id is not null then
    select coalesce(o.center_discount_amount, v.center_discount_amount),
           coalesce(o.center_discount_threshold, v.center_discount_threshold)
      into v_amount, v_thresh
      from accounts.vendors v
      left join accounts.vendors o on o.id = v.portal_owner_vendor_id
     where v.id = p_vendor_id;

    if v_amount is not null and v_thresh is not null
       and coalesce(p_teachers_price, 0) > v_thresh then
      return query select coalesce(p_teachers_price, 0) - v_amount, 'center_price'::text;
      return;
    end if;
  end if;

  return query select coalesce(p_teachers_price, 0), 'teachers_price'::text;
end $fn$;

grant execute on function accounts.resolve_base(uuid, text, numeric, boolean, date)
  to authenticated, service_role;

-- The importer asks resolve_base instead of deciding the base inline.
--
-- The old block is matched in one piece. A regular expression was tried first
-- and mangled the function: the body contains its own `end if;` lines and a
-- non-greedy match stopped at the wrong one.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'accounts' and p.proname = 'commit_sales_batch';

  patched := replace(src,
$old$    -- §50F.4. A learned portal price is what this vendor actually charges
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
    end if;$old$,
$new$    -- §50H.2(b). One place decides the base: a confirmed portal price, else
    -- the centre discount where the arrangement and threshold apply, else the
    -- teacher's price.
    select b.base_amount, b.base_source into v_base, v_base_source
      from accounts.resolve_base(
             v_vendor,
             nullif(v_row ->> 'product_key', ''),
             coalesce((v_row ->> 'teachers_price')::numeric, 0),
             coalesce((v_row ->> 'is_center')::boolean, false),
             v_ist) b;$new$);
  if patched = src then raise exception 'commit_sales_batch: base block not matched'; end if;
  src := patched;

  patched := replace(src,
    'is_combo, has_books_addon, combo_key, product_key, language, rate_source, rate_pct,',
    'is_combo, has_books_addon, combo_key, product_key, language, is_center, rate_source, rate_pct,');
  if patched = src then raise exception 'commit_sales_batch: insert columns not matched'; end if;
  src := patched;

  patched := replace(src,
$oldv$      coalesce(nullif(v_row ->> 'language',''), 'hindi'),
      v_source, v_pct,$oldv$,
$newv$      coalesce(nullif(v_row ->> 'language',''), 'hindi'),
      coalesce((v_row ->> 'is_center')::boolean, false),
      v_source, v_pct,$newv$);
  if patched = src then raise exception 'commit_sales_batch: insert values not matched'; end if;

  execute patched;
end $mig$;

notify pgrst, 'reload schema';
