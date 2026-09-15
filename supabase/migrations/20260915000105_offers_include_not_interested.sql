-- §47.3: a "not interested" lead is "included in offers like lost leads".
--
-- It would not have been. The offer views do not ask "is this lead lost" —
-- they name the three reasons one at a time, so a fourth reason matches no
-- branch and the lead disappears from the offer lists entirely. That is the
-- opposite of the brief, and it is silent: nobody sees the row that is not
-- there.
--
-- So both readers learn the reason, and it joins the default set — a lead that
-- said no to one offer is exactly who the next offer is for.
do $$
declare
  fn text;
  src text;
  patched text;
  branch constant text :=
    E'\n             or (e.status = ''lost'' and e.lost_reason = ''not_interested'''
    || E'\n                 and ''lost_not_interested'' = any (t.os))';
begin
  foreach fn in array array['recommended_calls', 'recommended_facets'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    -- The default set, when the caller names no statuses.
    patched := replace(
      src,
      'array[''open'',''lost_exhausted'',''lost_competitor'',''lost_dropped'']',
      'array[''open'',''lost_exhausted'',''lost_competitor'',''lost_dropped'',''lost_not_interested'']'
    );
    if patched = src then
      raise exception '%: default offer-status array not found', fn;
    end if;
    src := patched;

    -- The branch. Matched loosely on whitespace because the two functions
    -- indent this block differently.
    patched := regexp_replace(
      src,
      '(\(e\.status = ''lost'' and e\.lost_reason = ''dropped''\s+and ''lost_dropped'' = any \(t\.os\)\))',
      '\1' || branch,
      'g'
    );
    if patched = src then
      raise exception '%: lost_dropped branch not found', fn;
    end if;

    execute patched;
  end loop;
end $$;
