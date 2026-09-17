-- §50C. Seeded rates that nobody has confirmed yet.
--
-- The August grid gives a defensible percentage for 59 cells and something
-- less than that for the other 162: cells where the rows disagreed, cells
-- with one or two orders behind them, and cells whose vendor had no row in the
-- master at all. Those are still worth carrying — the observed figure is real
-- evidence and belongs where the team will see it — but they must not be paid
-- against.
--
-- So they are seeded at 0% with needs_review set, the observed value kept in
-- the note, and resolve_rate skips them. A flagged row is deliberately
-- indistinguishable from an absent one to the resolver: a line it would have
-- covered comes back 'none' and lands on the Unknown tab, which is where a
-- rate nobody has agreed should land. Seeding the observed percentage directly
-- would have been the other choice and is the wrong one — it would pay a
-- number that came from two orders in August as though it were policy.
alter table accounts.rate_grid
  add column needs_review boolean not null default false;

comment on column accounts.rate_grid.needs_review is
  'Seeded but unconfirmed. resolve_rate treats these rows as absent; the Rates '
  'screen shows them red. Cleared when a human puts a real percentage on the row.';

-- Partial index: the screen and the seeder both ask "what is still flagged for
-- this vendor", and the flagged rows are the minority.
create index rate_grid_needs_review_idx
  on accounts.rate_grid (vendor_id) where needs_review;

-- Same signature, so this replaces rather than overloads. The only change is
-- the needs_review test in the two grid steps; the combo step is untouched
-- because combo_rates carries no such flag — every combo rate there was
-- entered by a person.
create or replace function accounts.resolve_rate(
  p_vendor_id uuid,
  p_level text,
  p_product_type text,
  p_is_combo boolean,
  p_combo_key text,
  p_order_date date,
  p_state text
)
returns table (pct numeric, source text, rate_id uuid)
language plpgsql
stable
set search_path to ''
as $$
begin
  -- 1. Combo.
  if coalesce(p_is_combo, false) and p_combo_key is not null then
    return query
      select c.pct, 'combo'::text, c.id
        from accounts.combo_rates c
       where c.combo_key = p_combo_key
         and c.effective_from <= p_order_date
         and (c.effective_to is null or c.effective_to >= p_order_date)
       order by c.effective_from desc, c.id desc
       limit 1;
    if found then return; end if;
  end if;

  -- 2. A grid row scoped to this student's state.
  --
  -- p_state null makes `p_state = any(...)` null, not false, so a line with no
  -- state falls through to the general row instead of matching a state rule by
  -- accident. That is the behaviour we want and it is asserted in the tests.
  return query
    select g.pct, 'state_rule'::text, g.id
      from accounts.rate_grid g
     where g.vendor_id = p_vendor_id
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

  -- 3. The general grid row.
  return query
    select g.pct, 'grid'::text, g.id
      from accounts.rate_grid g
     where g.vendor_id = p_vendor_id
       and g.level = p_level
       and g.product_type = p_product_type
       and not g.needs_review
       and g.effective_from <= p_order_date
       and (g.effective_to is null or g.effective_to >= p_order_date)
       and g.state_scope is null
     order by g.effective_from desc, g.id desc
     limit 1;
  if found then return; end if;

  -- 4. Nothing applies.
  return query select null::numeric, 'none'::text, null::uuid;
end $$;

notify pgrst, 'reload schema';
