-- A call that creates its own assignment must count as done.
--
-- Brief 19 defined done as "a call on this day made after assigned_at", which
-- is right for work handed out and then called. It is wrong for the one case
-- where the call comes first: Quick Add's "Add details & log call", and any
-- call logged on a lead nobody owned, where logCall writes the call and *then*
-- claims the enquiry. assigned_at then lands a few milliseconds after
-- called_at, the comparison fails, and the lead the counsellor has just
-- finished shows up in their own My Day as still to do.
--
-- Two halves to the fix. logCall now stamps the assignment with the call's own
-- called_at, so the assignment is recorded as having happened at the moment
-- the call did — which is the truth: the call is what caused it. And the
-- comparison becomes >=, so that exact equality reads as done.
--
-- The evening re-assignment from Brief 19 is unaffected: re-assigning stamps
-- assigned_at with now(), which is strictly after any call already logged, so
-- the lead still flips back to pending for whoever now holds it.
do $$
declare
  fn record;
  src text;
  patched text;
begin
  for fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('my_day', 'my_day_pending_count',
                         'recommended_calls', 'recommended_facets')
  loop
    src := pg_get_functiondef(fn.oid);
    patched := regexp_replace(src, '(\w+\.called_at) > (\w+\.assigned_at)', '\1 >= \2', 'g');

    if patched = src then
      raise exception 'no assigned_at comparison found in %', fn.proname;
    end if;

    execute patched;
    raise notice 'patched %', fn.proname;
  end loop;
end $$;
