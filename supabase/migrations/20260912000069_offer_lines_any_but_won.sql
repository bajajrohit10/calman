-- A dropped lead has no line an offer could match on.
--
-- app.recompute_enquiry reaches lost/dropped in exactly one way: a purchased
-- call that won nothing, on an enquiry whose every line has been closed. So
-- "dropped" and "all lines closed" are the same state, and the line test
-- introduced in 0065 — open or competitor — excluded every dropped lead there
-- can be. Adding dropped to the status filter without this would have added a
-- fourth checkbox that never matched a row.
--
-- The test becomes "a line they have not bought". Open, competitor and closed
-- all mean the same thing to an offer: they wanted this and they do not have
-- it. Buying is the one state that disqualifies a line, and the student-level
-- rule above it already disqualifies the person.
--
-- Closed lines only change the answer when every line is closed — an open
-- enquiry matches on its open lines either way — so in practice this is the
-- dropped case and nothing else.

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
       and p.proname in ('recommended_calls', 'recommended_facets', 'my_day',
                         'offer_performance')
  loop
    src := pg_get_functiondef(fn.oid);
    patched := replace(src,
      'om.item_status in (''open'', ''competitor'')',
      'om.item_status <> ''won''');

    if patched = src then
      raise exception 'no offer line-status test found in %', fn.proname;
    end if;

    execute patched;
  end loop;
end $$;

do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'offer_match_count';

  patched := replace(src,
    'where i.status in (''open'', ''competitor'')',
    'where i.status <> ''won''');

  if patched = src then
    raise exception 'offer_match_count: no line-status test found';
  end if;

  execute patched;
end $$;
