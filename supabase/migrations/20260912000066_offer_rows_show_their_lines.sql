-- An offer row that says "no interests yet" is telling the counsellor nothing.
--
-- My Day and the desk both list a row's teachers from its *open* interest
-- lines, which was right when every row was an open lead. §23.4 put lost
-- leads on the offer tab, and a lost-competitor lead has no open lines at all
-- — the competitor call swept them — so the one thing the counsellor needs
-- before dialling, which teacher this offer is about, came out blank.
--
-- The fix is scoped to the offer bucket: those rows list open and competitor
-- lines, which is exactly the set the offer matched them on. Every other
-- bucket is unchanged.
--
-- Matched on the array_agg that starts the teacher-name subquery, not on the
-- item-status test alone: the institute facet predicate is the same shape from
-- `public.enquiry_items i` down, sits in a different scope, and a looser
-- pattern rewrote that too.

do $$
declare
  fn record;
  src text;
  patched text;
  bucket_ref text;
begin
  for fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.proname in ('my_day', 'recommended_calls')
  loop
    src := pg_get_functiondef(fn.oid);
    -- The row's bucket is named for the CTE it comes from in each function.
    bucket_ref := case fn.proname when 'my_day' then 'm.bucket' else 'p.bucket' end;

    patched := regexp_replace(
      src,
      '(array_agg\(distinct tch\.name order by tch\.name\)\s+from public\.enquiry_items i\s+join public\.teachers tch on tch\.id = i\.teacher_id\s+where i\.enquiry_id = [a-z]+\.(?:id|enquiry_id) and )i\.status = ''open''',
      '\1(i.status = ''open'' or (' || bucket_ref || ' = ''offer'' and i.status = ''competitor''))',
      'g');

    if patched = src then
      raise exception 'no teacher_names subquery found in %', fn.proname;
    end if;

    execute patched;
  end loop;
end $$;
