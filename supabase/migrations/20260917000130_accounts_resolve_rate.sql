-- §50B.1. The rate resolver, and the key normaliser it shares with the UI.
--
-- accounts.normalise_key exists in two places on purpose: here, for the
-- importer that will fill combo_key on every sales line, and in TypeScript at
-- lib/accounts/normalise-key.ts for the Combos tab, which pre-fills the key
-- from the title the user typed. If the two ever disagree the importer stops
-- matching combos the UI created, silently, so they are written to the same
-- rules and tested against the same sample list.
--
-- The rules: cut the title at a standalone "by", which is where a product
-- title stops naming the product and starts naming who teaches it; lowercase;
-- every run of anything that is not a letter or digit becomes a single
-- hyphen; trim hyphens off both ends. Dash variants, brackets, ampersands and
-- double spaces all collapse to the same thing, which is the point.
create or replace function accounts.normalise_key(p_text text)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        lower(regexp_replace(coalesce(p_text, ''), '\s+by\s+.*$', '', 'i')),
        '[^a-z0-9]+', '-', 'g')),
    '');
$$;

comment on function accounts.normalise_key(text) is
  'Product title -> combo key. Mirrored in TS at lib/accounts/normalise-key.ts; '
  'change both together or the importer stops matching combos made in the UI.';

-- §50B.1. Which percentage applies to one sales line.
--
-- First match wins, in the order the brief sets out: a combo rate beats
-- everything, a state-specific grid row beats a general one, and a general
-- grid row is the fallback. Nothing matching is itself an answer — ('none')
-- rather than null — because the Unknown tab is driven by rate_source and a
-- line that resolved to nothing has to be distinguishable from a line that
-- was never resolved at all.
--
-- Line-level overrides are deliberately not handled here. The caller checks
-- override_pct first and only asks this function when there isn't one, which
-- keeps "what did a human decide" and "what do the tables say" separable.
--
-- Overlapping rows are legal and expected. A retrospective rate is entered as
-- a new row over the old one rather than by editing it, so the old row stays
-- as the record of what was believed at the time; both then cover the same
-- date. Every step therefore orders by effective_from desc and takes one row,
-- which means the most recently-effective rate wins. id is the tiebreak so
-- that two rows entered with the same effective_from resolve deterministically
-- rather than by whatever order the planner happened to produce.
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
       and g.effective_from <= p_order_date
       and (g.effective_to is null or g.effective_to >= p_order_date)
       and g.state_scope is null
     order by g.effective_from desc, g.id desc
     limit 1;
  if found then return; end if;

  -- 4. Nothing applies.
  return query select null::numeric, 'none'::text, null::uuid;
end $$;

grant execute on function accounts.normalise_key(text) to authenticated, service_role;
grant execute on function accounts.resolve_rate(uuid, text, text, boolean, text, date, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
