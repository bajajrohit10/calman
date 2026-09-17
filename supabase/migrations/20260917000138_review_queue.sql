-- §50F.0(d). The review queue: which unconfirmed rate is costing the most.
--
-- 151 rows carry needs_review, and confirming them in any order is a month of
-- clicking. Ordering them by the money they are holding up turns that into an
-- afternoon: the top of this list is the vendor/level/type whose August sales
-- are largest and whose percentage nobody has agreed, which is exactly the
-- next question worth answering.
--
-- "Lines that would resolve to it" means the lines resolve_rate is currently
-- refusing to rate because of this row: same vendor, same grid, same cell,
-- order date inside the row's window. Those lines sit at rate_source 'none'
-- today and would pick this row up the moment it is confirmed.
--
-- A function rather than a view because the sum has to be computed against
-- whichever batches exist, and PostgREST cannot express the window join.
create or replace function accounts.review_queue()
returns table (
  rate_id uuid,
  vendor_id uuid,
  vendor_name text,
  sale_kind text,
  level text,
  product_type text,
  pct numeric,
  effective_from date,
  effective_to date,
  note text,
  line_count integer,
  teachers_price_sum numeric
)
language sql
stable
security invoker
set search_path to ''
as $$
  select g.id,
         g.vendor_id,
         v.name,
         g.sale_kind,
         g.level,
         g.product_type,
         g.pct,
         g.effective_from,
         g.effective_to,
         g.note,
         coalesce(l.n, 0)::integer,
         coalesce(l.total, 0)
    from accounts.rate_grid g
    join accounts.vendors v on v.id = g.vendor_id
    left join lateral (
      select count(*) as n, sum(s.teachers_price) as total
        from accounts.sales_lines s
       where s.vendor_id = g.vendor_id
         and s.level = g.level
         and s.product_type = g.product_type
         and s.is_combo = (g.sale_kind = 'combo')
         and s.order_date is not null
         and (s.order_date at time zone 'Asia/Kolkata')::date >= g.effective_from
         and (g.effective_to is null
              or (s.order_date at time zone 'Asia/Kolkata')::date <= g.effective_to)
    ) l on true
   where g.needs_review
   order by coalesce(l.total, 0) desc, v.name, g.level, g.product_type;
$$;

grant execute on function accounts.review_queue() to authenticated, service_role;

notify pgrst, 'reload schema';
