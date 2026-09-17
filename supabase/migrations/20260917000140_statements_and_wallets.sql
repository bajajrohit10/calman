-- §50G. Adjustments, the portal ledger, statements, and closing a month.

-- §50G.1(b). The wallet view read as its owner, not as postgres.
--
-- Same defect as live_enquiries in Brief 50F: a postgres-owned view with
-- security_invoker off reads its base table as the owner, so RLS never runs
-- and the is_accounts() policy on portal_ledger protects nothing. Anyone
-- signed in could read every wallet. The base table's policy is the intended
-- control; this makes the view honour it.
alter view accounts.portal_balances set (security_invoker = on);

-- §50G.1(a). A reason is a fixed list, and a note is free text.
--
-- The column existed holding both. Splitting them means the reasons can be
-- counted — "how much did we give back as refunds this month" is a question
-- somebody will ask — while the explanation stays where a human wrote it.
alter table accounts.adjustments add column note text;

alter table accounts.adjustments add constraint adjustments_reason_check
  check (reason in ('refund_deduction', 'cancellation_charge', 'price_correction',
                    'prior_month_correction', 'other'));

create trigger z_audit_adjustments
  after insert or update or delete on accounts.adjustments
  for each row execute function audit.log_change();

create trigger z_audit_portal_ledger
  after insert or update or delete on accounts.portal_ledger
  for each row execute function audit.log_change();

-- §50G.3. A statement is a month's numbers, frozen.
--
-- The snapshot is the point. Once a vendor's month is marked ready the totals
-- stop being a query and become a record: the lines can still be corrected
-- afterwards, but each correction produces a new version and the earlier one
-- survives, so "what did we tell them in August" always has an answer.
create table accounts.statements (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounts.vendors (id) on delete cascade,
  month date not null,
  version integer not null default 1,
  status text not null default 'final' check (status in ('final', 'paid')),
  total_remittance numeric(12, 2) not null default 0,
  total_paid numeric(12, 2) not null default 0,
  total_adjustments numeric(12, 2) not null default 0,
  net_payable numeric(12, 2) not null default 0,
  line_count integer not null default 0,
  snapshot jsonb not null default '[]'::jsonb,
  /** Why this version exists, when it is not the first. */
  change_note text,
  paid_on date,
  payment_reference text,
  generated_by uuid references public.profiles (id),
  generated_at timestamptz not null default now(),
  check (month = date_trunc('month', month)::date)
);

create unique index statements_version_unique
  on accounts.statements (vendor_id, month, version);
create index statements_vendor_month_idx on accounts.statements (vendor_id, month);

alter table accounts.statements enable row level security;
create policy statements_all on accounts.statements
  for all using (app.is_accounts()) with check (app.is_accounts());
grant select, insert, update, delete on accounts.statements to authenticated, service_role;

create trigger z_audit_statements
  after insert or update or delete on accounts.statements
  for each row execute function audit.log_change();

-- §50G.3. A closed line stops being editable, with two exceptions.
--
-- Once a vendor's month is ready or paid, its numbers have been sent out. The
-- rate, the base and the vendor are then history and changing them silently
-- would make the statement a lie. Two things still have to be possible,
-- because they are how a real correction arrives: marking a line as earning
-- nothing, and the status transitions that close the month. Both leave a trail
-- — the first through the audit trigger and a re-snapshot, the second through
-- the statement version.
create or replace function accounts.sales_lines_closed_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if old.status not in ('ready', 'paid') then return new; end if;

  -- The status itself may move (ready -> paid), and a line may be marked as
  -- earning nothing. calculated_remittance follows from that, so it moves too.
  if new.vendor_id     is distinct from old.vendor_id
     or new.rate_pct   is distinct from old.rate_pct
     or new.rate_source is distinct from old.rate_source
     or new.override_pct is distinct from old.override_pct
     or new.base_amount is distinct from old.base_amount
     or new.base_source is distinct from old.base_source
     or new.teachers_price is distinct from old.teachers_price
     or new.level is distinct from old.level
     or new.product_type is distinct from old.product_type then
    raise exception
      'order % is in a % statement; reopen the month or record an adjustment instead',
      old.order_id, old.status;
  end if;

  return new;
end $$;

create trigger sales_lines_closed_guard
  before update on accounts.sales_lines
  for each row execute function accounts.sales_lines_closed_guard();

