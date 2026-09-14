-- Calman — the facet counts and the list must describe the same set.
--
-- Brief 36.2. The desk shows a count beside every filter option; those counts
-- come from recommended_facets and the rows come from recommended_calls. They
-- are two queries, so they can drift — and a count that disagrees with the
-- list it is counting is worse than no count, because it looks like knowledge.
--
-- Two assertions, run for every value the Assignment filter can take:
--
--   * the _total guard row equals the list's own total. This is the check the
--     screen already makes at runtime before it will show any count at all;
--     the test makes it fail loudly in CI instead of quietly hiding numbers
--     in front of a user.
--
--   * every option of every facet equals the list filtered to that option.
--     The guard above cannot catch a facet whose totals happen to add up while
--     an individual option is counted over the wrong scope, which is exactly
--     the failure this test was written for.
--
-- Read-only: it calls two stable functions and writes nothing, so it is safe
-- against the live database.
--
--   supabase db query --linked -f supabase/tests/facet_scope_test.sql

with scopes as (
  select unnest(array['needs', 'pending', 'done', null]) as assignment
),
-- 1. The guard row against the list, per scope.
totals as (
  select
    coalesce(s.assignment, 'any') as scope,
    (select f.numbers
       from public.recommended_facets(
              p_date => app.ist_today(), p_assignment => s.assignment) f
      where f.facet = '_total') as facet_total,
    (select count(*)
       from public.recommended_calls(
              p_date => app.ist_today(), p_assignment => s.assignment,
              p_limit => 5000)) as list_total
  from scopes s
),
-- 2. Every option of every facet, against the list narrowed to that option.
--    Only the facets the desk offers as filters can be checked this way: a
--    facet with no matching filter parameter has nothing to compare against.
options as (
  select
    coalesce(s.assignment, 'any') as scope,
    f.facet,
    f.value_id,
    f.numbers as facet_says,
    case f.facet
      when 'teacher' then (
        select count(*) from public.recommended_calls(
          p_date => app.ist_today(), p_assignment => s.assignment,
          p_teacher_ids => array[f.value_id::uuid], p_limit => 5000))
      when 'content' then (
        select count(*) from public.recommended_calls(
          p_date => app.ist_today(), p_assignment => s.assignment,
          p_content_ids => array[f.value_id::uuid], p_limit => 5000))
      when 'institute' then (
        select count(*) from public.recommended_calls(
          p_date => app.ist_today(), p_assignment => s.assignment,
          p_institute_ids => array[f.value_id::uuid], p_limit => 5000))
      when 'importance' then (
        select count(*) from public.recommended_calls(
          p_date => app.ist_today(), p_assignment => s.assignment,
          p_importance => array[f.value_id::public.importance], p_limit => 5000))
      when 'stage' then (
        select count(*) from public.recommended_calls(
          p_date => app.ist_today(), p_assignment => s.assignment,
          p_stages => array[f.value_id], p_limit => 5000))
      when 'last_called_by' then (
        case when f.value_id = '__never__' then (
          select count(*) from public.recommended_calls(
            p_date => app.ist_today(), p_assignment => s.assignment,
            p_never_called => true, p_limit => 5000))
        else (
          select count(*) from public.recommended_calls(
            p_date => app.ist_today(), p_assignment => s.assignment,
            p_last_called_by => array[f.value_id::uuid], p_limit => 5000))
        end)
    end as list_says
  from scopes s
  cross join lateral public.recommended_facets(
    p_date => app.ist_today(), p_assignment => s.assignment) f
  where f.facet in ('teacher', 'content', 'institute', 'importance', 'stage', 'last_called_by')
    -- "No detail" is its own filter shape (p_no_detail), not an id in a list.
    and f.value_id <> '__none__'
),
failures as (
  select scope, '_total' as facet, '' as value_id, facet_total, list_total
    from totals where facet_total is distinct from list_total
  union all
  select scope, facet, value_id, facet_says, list_says
    from options where list_says is not null and facet_says is distinct from list_says
)
select
  case when count(*) = 0
    then 'PASS — every facet count matches the list it counts, in every Assignment scope'
    else 'FAIL — ' || count(*) || ' mismatches: ' ||
         string_agg(scope || '/' || facet || '/' || value_id ||
                    ' facet=' || facet_total || ' list=' || list_total, '; ')
  end as result
from failures;
