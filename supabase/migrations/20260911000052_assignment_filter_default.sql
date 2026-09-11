-- An unrecognised assignment filter should mean "any", not "nothing".
--
-- The predicate was a chain of ORs anchored on `p_assignment is null`, so the
-- perfectly reasonable literal 'any' matched no branch and emptied the list —
-- silently, which is the bad part. The application maps 'any' to null before
-- calling, so this was never reachable from the desk, but a hand-written call
-- or a future caller would have found it, and an empty list reads as "no work
-- today" rather than as a bug.
--
-- A CASE with an else makes "any" the default for every value that is not one
-- of the two the filter knows.
do $$
declare
  fn text;
  src text;
  old text := '(p_assignment is null
       or (p_assignment = ''unassigned'' and a.counsellor_id is null)
       or (p_assignment = ''assigned'' and a.counsellor_id is not null))';
  new text := '(case p_assignment
       when ''unassigned'' then a.counsellor_id is null
       when ''assigned''   then a.counsellor_id is not null
       else true
     end)';
  old2 text := '(p_assignment is null
       or (p_assignment = ''unassigned'' and a.counsellor_id is null)
       or (p_assignment = ''assigned'' and a.counsellor_id is not null)) as m_assignment';
  new2 text := '(case p_assignment
       when ''unassigned'' then a.counsellor_id is null
       when ''assigned''   then a.counsellor_id is not null
       else true
     end) as m_assignment';
begin
  foreach fn in array array['recommended_calls', 'recommended_facets'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    src := replace(src, old2, new2);
    src := replace(src, old, new);
    execute src;
  end loop;
end $$;
