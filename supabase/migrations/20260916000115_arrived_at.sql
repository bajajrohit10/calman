-- §48.1 and §48.2. When a lead actually arrived, to the minute.
--
-- created_at is when the row was written, which is the same thing only when
-- somebody types a number as the call comes in. It is not the same thing for
-- an AC entry keyed an hour later, and it is not the same thing for an import
-- of yesterday's file. arrived_at carries the real instant when it is known,
-- and everything that shows or orders "Arrived" reads coalesce(arrived_at,
-- created_at) — so a row with nothing recorded behaves exactly as it does
-- today, and the column is free to stay null forever.
--
-- Not a generated column and not a default: null means "we were never told",
-- which is a different fact from "it arrived when the row was written", and
-- collapsing the two would make the distinction unrecoverable.

alter table public.enquiries
  add column if not exists arrived_at timestamptz;

comment on column public.enquiries.arrived_at is
  '§48.2: when the lead really arrived, when known. Readers use coalesce(arrived_at, created_at).';

-- It is deliberately NOT in the audit trigger's exclusion list. Unlike
-- call_type this is entered, not derived, so a change to it is a fact about
-- what somebody did and belongs in the log.

-- live_enquiries is an explicit column list and freezes at the shape the table
-- had when it was written (the trap Brief 44 found).
create or replace view public.live_enquiries as
  select id, student_id, type, source_id, product_text, term_id, importance,
         lead_verification, status, lost_reason, close_reason,
         next_follow_up_date, fresh_call_date, follow_up_slots_used,
         last_slot_date, top_content_priority, created_at, created_by,
         closed_at, archived_at, archived_by, archive_batch_id, re_enquired_at,
         reopened_via_offer_id, reopened_from_enquiry_id, order_id, teacher_id,
         escalated_to, call_type,
         arrived_at
    from public.enquiries
   where archived_at is null;

-- Sorting by an expression over two columns wants an index over the same
-- expression, or New Calls pays a sort on every page.
create index if not exists enquiries_arrival_idx
  on public.enquiries ((coalesce(arrived_at, created_at)));

---------------------------------------------------------------- new_calls ----
-- §48.1: the pool shows the arrival to the minute and orders by it — the day
-- oldest first as before, and inside a day newest first, because the useful
-- question at the top of a fresh list is "what just came in".
do $$
declare
  src text;
  patched text;
  sig text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_pool';

  patched := replace(src, 're_enquired_at date, call_type text, total_count bigint)',
                          're_enquired_at date, call_type text, arrived_at timestamp with time zone, total_count bigint)');
  if patched = src then raise exception 'new_calls_pool: result shape not matched'; end if;
  src := patched;

  -- The instant, and the day it belongs to. arrived_on keeps its meaning —
  -- the day this lead entered the pool, which for a re-enquiry is the day it
  -- came back — and now measures the ordinary case from the real arrival.
  patched := replace(
    src,
    E'    coalesce(e.re_enquired_at, (e.created_at at time zone ''Asia/Kolkata'')::date)\n      as arrived_on\n',
    E'    coalesce(e.arrived_at, e.created_at) as arrived_at,\n'
    || E'    coalesce(e.re_enquired_at,\n'
    || E'             (coalesce(e.arrived_at, e.created_at) at time zone ''Asia/Kolkata'')::date)\n'
    || E'      as arrived_on\n'
  );
  if patched = src then raise exception 'new_calls_pool: arrived_on projection not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'  b.created_at, b.re_enquired_at, b.call_type,\n',
    E'  b.created_at, b.re_enquired_at, b.call_type, b.arrived_at,\n'
  );
  if patched = src then raise exception 'new_calls_pool: outer projection not matched'; end if;
  src := patched;

  patched := replace(
    src,
    'order by b.importance nulls last, b.arrived_on, b.created_at, b.enquiry_id',
    -- §48.1. Day ascending, then newest first inside the day.
    'order by b.importance nulls last, b.arrived_on, b.arrived_at desc, b.enquiry_id'
  );
  if patched = src then raise exception 'new_calls_pool: order by not matched'; end if;

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'new_calls_pool'
  loop execute 'drop function ' || sig; end loop;
  execute patched;
