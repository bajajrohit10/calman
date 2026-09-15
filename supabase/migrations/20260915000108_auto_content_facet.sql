-- §47.5. Where a lead's interest lines carry no content, the derived call type
-- stands in for one — "Full (auto)", "Books (auto)" — on the desk, in Smart
-- Assign and on Enquiries, in both the facet and the filter.
--
-- It travels as its own parameter rather than inside p_content_ids. That
-- parameter is uuid[], and widening it to text[] would mean rewriting how
-- content filtering works in the two largest functions in the schema to carry
-- two values that are not ids. There is already a precedent for the other
-- shape: '__none__' rides in the option list and is split out into p_no_detail
-- before the call. The auto values do the same, so every existing expression
-- about real content stays exactly as it is and the new behaviour is an OR
-- branch beside it.
--
-- Nothing here writes to enquiry_items. The stand-in is a display and filter
-- rule over a value derived on the enquiry, which is what the brief asks for:
-- a counsellor who sets real content overrides it, because real content makes
-- the branch below unreachable for that lead.

do $$
declare
  src text;
  patched text;
  sig text;
  hits int;
begin
  ----------------------------------------------------------------- calls ----
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_calls';

  patched := replace(
    src,
    'p_never_called boolean DEFAULT false)',
    'p_never_called boolean DEFAULT false, p_auto_contents text[] DEFAULT NULL::text[])'
  );
  if patched = src then raise exception 'recommended_calls: signature not matched'; end if;
  src := patched;

  -- "No content filter at all" now has to mean neither kind of content filter.
  patched := replace(
    src,
    E'           when not (''content'' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0)\n',
    E'           when not (''content'' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0)\n'
    || E'                and (p_auto_contents is null or cardinality(p_auto_contents) = 0)\n'
  );
  if patched = src then raise exception 'recommended_calls: content no-filter branch not matched'; end if;
  src := patched;

  hits := (length(src) - length(replace(src, E'                         and i.content_id is not null))\n', ''))) /
          length(E'                         and i.content_id is not null))\n');
  if hits <> 1 then
    raise exception 'recommended_calls: expected 1 content __none__ branch, found %', hits;
  end if;
  src := replace(
    src,
    E'                         and i.content_id is not null))\n',
    E'                         and i.content_id is not null))\n'
    || E'                -- §47.5. The derived type stands in, but only where\n'
    || E'                -- nothing real was recorded.\n'
    || E'                or (not (p_auto_contents is null or cardinality(p_auto_contents) = 0)\n'
    || E'                    and e.call_type = any (p_auto_contents)\n'
    || E'                    and not exists (select 1 from public.enquiry_items i\n'
    || E'                           where i.enquiry_id = e.id and i.status = ''open''\n'
    || E'                             and i.content_id is not null))\n'
  );

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recommended_calls'
  loop
    execute 'drop function ' || sig;
  end loop;
  execute src;

  ---------------------------------------------------------------- facets ----
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_facets';

  patched := replace(
    src,
    'p_never_called boolean DEFAULT false)',
    'p_never_called boolean DEFAULT false, p_auto_contents text[] DEFAULT NULL::text[])'
  );
  if patched = src then raise exception 'recommended_facets: signature not matched'; end if;
  src := patched;

  -- The candidate set carries the classification, so the emission below can
  -- group on it without joining enquiries a second time.
  patched := replace(
    src,
    E'    e.term_id, e.source_id, e.importance, e.status,\n',
    E'    e.term_id, e.source_id, e.importance, e.status, e.call_type,\n'
  );
  if patched = src then raise exception 'recommended_facets: cand projection not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'       when not (''content'' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0) then true\n',
    E'       when not (''content'' = any (t.nd)) and (p_content_ids is null or cardinality(p_content_ids) = 0)\n'
    || E'            and (p_auto_contents is null or cardinality(p_auto_contents) = 0) then true\n'
  );
  if patched = src then raise exception 'recommended_facets: m_content no-filter branch not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'                     and i.content_id is not null))\n     end) as m_content,',
    E'                     and i.content_id is not null))\n'
    || E'            or (not (p_auto_contents is null or cardinality(p_auto_contents) = 0)\n'
    || E'                and e.call_type = any (p_auto_contents)\n'
    || E'                and not exists (select 1 from public.enquiry_items i\n'
    || E'                       where i.enquiry_id = e.id and i.status = ''open''\n'
    || E'                         and i.content_id is not null))\n'
    || E'     end) as m_content,'
  );
  if patched = src then raise exception 'recommended_facets: m_content matcher not matched'; end if;
  src := patched;

  -- Two more options in the content facet, counted over exactly the rows the
  -- '__none__' option already counts — a lead with no content recorded — split
  -- by what it was classified as. Unknown gets no option: it stands in for
  -- nothing, and an "Unknown (auto)" filter would just be '__none__' again
  -- under a name that implies a finding.
  patched := replace(
    src,
    E'select ''content'', ''__none__'', count(*)::integer, 0\n',
    E'select ''content'', ''auto:'' || c.call_type, count(*)::integer, 0\n'
    || E'  from cand c\n'
    || E' where c.m_ostatus and c.m_offer and c.m_bucket and c.m_status and c.m_couns and c.m_stage and c.m_assignment and c.m_lastby and c.m_lastout and c.m_source and c.m_term and c.m_importance and c.m_teacher and c.m_course and c.m_subject and c.m_institute and c.n_content\n'
    || E'   and c.call_type in (''video'', ''books'')\n'
    || E' group by 2\n'
    || E'union all\n'
    || E'select ''content'', ''__none__'', count(*)::integer, 0\n'
  );
  if patched = src then raise exception 'recommended_facets: __none__ content emission not matched'; end if;
  src := patched;

  for sig in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recommended_facets'
  loop
    execute 'drop function ' || sig;
  end loop;
  execute src;
end $$;

grant execute on function public.recommended_calls to anon, authenticated, service_role;
grant execute on function public.recommended_facets to anon, authenticated, service_role;
