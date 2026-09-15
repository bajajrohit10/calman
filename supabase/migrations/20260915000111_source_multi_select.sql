-- §47.6. Smart Assign gains a Source column, "same behaviour as the others" —
-- which means a list of ticked options plus "No detail", not the single value
-- the desk has always sent.
--
-- The source facet and its m_source matcher already exist; both readers just
-- never had a way to be told more than one. So: a plural parameter beside the
-- singular one, and the "nothing recorded" option the other columns already
-- carry. p_source_id stays and still works, because the desk's own filter bar
-- sends it and this brief is not about changing that screen.
do $$
declare
  fn text;
  src text;
  patched text;
  sig text;
  matcher constant text :=
    E'(case\n'
    || E'           when p_source_id is null\n'
    || E'                and (p_source_ids is null or cardinality(p_source_ids) = 0)\n'
    || E'                and not (''source'' = any (t.nd)) then true\n'
    || E'           else (p_source_id is not null and e.source_id = p_source_id)\n'
    || E'                or (p_source_ids is not null and cardinality(p_source_ids) > 0\n'
    || E'                    and e.source_id = any (p_source_ids))\n'
    || E'                or (''source'' = any (t.nd) and e.source_id is null)\n'
    || E'         end)';
begin
  foreach fn in array array['recommended_calls', 'recommended_facets'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    patched := replace(
      src,
      'p_never_called boolean DEFAULT false',
      'p_never_called boolean DEFAULT false, p_source_ids uuid[] DEFAULT NULL::uuid[]'
    );
    if patched = src then raise exception '%: signature not matched', fn; end if;
    src := patched;

    if fn = 'recommended_calls' then
      patched := replace(
        src,
        '    and (p_source_id is null or e.source_id = p_source_id)',
        '    and ' || matcher
      );
    else
      patched := replace(
        src,
        '    (p_source_id is null or e.source_id = p_source_id) as m_source,',
        '    ' || matcher || ' as m_source,'
      );
    end if;
    if patched = src then raise exception '%: source matcher not matched', fn; end if;
    src := patched;

    -- The "No detail" option needs counting as well as filtering, or the
    -- column would offer something with no number against it.
    if fn = 'recommended_facets' then
      patched := replace(
        src,
        E'   and c.source_id is not null\n group by 2\n',
        E'   and c.source_id is not null\n group by 2\n'
        || E'union all\n'
        || E'select ''source'', ''__none__'', count(*)::integer, 0\n'
        || E'  from cand c\n'
        || E' where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_content and c.m_institute\n'
        || E'   and c.source_id is null\n'
        || E' group by 2\n'
      );
      if patched = src then raise exception 'recommended_facets: source emission not matched'; end if;
      src := patched;
    end if;

    for sig in
      select p.oid::regprocedure::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute 'drop function ' || sig;
    end loop;
    execute src;
  end loop;
end $$;

grant execute on function public.recommended_calls to anon, authenticated, service_role;
grant execute on function public.recommended_facets to anon, authenticated, service_role;
