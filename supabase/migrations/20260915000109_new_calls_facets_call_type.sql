-- §47.5. The New Calls facet counts have to know about the type tabs.
--
-- Without this they do not: the tabs narrow the list and the facets keep
-- counting the whole pool, the two totals stop agreeing, and the screen's own
-- guard hides the filter counts with "Filter counts are out of step with the
-- list". So picking a tab would have silently cost the counsellor the entire
-- filter bar.
--
-- Call type is not itself a facet here — it is tabs above the bar, and the
-- tabs get their counts from new_calls_type_counts — so it needs none of the
-- "count every option except my own" treatment the real facets get. It prunes
-- the candidate set once, in cand, and every facet below is scoped by
-- construction.
do $$
declare
  src text;
  patched text;
  sig text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_facets';

  patched := replace(
    src,
    'p_institute_id uuid DEFAULT NULL::uuid)',
    'p_institute_id uuid DEFAULT NULL::uuid, p_call_types text[] DEFAULT NULL::text[])'
  );
  if patched = src then raise exception 'new_calls_facets: signature not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'    and (p_product_text is null or e.product_text ilike ''%'' || p_product_text || ''%'')\n',
    E'    and (p_product_text is null or e.product_text ilike ''%'' || p_product_text || ''%'')\n'
    || E'    and (p_call_types is null or cardinality(p_call_types) = 0\n'
    || E'         or e.call_type = any (p_call_types))\n'
  );
  if patched = src then raise exception 'new_calls_facets: cand where not matched'; end if;

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'new_calls_facets'
  loop
    execute 'drop function ' || sig;
  end loop;
  execute patched;
end $$;

grant execute on function public.new_calls_facets to anon, authenticated, service_role;
