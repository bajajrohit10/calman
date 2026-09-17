-- §50D. The retrospective warning counts the lines it would actually change.
--
-- retro_line_counts predates the split into two grids, so it counts every line
-- for a vendor/level/type regardless of whether it was sold as a combo. Now
-- that a combo rate and a single rate are different rows governing different
-- lines, that number is wrong in both directions: adding a combo rate would
-- warn about single lines it cannot touch, and adding a single rate would
-- claim credit for combo lines it does not govern.
--
-- The warning is the last thing somebody reads before back-dating a rate over
-- money that has already been paid, so it should not be approximately right.
--
-- Signature change, so drop and recreate rather than replace.
drop function if exists accounts.retro_line_counts(uuid, text, text, date, date);

create function accounts.retro_line_counts(
  p_vendor_id uuid,
  p_level text,
  p_product_type text,
  p_is_combo boolean,
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
     and l.is_combo = coalesce(p_is_combo, false)
     and l.order_date is not null
     -- order_date is read as an IST calendar date, as everywhere else in
     -- Calman: 02:00 IST on the 1st is 20:30 UTC on the previous day, and a
     -- naive comparison would drop it out of a window starting on the 1st.
     and (l.order_date at time zone 'Asia/Kolkata')::date >= p_from
     and (p_to is null
          or (l.order_date at time zone 'Asia/Kolkata')::date <= p_to);
$$;

grant execute on function accounts.retro_line_counts(uuid, text, text, boolean, date, date)
  to authenticated, service_role;

notify pgrst, 'reload schema';
