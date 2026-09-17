-- §50D. Combos are rated like everything else, one grid wider.
--
-- combo_rates keyed a rate by the product title, on the theory that a combo is
-- a distinct thing sold under a distinct name. It is not: the house sets one
-- combo percentage for a level and a delivery type, and the individual combo
-- titles are just what that arrangement gets sold as. Keying by title meant
-- every new bundle needed its own row, the importer had to normalise a title
-- byte-identically to whatever a person typed months earlier, and a title
-- nobody had entered yet fell through to no rate at all.
--
-- So a combo rate is a rate_grid row with sale_kind = 'combo'. Same vendor,
-- level and type; same windows, same state rules, same needs_review; one more
-- column saying which of the two grids it belongs to.
alter table accounts.rate_grid
  add column sale_kind text not null default 'single'
    check (sale_kind in ('single', 'combo'));

comment on column accounts.rate_grid.sale_kind is
  'Which grid this row belongs to: single products, or combos. resolve_rate '
  'picks one by the line''s is_combo and never falls back between them.';

-- The two grids are independent, so the same vendor/level/type can hold a
-- 'single' row and a 'combo' row with the same start date. Without sale_kind
-- in the key the second would collide with the first.
drop index accounts.rate_grid_unique;
create unique index rate_grid_unique
  on accounts.rate_grid (vendor_id, sale_kind, level, product_type, effective_from,
                         (coalesce(state_scope, '{}'::text[])));

drop index accounts.rate_grid_lookup;
create index rate_grid_lookup
  on accounts.rate_grid (vendor_id, sale_kind, level, product_type, effective_from desc);

-- combo_rates goes. Checked rather than assumed: dropping a table that
-- quietly acquired a row would destroy somebody's work, and the check costs
-- nothing.
do $$
declare n integer;
begin
  select count(*) into n from accounts.combo_rates;
  if n > 0 then
    raise exception 'accounts.combo_rates holds % row(s); migration stopped so they can be moved to rate_grid first', n;
  end if;
end $$;

drop table accounts.combo_rates;

-- sales_lines.combo_key stays. It is no longer how a rate is found, but it is
-- still how two lines of the same bundle are recognised as the same bundle,
-- and normalise_key still fills it.
comment on column accounts.sales_lines.combo_key is
  'Normalised product head. Groups the lines of one bundle; no longer used to '
  'look up a rate — see rate_grid.sale_kind.';

-- resolve_rate loses p_combo_key, so it has to be dropped and recreated:
-- CREATE OR REPLACE with a different argument list makes an overload, and an
-- ambiguous one. Dropped by regprocedure so the 7-argument signature does not
-- have to be retyped.
do $$
declare sig text;
begin
  select p.oid::regprocedure::text into sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'accounts' and p.proname = 'resolve_rate';
  if sig is null then raise exception 'accounts.resolve_rate not found'; end if;
  execute format('drop function %s', sig);
end $$;

-- §50D.1(d). Which percentage applies to one sales line.
--
-- Two grids, chosen by the line, never blended. A combo line reads the combo
-- grid and stops: if the house has not agreed a combo rate for that level and
-- type, the answer is 'none' and the line goes to the Unknown tab. Falling
-- back to the single rate would be the tempting thing and the wrong one — a
-- combo sells several courses for one price, so the single-product percentage
-- applied to it pays out more than the arrangement ever intended.
--
-- Within the chosen grid the order is unchanged: a state-scoped row beats a
-- general one, the latest effective_from wins an overlap, id breaks a tie, and
-- needs_review rows are invisible.
--
-- Line-level overrides are still not this function's job; the caller checks
-- override_pct first.
create function accounts.resolve_rate(
  p_vendor_id uuid,
  p_level text,
  p_product_type text,
  p_is_combo boolean,
  p_order_date date,
  p_state text
)
returns table (pct numeric, source text, rate_id uuid)
language plpgsql
stable
set search_path to ''
as $$
declare
  v_kind text := case when coalesce(p_is_combo, false) then 'combo' else 'single' end;
begin
  -- 1. A row scoped to this student's state.
  --
  -- p_state null makes `p_state = any(...)` null, not false, so a line with no
  -- state falls through to the general row instead of matching a state rule by
  -- accident.
  return query
    select g.pct, 'state_rule'::text, g.id
      from accounts.rate_grid g
     where g.vendor_id = p_vendor_id
       and g.sale_kind = v_kind
       and g.level = p_level
       and g.product_type = p_product_type
       and not g.needs_review
       and g.effective_from <= p_order_date
       and (g.effective_to is null or g.effective_to >= p_order_date)
       and g.state_scope is not null
       and p_state = any (g.state_scope)
     order by g.effective_from desc, g.id desc
     limit 1;
  if found then return; end if;

  -- 2. The general row for this grid.
  return query
    select g.pct,
           case when v_kind = 'combo' then 'combo' else 'grid' end,
           g.id
      from accounts.rate_grid g
     where g.vendor_id = p_vendor_id
       and g.sale_kind = v_kind
       and g.level = p_level
       and g.product_type = p_product_type
       and not g.needs_review
       and g.effective_from <= p_order_date
       and (g.effective_to is null or g.effective_to >= p_order_date)
       and g.state_scope is null
     order by g.effective_from desc, g.id desc
     limit 1;
  if found then return; end if;

  -- 3. Nothing applies. No crossing between the grids.
  return query select null::numeric, 'none'::text, null::uuid;
end $$;

grant execute on function accounts.resolve_rate(uuid, text, text, boolean, date, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
