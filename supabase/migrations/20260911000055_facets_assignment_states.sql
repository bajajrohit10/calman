-- recommended_facets kept the old assignment states, so every count ignored
-- the filter.
--
-- 0054 replaced the predicate by exact string in both functions. In the list it
-- was on one line (0053 collapsed it) and matched; in the facets it was still
-- the multi-line form 0052 left behind, so the replacement silently did
-- nothing. m_assignment went on testing for 'unassigned' and 'assigned', which
-- 'needs' / 'pending' / 'done' never equal, so it fell to `else true` and every
-- facet — including the _total guard — counted the unfiltered set. The guard
-- did its job and the desk showed no counts at all rather than wrong ones.
--
-- Matched on shape this time, and asserted afterwards: a replacement that
-- changes nothing is the failure mode worth failing on.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_facets';

  patched := regexp_replace(
    src,
    '\(case p_assignment\s+when ''unassigned'' then a\.counsellor_id is null\s+when ''assigned''\s+then a\.counsellor_id is not null\s+else true\s+end\) as m_assignment',
    '(case p_assignment '
    || 'when ''needs'' then a.counsellor_id is null or a.called_since '
    || 'when ''pending'' then a.counsellor_id is not null and not a.called_since '
    || 'when ''done'' then a.counsellor_id is not null and a.called_since '
    || 'else true end) as m_assignment',
    'g');

  if patched = src then
    raise exception 'recommended_facets: assignment predicate not found, nothing patched';
  end if;

  execute patched;
end $$;
