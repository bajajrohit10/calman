-- §50B.2. How many already-processed lines a back-dated rate would touch.
--
-- The Rates screen warns before saving a rate whose effective_from is in the
-- past, because such a rate lands on lines that have already been counted and,
-- for the paid ones, already been sent money against. This counts them.
--
-- It is a function rather than a query in the page because the window test has
-- to read order_date the way the rest of Calman reads timestamps — as an IST
-- calendar date, not a UTC one. An order placed at 02:00 IST on the 1st is
-- 20:30 UTC on the previous day, so a naive comparison drops it from a window
-- starting on the 1st. Keeping that in SQL means the warning and the eventual
-- recalculation cannot drift apart.
--
-- p_to null means an open-ended rate: everything from p_from onwards.
--
-- Counting only, deliberately. This brief saves the rate row and nothing else;
-- recalculating the lines and issuing a difference statement come later, and
-- the warning exists so that nobody assumes otherwise.
create or replace function accounts.retro_line_counts(
  p_vendor_id uuid,
  p_level text,
  p_product_type text,
  p_from date,
  p_to date
)
returns table (paid_count integer, ready_count integer)
language sql
stable
set search_path to ''
as $$
  select
    count(*) filter (where l.status = 'paid')::integer,
    count(*) filter (where l.status = 'ready')::integer
    from accounts.sales_lines l
   where l.vendor_id = p_vendor_id
     and l.level = p_level
     and l.product_type = p_product_type
     and l.order_date is not null
     and (l.order_date at time zone 'Asia/Kolkata')::date >= p_from
     and (p_to is null
          or (l.order_date at time zone 'Asia/Kolkata')::date <= p_to);
$$;

grant execute on function accounts.retro_line_counts(uuid, text, text, date, date)
  to authenticated, service_role;

notify pgrst, 'reload schema';
