-- §50E. Importing a month of sales.
--
-- Two things: the table that holds the "Converted Orders" tab, and the
-- function that commits a whole month atomically.
--
-- The commit is a function rather than a sequence of supabase-js calls because
-- it is not one insert. It refuses the month if any line in it has been paid,
-- deletes the batch it replaces, drops duplicate orders, supersedes deferred
-- rows from earlier months, resolves a rate per line and computes remittance —
-- and a half-applied version of that is worse than no version. PostgREST gives
-- one statement one transaction, so the statement has to be the whole job.

-- §50E.1(d). The conversions tab: a student paid a difference after the fact,
-- usually to upgrade to a combo or add books. It is a note on the order, not a
-- change to what the teacher is owed, so it lives beside sales_lines rather
-- than in it and nothing here touches calculated_remittance.
create table accounts.order_conversions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references accounts.sales_batches (id) on delete cascade,
  order_number text not null,
  payment_date date,
  difference_amount numeric(12, 2),
  payment_mode text,
  reason text,
  created_at timestamptz not null default now()
);

create unique index order_conversions_unique
  on accounts.order_conversions (batch_id, order_number);
create index order_conversions_order_idx
  on accounts.order_conversions (order_number);

alter table accounts.order_conversions enable row level security;
create policy order_conversions_all on accounts.order_conversions
  for all using (app.is_accounts()) with check (app.is_accounts());
grant select, insert, update, delete on accounts.order_conversions
  to authenticated, service_role;

create trigger z_audit_order_conversions
  after insert or update or delete on accounts.order_conversions
  for each row execute function audit.log_change();

