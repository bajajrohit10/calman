-- §48.1, corrected. Oldest first, strictly: days ascending and, inside a day,
-- the earliest arrival first.
--
-- The first cut read "newest first" within a day, which put the most recent
-- arrival at the top of each day's block. That is the wrong way round for
-- these three lists. They are worked top to bottom and a lead that has been
-- waiting since nine in the morning should be reached before one that came in
-- at six — the same reason the day order has always been oldest first. Mixing
-- the two directions also made the list read as though it were sorted by
-- nothing in particular: descending inside ascending has no single sentence
-- that describes it.
do $$
declare
  src text;
  patched text;
begin
  ----------------------------------------------------------- new_calls_pool --
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_pool';

  patched := replace(
    src,
    'order by b.importance nulls last, b.arrived_on, b.arrived_at desc, b.enquiry_id',
    'order by b.importance nulls last, b.arrived_on, b.arrived_at, b.enquiry_id'
  );
  if patched = src then raise exception 'new_calls_pool: order by not matched'; end if;
  -- Same argument list, so this replaces rather than overloading.
  execute patched;

  ------------------------------------------------------- recommended_calls --
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_calls';

  patched := replace(
    src,
    E'         case when p.bucket = ''fresh'' then p.arrived_at end desc,\n',
    -- nulls last said explicitly: every non-fresh row yields null from this
    -- CASE, and a bare ascending sort would be relying on the default rather
    -- than stating it. Under the old `desc` the default was nulls *first*,
    -- which was harmless only because the term above already separated fresh
    -- rows from the rest.
    E'         case when p.bucket = ''fresh'' then p.arrived_at end asc nulls last,\n'
  );
  if patched = src then raise exception 'recommended_calls: fresh order not matched'; end if;
  execute patched;
end $$;
