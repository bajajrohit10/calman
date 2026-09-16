-- §49.2. The desk marks a lead whose interests nobody has confirmed.
--
-- One boolean rather than the lines themselves: the desk shows teacher chips,
-- not lines, and the question it has to answer is "should a manager treat this
-- row's interests as read". That is per enquiry, and it is cheap — the partial
-- index added with the column answers it directly.
do $$
declare
  src text;
  patched text;
  sig text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_calls';

  patched := replace(src, 'arrived_at timestamp with time zone, total_count bigint)',
                          'arrived_at timestamp with time zone, has_auto boolean, total_count bigint)');
  if patched = src then raise exception 'recommended_calls: result shape not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'    coalesce(e.arrived_at, e.created_at) as arrived_at,\n',
    E'    coalesce(e.arrived_at, e.created_at) as arrived_at,\n'
    || E'    exists (select 1 from public.enquiry_items i\n'
    || E'             where i.enquiry_id = e.id and i.is_auto\n'
    || E'               and i.status = ''open'') as has_auto,\n'
  );
  if patched = src then raise exception 'recommended_calls: inner projection not matched'; end if;
  src := patched;

  patched := replace(src, E'  p.call_type, p.arrived_at,\n', E'  p.call_type, p.arrived_at, p.has_auto,\n');
  if patched = src then raise exception 'recommended_calls: outer projection not matched'; end if;

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recommended_calls'
  loop execute 'drop function ' || sig; end loop;
  execute patched;
end $$;

grant execute on function public.recommended_calls to anon, authenticated, service_role;
