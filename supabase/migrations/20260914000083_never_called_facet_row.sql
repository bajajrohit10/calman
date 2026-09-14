-- The never-called group needs to be counted, not only selectable.
--
-- Giving it a key in the previous migration was half the job: the facet block
-- still ended "and c.last_called_by is not null", which had been there to stop
-- a null value_id reaching the map builder. With the coalesce in place that
-- guard is now the only thing keeping the option at zero — the filter works,
-- the count does not, and an option that always reads nothing is an option
-- nobody will click.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_facets';

  if src is null then
    raise exception 'public.recommended_facets is not defined';
  end if;

  -- Only the one that follows the coalesced select; the counsellor block above
  -- it has its own "is not null" and means something different by it (nobody
  -- is holding the lead today, which is not an option in that column).
  patched := regexp_replace(src,
    '(select ''last_called_by'', coalesce\(c\.last_called_by::text, ''__never__''\).*?)\n   and c\.last_called_by is not null',
    '\1',
    -- No 'n' flag: the guard sits two lines below the select it belongs to,
    -- and with newline-sensitive matching "." would stop at the first one.
    '');
  if patched = src then
    raise exception 'recommended_facets: the never-called guard was not found';
  end if;

  execute 'drop function if exists public.recommended_facets cascade';
  execute patched;
  execute 'revoke all on function public.recommended_facets from public';
  execute 'grant execute on function public.recommended_facets to authenticated';
end $$;