-- §50G.1(b). Wallet deductions follow the money automatically.
--
-- A portal or centre payment is not a transfer, it is the vendor spending the
-- wallet we topped up — so every such payment is a deduction against whichever
-- vendor owns that wallet, which for a teacher selling through a house is the
-- house. Written by the payment import rather than typed, because a deduction
-- somebody forgets to enter is a balance that reads high for a month.
--
-- Stored negative: the balance view is a running sum, so the sign is the
-- meaning and a reader never has to know which kinds subtract.
create or replace function accounts.sync_wallet_deductions(p_batch_id uuid)
returns integer
language plpgsql
security invoker
set search_path to ''
as $$
declare v_n integer;
begin
  if not app.is_accounts() then raise exception 'not permitted'; end if;

  -- Re-runnable: this batch's deductions are rebuilt, nothing else is touched.
  delete from accounts.portal_ledger l
   where l.kind = 'deduction'
     and l.order_id in (select p.order_id from accounts.payments p
                         where p.batch_id = p_batch_id and p.order_id is not null);

  with owned as (
    select p.order_id,
           coalesce(v.portal_owner_vendor_id, v.id) as wallet_vendor,
           p.amount, p.paid_on, p.method
      from accounts.payments p
      join accounts.vendors v on v.id = p.vendor_id
     where p.batch_id = p_batch_id
       and p.amount is not null
       and p.method ~* '^(portal|center|centre)$'
  ), ins as (
    insert into accounts.portal_ledger (vendor_id, entry_date, kind, amount, order_id, note)
    select o.wallet_vendor,
           coalesce(o.paid_on, current_date),
           'deduction',
           -abs(o.amount),
           o.order_id,
           'Auto from ' || o.method || ' payment'
      from owned o
      join accounts.vendors w on w.id = o.wallet_vendor
     where w.tracks_portal_balance
    returning 1
  )
  select count(*) into v_n from ins;

  return v_n;
end $$;

grant execute on function accounts.sync_wallet_deductions(uuid) to authenticated, service_role;

-- §50G.3. Freeze a vendor's month.
create or replace function accounts.mark_vendor_ready(
  p_vendor_id uuid,
  p_month date,
  p_change_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_month   date := date_trunc('month', p_month)::date;
  v_batch   uuid;
  v_version integer;
  v_rows    jsonb;
  v_remit   numeric;
  v_paid    numeric;
  v_adjust  numeric;
  v_count   integer;
  v_moved   integer;
begin
  if not app.is_accounts() then raise exception 'not permitted'; end if;

  select id into v_batch from accounts.sales_batches where month = v_month;
  if v_batch is null then raise exception 'no sales batch for %', v_month; end if;

  update accounts.sales_lines
     set status = 'ready'
   where batch_id = v_batch and vendor_id = p_vendor_id and status = 'draft';
  get diagnostics v_moved = row_count;

  -- The snapshot is what the statement showed, not a pointer to rows that can
  -- move underneath it.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.order_date, x.order_id), '[]'::jsonb),
         coalesce(sum(x.calculated_remittance), 0),
         count(*)
    into v_rows, v_remit, v_count
    from (
      select l.order_id, l.order_date, l.student_name, l.course_title, l.course_medium,
             l.list_price, l.teachers_price, l.base_amount, l.base_source,
             l.rate_pct, l.rate_source, l.calculated_remittance, l.payment_mode,
             l.no_remittance_reason, l.remarks, l.status
        from accounts.sales_lines l
       where l.batch_id = v_batch and l.vendor_id = p_vendor_id
         and l.status in ('draft', 'ready', 'paid')
    ) x;

  select coalesce(sum(p.amount), 0) into v_paid
    from accounts.payments p
    join accounts.payment_batches pb on pb.id = p.batch_id
   where pb.month = v_month
     and p.order_id in (select l.order_id from accounts.sales_lines l
                         where l.batch_id = v_batch and l.vendor_id = p_vendor_id);

  select coalesce(sum(a.amount), 0) into v_adjust
    from accounts.adjustments a
   where a.vendor_id = p_vendor_id and a.month = v_month;

  select coalesce(max(version), 0) + 1 into v_version
    from accounts.statements where vendor_id = p_vendor_id and month = v_month;

  insert into accounts.statements
    (vendor_id, month, version, status, total_remittance, total_paid,
     total_adjustments, net_payable, line_count, snapshot, change_note, generated_by)
  values
    (p_vendor_id, v_month, v_version, 'final', v_remit, v_paid, v_adjust,
     v_remit + v_adjust - v_paid, v_count, v_rows, p_change_note,
     (select p.id from public.profiles p where p.id = (select auth.uid())));

  return jsonb_build_object(
    'version', v_version, 'lines_marked_ready', v_moved, 'line_count', v_count,
    'total_remittance', v_remit, 'total_paid', v_paid,
    'total_adjustments', v_adjust, 'net_payable', v_remit + v_adjust - v_paid);
end $$;

grant execute on function accounts.mark_vendor_ready(uuid, date, text)
  to authenticated, service_role;

-- §50G.3. Record that the money went.
create or replace function accounts.mark_vendor_paid(
  p_vendor_id uuid,
  p_month date,
  p_paid_on date,
  p_reference text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_batch uuid;
  v_stmt  uuid;
  v_moved integer;
begin
  if not app.is_accounts() then raise exception 'not permitted'; end if;

  select id into v_stmt from accounts.statements
   where vendor_id = p_vendor_id and month = v_month
   order by version desc limit 1;
  if v_stmt is null then
    raise exception 'mark the month ready before recording payment';
  end if;

  select id into v_batch from accounts.sales_batches where month = v_month;

  update accounts.sales_lines
     set status = 'paid'
   where batch_id = v_batch and vendor_id = p_vendor_id and status = 'ready';
  get diagnostics v_moved = row_count;

  update accounts.statements
     set status = 'paid', paid_on = p_paid_on, payment_reference = p_reference
   where id = v_stmt;

  return jsonb_build_object('lines_marked_paid', v_moved, 'statement_id', v_stmt);
end $$;

grant execute on function accounts.mark_vendor_paid(uuid, date, date, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
