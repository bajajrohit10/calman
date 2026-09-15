-- §47.5. The desk shows the stand-in content, so the row has to carry the
-- classification that produced it.
--
-- "Has this lead any content recorded" is already on the row: top_content_
-- priority is the lowest content priority across its open lines, and it is
-- null exactly when none of them names one. So only the classification itself
-- is missing, and the screen can decide between them.
--
-- §47.5's ordering rule also lands here. The list already sorts on
-- top_content_priority, and the auto values borrow the real contents'
-- priorities — Full is 1, Books is 5 — so sorting the stand-in alongside the
-- real thing is a coalesce in the ORDER BY rather than a second sort key.
-- Books auto-sorts after Video inside every bucket because Books sorts after
-- Full, which it already did.
do $$
declare
  src text;
  patched text;
  sig text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_calls';

  patched := replace(src, 'lost_reason lost_reason, total_count bigint)',
                          'lost_reason lost_reason, call_type text, total_count bigint)');
  if patched = src then raise exception 'recommended_calls: result shape not matched'; end if;
  src := patched;

  patched := replace(src, E'    e.lost_reason,\n', E'    e.lost_reason,\n    e.call_type,\n');
  if patched = src then raise exception 'recommended_calls: inner projection not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'  p.assignment_label, p.called_since, p.offer_names, p.offer_ids, p.lost_reason,\n',
    E'  p.assignment_label, p.called_since, p.offer_names, p.offer_ids, p.lost_reason,\n  p.call_type,\n'
  );
  if patched = src then raise exception 'recommended_calls: outer projection not matched'; end if;
  src := patched;

  -- Both orderings: the inner one that ranks inside a bucket, and the outer
  -- one that ranks the page. A lead with no content recorded now sorts where
  -- its classification says it belongs instead of falling to the end.
  patched := replace(
    src,
    E'    b.top_content_priority nulls last,\n',
    E'    coalesce(b.top_content_priority,\n'
    || E'             case b.call_type when ''video'' then 1 when ''books'' then 5 end)\n'
    || E'      nulls last,\n'
  );
  if patched = src then raise exception 'recommended_calls: inner order not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'         p.top_content_priority nulls last, p.next_follow_up_date nulls last,\n',
    E'         coalesce(p.top_content_priority,\n'
    || E'                  case p.call_type when ''video'' then 1 when ''books'' then 5 end)\n'
    || E'           nulls last, p.next_follow_up_date nulls last,\n'
  );
  if patched = src then raise exception 'recommended_calls: outer order not matched'; end if;
  src := patched;

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recommended_calls'
  loop
    execute 'drop function ' || sig;
  end loop;
  execute src;
end $$;

grant execute on function public.recommended_calls to anon, authenticated, service_role;
