-- §50H.1. Language as a dimension of a rate.
--
-- The same course taught in English and in Hindi is not always paid the same,
-- and until now the grid had no way to say so: one percentage covered both and
-- whichever was agreed second overwrote the first.
--
-- Hindi is the default because it is the overwhelming majority — an English
-- title announces itself, a Hindi one does not, so "not English" is the
-- reliable test and the column defaults accordingly.
alter table accounts.sales_lines
  add column language text not null default 'hindi'
    check (language in ('hindi', 'english'));

create index sales_lines_language_idx on accounts.sales_lines (vendor_id, language);

-- §50H.1(b). On a rate, null means "either language".
--
-- Three states, not two: a rate that applies to everything, and a rate that
-- applies only to English. There is deliberately no 'hindi' rate — a Hindi
-- line takes the general row, and adding a third value would create two ways
-- to say the same thing.
alter table accounts.rate_grid
  add column language text null check (language in ('english'));

-- The language is part of what makes a rate row distinct: the same vendor,
-- cell and start date can hold one general rate and one English rate.
drop index accounts.rate_grid_unique;
create unique index rate_grid_unique
  on accounts.rate_grid (vendor_id, sale_kind, level, product_type, effective_from,
                         (coalesce(state_scope, '{}'::text[])),
                         (coalesce(language, '*')));

drop index accounts.rate_grid_lookup;
create index rate_grid_lookup
  on accounts.rate_grid (vendor_id, sale_kind, level, product_type, effective_from desc);

-- resolve_rate gains the line's language, so the signature changes and the
-- function has to be dropped rather than replaced.
do $$
declare sig text;
begin
  select p.oid::regprocedure::text into sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'accounts' and p.proname = 'resolve_rate';
  if sig is null then raise exception 'accounts.resolve_rate not found'; end if;
  execute format('drop function %s', sig);
end $$;

-- §50H.1(b). Which percentage applies to one sales line.
--
-- Unchanged except for language. Within each step the candidates are now the
-- rows that could apply — this language's row, or the general one — and the
-- specific beats the general. An English-only rate can never reach a Hindi
-- line, which is the whole point: it is the case where getting it wrong pays
-- the wrong amount silently.
--
-- The ordering does the work: exact-language first, then latest effective_from
-- as before, then id. So a general rate agreed last week still loses to an
-- English rate agreed last year, for an English line — which is right, because
-- the English rate is the more specific statement about that line.
create function accounts.resolve_rate(
  p_vendor_id uuid,
  p_level text,
  p_product_type text,
  p_is_combo boolean,
  p_order_date date,
  p_state text,
  p_language text default 'hindi'
)
returns table (pct numeric, source text, rate_id uuid)
language plpgsql
stable
set search_path to ''
as $$
declare
  v_kind text := case when coalesce(p_is_combo, false) then 'combo' else 'single' end;
  v_lang text := coalesce(p_language, 'hindi');
begin
  -- 1. A row scoped to this student's state.
  return query
    select g.pct, 'state_rule'::text, g.id
      from accounts.rate_grid g
     where g.vendor_id = p_vendor_id
       and g.sale_kind = v_kind
       and g.level = p_level
       and g.product_type = p_product_type
       and not g.needs_review
       and (g.language is null or g.language = v_lang)
       and g.effective_from <= p_order_date
       and (g.effective_to is null or g.effective_to >= p_order_date)
       and g.state_scope is not null
       and p_state = any (g.state_scope)
     order by (g.language is not null) desc, g.effective_from desc, g.id desc
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
       and (g.language is null or g.language = v_lang)
       and g.effective_from <= p_order_date
       and (g.effective_to is null or g.effective_to >= p_order_date)
       and g.state_scope is null
     order by (g.language is not null) desc, g.effective_from desc, g.id desc
     limit 1;
  if found then return; end if;

  -- 3. Nothing applies.
  return query select null::numeric, 'none'::text, null::uuid;
end $$;

grant execute on function accounts.resolve_rate(uuid, text, text, boolean, date, text, text)
  to authenticated, service_role;

-- commit_sales_batch passes the language through.
do $$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'accounts' and p.proname = 'commit_sales_batch';

  patched := replace(src,
    E'               nullif(v_row ->> ''state'', '''')\n             ) r;',
    E'               nullif(v_row ->> ''state'', ''''),\n               coalesce(v_row ->> ''language'', ''hindi'')\n             ) r;');
  if patched = src then raise exception 'commit_sales_batch: resolve_rate call not matched'; end if;
  src := patched;

  patched := replace(src,
    E'      is_combo, has_books_addon, combo_key, product_key, rate_source, rate_pct,',
    E'      is_combo, has_books_addon, combo_key, product_key, language, rate_source, rate_pct,');
  if patched = src then raise exception 'commit_sales_batch: insert columns not matched'; end if;
  src := patched;

  patched := replace(src,
    E'      nullif(v_row ->> ''combo_key'',''''), nullif(v_row ->> ''product_key'',''''),\n      v_source, v_pct,',
    E'      nullif(v_row ->> ''combo_key'',''''), nullif(v_row ->> ''product_key'',''''),\n      coalesce(nullif(v_row ->> ''language'',''''), ''hindi''),\n      v_source, v_pct,');
  if patched = src then raise exception 'commit_sales_batch: insert values not matched'; end if;

  execute patched;
end $$;

notify pgrst, 'reload schema';
