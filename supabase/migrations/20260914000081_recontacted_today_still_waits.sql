-- A ticket re-contacted today is waiting, even if somebody called it today.
--
-- new_calls_after_sale excluded anything called today, which is right for a
-- ticket sitting quietly: somebody has been on it, it is not waiting. It is
-- wrong the moment the number rings again. The student called back *after*
-- that conversation — that is what re-contacted means — and hiding the row
-- because of the call they are ringing about is precisely backwards.
--
-- re_enquired_at is a date rather than an instant, so "since the last call"
-- cannot be asked exactly. Within a day the useful answer is the blunt one:
-- if the number came in again today, it is waiting today.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_after_sale';

  if src is null then
    raise exception 'public.new_calls_after_sale is not defined';
  end if;

  patched := replace(src,
    E'    and not exists (\n      select 1 from public.calls c\n       where c.enquiry_id = e.id and c.call_date = app.ist_today()\n    )',
    E'    and (\n      e.re_enquired_at = app.ist_today()\n      or not exists (\n        select 1 from public.calls c\n         where c.enquiry_id = e.id and c.call_date = app.ist_today()\n      )\n    )');

  if patched = src then
    raise exception 'new_calls_after_sale: the called-today guard was not found';
  end if;

  execute patched;
end $$;

revoke all on function public.new_calls_after_sale from public;
grant execute on function public.new_calls_after_sale to authenticated;
