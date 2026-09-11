-- 0052 patched recommended_facets and missed recommended_calls: the two
-- functions indent the same predicate differently, and the replacement was an
-- exact string. Same change, matched on shape rather than on whitespace.
do $$
declare
  fn text;
  src text;
  patched text;
  pattern text :=
    '\(p_assignment is null\s+or \(p_assignment = ''unassigned'' and a\.counsellor_id is null\)\s+or \(p_assignment = ''assigned'' and a\.counsellor_id is not null\)\)';
  replacement text :=
    '(case p_assignment when ''unassigned'' then a.counsellor_id is null when ''assigned'' then a.counsellor_id is not null else true end)';
begin
  foreach fn in array array['recommended_calls', 'recommended_facets'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    patched := regexp_replace(src, pattern, replacement, 'g');
    if patched = src then
      raise notice 'assignment predicate already current in %', fn;
    else
      execute patched;
      raise notice 'patched %', fn;
    end if;
  end loop;
end $$;
