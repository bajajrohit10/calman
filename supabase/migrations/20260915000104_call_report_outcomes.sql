-- §47.3 asks for "Not interested" to land in the Closed column of Reports.
-- While opening call_report to do that, its own assertion turns out to be
-- firing.
--
-- The function counts the same calls two ways — total_calls, and the sum of
-- the per-outcome columns — and carries a `mismatch` flag per row for when
-- they disagree. It says why they would: "unless an outcome has been added to
-- the enum without being added to the CASE above". That is exactly what Brief
-- 44 did. 'working' and 'pending_institute' joined call_outcome and never
-- joined out_after_sale, so every ticket left in either state has been missing
-- from the outcome columns ever since. Measured on the live database before
-- this ran: 104 calls in the last seven days, 101 counted, three 'working'
-- calls unaccounted for, and the Reports screen flagging the row.
--
-- So two changes, not one:
--   out_closed     also counts 'not_interested'      (§47.3)
--   out_after_sale also counts the two Brief 44 left behind
--
-- Patched by substitution against the live definition rather than restated:
-- the same reasoning as §47.3's recompute_enquiry patch, and the raise makes a
-- missed match loud.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'call_report';

  patched := replace(
    src,
    'where outcome = ''closed'')',
    'where outcome in (''closed'',''not_interested''))'
  );
  if patched = src then
    raise exception 'call_report: out_closed filter not found; not patched';
  end if;

  src := patched;
  patched := replace(
    src,
    'where outcome in (''noted'',''escalated'',''resolved'')',
    'where outcome in (''noted'',''working'',''escalated'',''pending_institute'',''resolved'')'
  );
  if patched = src then
    raise exception 'call_report: out_after_sale filter not found; not patched';
  end if;

  execute patched;
end $$;
