-- Brief 34: what Smart Assign needs that the desk's filters did not have.
--
-- Almost nothing, as it turns out. recommended_facets has expressed
-- "this column is an OR, and 'nothing recorded' is one of its options" since
-- Brief 17 — m_teacher is already "no filter, or one of these teachers, or no
-- teacher at all". A panel whose columns are exactly that needed two gaps
-- closed rather than a new engine:
--
--   * Institute was single-valued. Every other column takes a list; this one
--     took one id, so it could not be a column of options like the rest.
--   * "Never called" had no option. The facet emitted a row keyed on a null
--     counsellor, which the map builder drops on the floor, and no filter
--     could ask for it — so the one group a manager most wants to hand out was
--     the one group that could not be selected.
--
-- Patched rather than restated, and by regexp rather than by literal, because
-- the two functions say the same things with different line breaks: the first
-- attempt at this migration asserted its way to a halt on exactly that, which
-- is the assertion earning its keep.
do $$
declare
  fn text;
  src text;
  patched text;
  done integer := 0;
begin
  foreach fn in array array['recommended_facets', 'recommended_calls'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    if src is null then
      raise exception 'public.% is not defined', fn;
    end if;

    -- 1. Two new parameters, on the end so every named call still resolves.
    patched := replace(src,
      'p_offer_statuses text[] DEFAULT NULL::text[])',
      'p_offer_statuses text[] DEFAULT NULL::text[], p_institute_ids uuid[] DEFAULT NULL::uuid[], p_never_called boolean DEFAULT false)');
    if patched = src then
      raise exception '%: the argument list was not found', fn;
    end if;
    src := patched;

    -- 2. Institute takes a list as well as the single id it always took.
    patched := regexp_replace(src,
      'and \(p_institute_id is null\)',
      'and (p_institute_id is null and (p_institute_ids is null or cardinality(p_institute_ids) = 0))',
      'g');
    if patched = src then
      raise exception '%: the institute guard was not found', fn;
    end if;
    src := patched;

    patched := regexp_replace(src,
      'not \(p_institute_id is null\) and exists',
      'not (p_institute_id is null and (p_institute_ids is null or cardinality(p_institute_ids) = 0)) and exists',
      'g');
    if patched = src then
      raise exception '%: the institute branch was not found', fn;
    end if;
    src := patched;

    patched := regexp_replace(src,
      'and tch\.institute_id = p_institute_id',
      'and (tch.institute_id = p_institute_id or tch.institute_id = any (coalesce(p_institute_ids, ''{}''::uuid[])))',
      'g');
    if patched = src then
      raise exception '%: the institute test was not found', fn;
    end if;
    src := patched;

    -- 3. "Never called" joins the Last-called-by column. The three arms read
    --    as the column does: nothing chosen means everything; a name means
    --    that name; Never means the ones nobody has spoken to.
    patched := regexp_replace(src,
      '\(\(p_last_called_by is null or cardinality\(p_last_called_by\) = 0\)(\s*)or lc\.called_by = any \(p_last_called_by\)\)',
      '(((p_last_called_by is null or cardinality(p_last_called_by) = 0) and not coalesce(p_never_called, false))\1or lc.called_by = any (coalesce(p_last_called_by, ''{}''::uuid[]))\1or (coalesce(p_never_called, false) and lc.called_by is null))',
      'g');
    if patched = src then
      raise exception '%: the last-called-by test was not found', fn;
    end if;
    src := patched;

    -- 4. In the facet list only: give the never-called group a key, so it
    --    survives the map builder and can be clicked like any other option.
    if fn = 'recommended_facets' then
      patched := replace(src,
        'select ''last_called_by'', c.last_called_by::text,',
        'select ''last_called_by'', coalesce(c.last_called_by::text, ''__never__''),');
      if patched = src then
        raise exception '%: the last_called_by facet row was not found', fn;
      end if;
      src := patched;
    end if;

    execute 'drop function if exists public.' || fn || ' cascade';
    execute src;
    execute 'revoke all on function public.' || fn || ' from public';
    execute 'grant execute on function public.' || fn || ' to authenticated';
    done := done + 1;
  end loop;

  if done <> 2 then
    raise exception 'expected to patch two functions, patched %', done;
  end if;
end $$;

comment on function public.recommended_facets is
  'Leave-one-out counts for the desk and for Smart Assign (§5.5, Brief 34). '
  'Every column is an OR over its options, "nothing recorded" included; the '
  '_total row is the guard the screens check their own total against.';
