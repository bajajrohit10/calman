-- The same blank-row problem as 0066, one lost reason further along.
--
-- 0066 let an offer row list its competitor lines so a lost-competitor lead
-- would name a teacher. 0069 then made dropped leads eligible, and a dropped
-- lead's lines are all *closed* — so the row went blank again in exactly the
-- way 0066 was written to prevent.
--
-- The row now lists what the offer matched it on, which since 0069 is any line
-- the student has not bought. One rule, stated once, instead of a list of
-- states that has to be extended every time eligibility widens.

do $$
declare
  fn record;
  src text;
  patched text;
  bucket_ref text;
begin
  for fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('my_day', 'recommended_calls')
  loop
    src := pg_get_functiondef(fn.oid);
    bucket_ref := case fn.proname when 'my_day' then 'm.bucket' else 'p.bucket' end;

    patched := replace(src,
      '(i.status = ''open'' or (' || bucket_ref || ' = ''offer'' and i.status = ''competitor''))',
      '(i.status = ''open'' or (' || bucket_ref || ' = ''offer'' and i.status <> ''won''))');

    if patched = src then
      raise exception 'no offer teacher-name test found in %', fn.proname;
    end if;

    execute patched;
  end loop;
end $$;