-- §50E.2. Commit one month.
--
-- p_rows carries everything the TypeScript side has already decided — the
-- vendor it resolved, the classification, the status — because those rules
-- live in lib/accounts and should not exist twice. What is left here is
-- everything that has to see the rest of the database at the same instant:
-- what other batches hold, what rate applies, and what the arithmetic makes of
-- it.
--
-- Returns a summary rather than rows; the caller re-reads the batch to display
-- it.
create or replace function accounts.commit_sales_batch(
  p_month date,
  p_file_name text,
  p_uploaded_by uuid,
  p_rows jsonb,
  p_conversions jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_batch      uuid;
  v_existing   uuid;
  v_paid       integer;
  v_row        jsonb;
  v_vendor     uuid;
  v_order      text;
  v_date       timestamptz;
  v_ist        date;
  v_status     text;
  v_reason     text;
  v_pct        numeric;
  v_source     text;
  v_rate_id    uuid;
  v_base       numeric;
  v_remit      numeric;
  v_mode       text;
  v_prior      record;
  v_inserted   integer := 0;
  v_skipped    jsonb := '[]'::jsonb;
  v_superseded integer := 0;
begin
  if not app.is_accounts() then
    raise exception 'not permitted';
  end if;

  -- The month is stored as its first day; anything else makes "the August
  -- batch" ambiguous.
  p_month := date_trunc('month', p_month)::date;

  -- Re-importing a month. Refuse if anyone has been paid against it: those
  -- rows are the record of money that left, and an import would rewrite them.
  select id into v_existing from accounts.sales_batches where month = p_month;
  if v_existing is not null then
    select count(*) into v_paid
      from accounts.sales_lines where batch_id = v_existing and status = 'paid';
    if v_paid > 0 then
      raise exception 'month % already has % paid line(s); import refused', p_month, v_paid;
    end if;
    if not p_replace then
      raise exception 'month % already imported; pass replace to overwrite it', p_month;
    end if;
    delete from accounts.sales_batches where id = v_existing;
  end if;

  insert into accounts.sales_batches (month, file_name, uploaded_by, row_count)
       values (p_month, p_file_name, p_uploaded_by, 0)
    returning id into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_order  := v_row ->> 'order_id';
    v_vendor := nullif(v_row ->> 'vendor_id', '')::uuid;
    v_date   := nullif(v_row ->> 'order_date', '')::timestamptz;
    v_status := coalesce(v_row ->> 'status', 'draft');
    v_reason := nullif(v_row ->> 'no_remittance_reason', '');

    -- order_id is unique across every batch, not just this one. An order that
    -- was deferred out of an earlier month is the exception: this month's row
    -- is the real one and the deferred placeholder gives way to it.
    select id, batch_id, status into v_prior
      from accounts.sales_lines where order_id = v_order limit 1;

    if v_prior.id is not null then
      if v_prior.status = 'deferred' then
        delete from accounts.sales_lines where id = v_prior.id;
        v_superseded := v_superseded + 1;
      else
        v_skipped := v_skipped || jsonb_build_object(
          'order_id', v_order, 'status', v_prior.status);
        continue;
      end if;
    end if;

    -- The order date decides which rate applied, read as an IST calendar date
    -- like every other date in Calman.
    v_ist := (v_date at time zone 'Asia/Kolkata')::date;

    v_pct := null; v_source := 'none'; v_rate_id := null;
    if v_vendor is not null and v_ist is not null
       and (v_row ->> 'level') is not null and (v_row ->> 'product_type') is not null then
      select r.pct, r.source, r.rate_id into v_pct, v_source, v_rate_id
        from accounts.resolve_rate(
               v_vendor,
               v_row ->> 'level',
               v_row ->> 'product_type',
               coalesce((v_row ->> 'is_combo')::boolean, false),
               v_ist,
               nullif(v_row ->> 'state', '')
             ) r;
    end if;

    -- §50E. base_amount is always teachers_price this month; portal prices
    -- arrive with the payments brief and will make base_source mean something.
    v_base := coalesce((v_row ->> 'teachers_price')::numeric, 0);

    -- The formula, fixed: rate_pct is Zeroinfy's commission and the teacher
    -- receives the rest. A line nobody is paying for is zero regardless.
    if v_status in ('cancelled', 'deferred') or v_reason is not null or v_pct is null then
      v_remit := 0;
    else
      v_remit := round(v_base * (1 - v_pct / 100), 2);
    end if;

    select default_payment_mode into v_mode from accounts.vendors where id = v_vendor;

    insert into accounts.sales_lines (
      batch_id, order_id, order_number, order_date, student_name, contact, state,
      course_title, course_medium, faculty_name, list_price, teachers_price,
      actual_received, payment_option, remarks, vendor_id, level, product_type,
      is_combo, has_books_addon, combo_key, product_key, rate_source, rate_pct,
      base_amount, base_source, calculated_remittance, no_remittance_reason,
      payment_mode, status
    ) values (
      v_batch, v_order, nullif(v_row ->> 'order_number',''), v_date,
      nullif(v_row ->> 'student_name',''), nullif(v_row ->> 'contact',''),
      nullif(v_row ->> 'state',''), nullif(v_row ->> 'course_title',''),
      nullif(v_row ->> 'course_medium',''), nullif(v_row ->> 'faculty_name',''),
      nullif(v_row ->> 'list_price','')::numeric, v_base,
      nullif(v_row ->> 'actual_received','')::numeric,
      nullif(v_row ->> 'payment_option',''), nullif(v_row ->> 'remarks',''),
      v_vendor, nullif(v_row ->> 'level',''), nullif(v_row ->> 'product_type',''),
      coalesce((v_row ->> 'is_combo')::boolean, false),
      coalesce((v_row ->> 'has_books_addon')::boolean, false),
      nullif(v_row ->> 'combo_key',''), nullif(v_row ->> 'product_key',''),
      v_source, v_pct, v_base, 'teachers_price', v_remit, v_reason,
      v_mode, v_status
    );
    v_inserted := v_inserted + 1;
  end loop;

  insert into accounts.order_conversions
        (batch_id, order_number, payment_date, difference_amount, payment_mode, reason)
  select v_batch,
         c ->> 'order_number',
         nullif(c ->> 'payment_date','')::date,
         nullif(c ->> 'difference_amount','')::numeric,
         nullif(c ->> 'payment_mode',''),
         nullif(c ->> 'reason','')
    from jsonb_array_elements(coalesce(p_conversions, '[]'::jsonb)) c
   on conflict do nothing;

  update accounts.sales_batches set row_count = v_inserted where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'month', p_month,
    'inserted', v_inserted,
    'superseded_deferred', v_superseded,
    'skipped', v_skipped,
    'conversions', (select count(*) from accounts.order_conversions where batch_id = v_batch)
  );
end $$;

grant execute on function accounts.commit_sales_batch(date, text, uuid, jsonb, jsonb, boolean)
  to authenticated, service_role;

notify pgrst, 'reload schema';