end $$;

grant execute on function public.new_calls_pool to anon, authenticated, service_role;

------------------------------------------------------------ enquiries_table --
-- §48.1: the Created column shows and sorts by the same instant. The sort key
-- keeps the name 'created_at' because that is what the column header and every
-- existing bookmark call it; what changes is which instant it reads.
do $$
declare
  src text;
  patched text;
  sig text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enquiries_table';

  patched := replace(src, 'created_at timestamp with time zone,',
                          'created_at timestamp with time zone, arrived_at timestamp with time zone,');
  if patched = src then raise exception 'enquiries_table: result shape not matched'; end if;
  src := patched;

  patched := replace(src, E'    e.created_at,\n',
                          E'    e.created_at,\n    coalesce(e.arrived_at, e.created_at) as arrived_at,\n');
  if patched = src then raise exception 'enquiries_table: inner projection not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'      when ''created_at''          then extract(epoch from e.created_at)',
    E'      when ''created_at''          then extract(epoch from coalesce(e.arrived_at, e.created_at))'
  );
  if patched = src then raise exception 'enquiries_table: sort key not matched'; end if;
  src := patched;

  patched := replace(src, E'  b.fresh_call_date, b.follow_up_slots_used, b.created_at, b.closed_at,\n',
                          E'  b.fresh_call_date, b.follow_up_slots_used, b.created_at, b.arrived_at, b.closed_at,\n');
  if patched = src then raise exception 'enquiries_table: outer projection not matched'; end if;

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enquiries_table'
  loop execute 'drop function ' || sig; end loop;
  execute patched;
end $$;

grant execute on function public.enquiries_table to anon, authenticated, service_role;

--------------------------------------------------------- recommended_calls --
-- §48.1 "same on the desk's fresh rows". A fresh row has no follow-up date, so
-- it had nothing to order by beyond its id and nothing to show in that column.
-- The arrival fills both.
--
-- Scoped to the fresh bucket on purpose. The desk's order for follow-ups is
-- established and several briefs have tuned it; widening this to every bucket
-- would quietly re-sort work nobody asked me to re-sort.
do $$
declare
  src text;
  patched text;
  sig text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_calls';

  patched := replace(src, 'call_type text, total_count bigint)',
                          'call_type text, arrived_at timestamp with time zone, total_count bigint)');
  if patched = src then raise exception 'recommended_calls: result shape not matched'; end if;
  src := patched;

  patched := replace(src, E'    e.product_text, e.next_follow_up_date, e.created_at,\n',
                          E'    e.product_text, e.next_follow_up_date, e.created_at,\n'
                       || E'    coalesce(e.arrived_at, e.created_at) as arrived_at,\n');
  if patched = src then raise exception 'recommended_calls: inner projection not matched'; end if;
  src := patched;

  patched := replace(src, E'  p.call_type,\n', E'  p.call_type, p.arrived_at,\n');
  if patched = src then raise exception 'recommended_calls: outer projection not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'           nulls last, p.next_follow_up_date nulls last,\n         p.enquiry_id;',
    E'           nulls last, p.next_follow_up_date nulls last,\n'
    || E'         -- §48.1. Fresh rows only: the day oldest first, newest first\n'
    || E'         -- inside the day. Every other bucket keeps the order it had.\n'
    || E'         case when p.bucket = ''fresh''\n'
    || E'              then (p.arrived_at at time zone ''Asia/Kolkata'')::date end\n'
    || E'           asc nulls last,\n'
    || E'         case when p.bucket = ''fresh'' then p.arrived_at end desc,\n'
    || E'         p.enquiry_id;'
  );
  if patched = src then raise exception 'recommended_calls: order by not matched'; end if;

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recommended_calls'
  loop execute 'drop function ' || sig; end loop;
  execute patched;
end $$;

grant execute on function public.recommended_calls to anon, authenticated, service_role;
