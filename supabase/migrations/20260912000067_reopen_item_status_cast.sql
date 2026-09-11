-- reopen_via_offer inserted the copied lines with an untyped 'open'.
--
-- The select list carries it as text and enquiry_items.status is
-- public.item_status, so every reopen failed at the copy step with "column
-- status is of type public.item_status but expression is of type text". The
-- literal in the VALUES form above it is fine — a literal in an INSERT ...
-- VALUES is coerced from the target column, one in an INSERT ... SELECT is
-- not.

do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reopen_via_offer';

  if src is null then
    raise exception 'public.reopen_via_offer is not defined';
  end if;

  patched := replace(src,
    E'i.content_id,\n         ''open'', (select auth.uid())',
    E'i.content_id,\n         ''open''::public.item_status, (select auth.uid())');

  if patched = src then
    raise exception 'reopen_via_offer: the item status literal was not found';
  end if;

  execute patched;
end $$;
