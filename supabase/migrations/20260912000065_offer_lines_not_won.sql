-- A lost-competitor lead has no open lines, so the offer never saw it.
--
-- §23.4 puts lost leads under the offer, and the two kinds it names are
-- exhausted and competitor. But a competitor call sweeps every open interest
-- line to 'competitor' — that is how the teacher-wise analytics learn who we
-- lost the student to — so by the time the enquiry is lost there is nothing
-- 'open' left on it, and the bucket's "matching open line" test excluded
-- exactly the leads the brief added. Found by seeding one.
--
-- So the test becomes "a line they have not bought": open or competitor. Those
-- are the two states that mean the student still wants the subject and does
-- not have it, which is the whole population a discount is aimed at. A won
-- line is excluded by the student-level rule above it; a closed line is one
-- somebody deliberately stopped following, and stays excluded.

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
       and p.proname in ('recommended_calls', 'recommended_facets', 'my_day')
  loop
    src := pg_get_functiondef(fn.oid);
    patched := replace(src,
      'and om.item_status = ''open''',
      'and om.item_status in (''open'', ''competitor'')');

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
   where n.nspname = 'public' and p.proname = 'offer_performance';

  patched := replace(src,
    'and om.item_status = ''open''',
    'and om.item_status in (''open'', ''competitor'')');

  if patched = src then
    raise exception 'offer_performance: no line-status test found';
  end if;

  execute patched;
end $$;

-- The form's count asks the same question the bucket does.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'offer_match_count';

  patched := replace(src,
    'where i.status = ''open''',
    'where i.status in (''open'', ''competitor'')');

  if patched = src then
    raise exception 'offer_match_count: no line-status test found';
  end if;

  execute patched;
end $$;
