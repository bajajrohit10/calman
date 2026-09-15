-- §47.5. New Calls gains Video · Books · Unknown, "on top of the existing
-- filters" — so it is one more filter on the pool, not a second pool.
--
-- new_calls_pool grows a parameter and returns the classification. A parameter
-- cannot be added by CREATE OR REPLACE: a different argument list makes a new
-- overload sitting beside the old one, and PostgREST then refuses the call as
-- ambiguous. Brief 42 lost an afternoon to exactly that. So the live text is
-- read, patched, the old function dropped, and the patched text executed.

do $$
declare
  src text;
  patched text;
  hits int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'new_calls_pool';

  -- 1. The new parameter, last so every existing named call still resolves.
  patched := replace(
    src,
    'p_institute_id uuid DEFAULT NULL::uuid)',
    'p_institute_id uuid DEFAULT NULL::uuid, p_call_types text[] DEFAULT NULL::text[])'
  );
  if patched = src then raise exception 'new_calls_pool: signature not matched'; end if;
  src := patched;

  -- 2. The classification comes back with the row, so the board can show it
  --    without a second lookup.
  patched := replace(
    src,
    're_enquired_at date, total_count bigint)',
    're_enquired_at date, call_type text, total_count bigint)'
  );
  if patched = src then raise exception 'new_calls_pool: result shape not matched'; end if;
  src := patched;

  hits := (length(src) - length(replace(src, E'    e.re_enquired_at,\n', ''))) /
          length(E'    e.re_enquired_at,\n');
  if hits <> 1 then
    raise exception 'new_calls_pool: expected 1 base projection of re_enquired_at, found %', hits;
  end if;
  src := replace(src, E'    e.re_enquired_at,\n', E'    e.re_enquired_at,\n    e.call_type,\n');

  patched := replace(
    src,
    E'  b.created_at, b.re_enquired_at,\n',
    E'  b.created_at, b.re_enquired_at, b.call_type,\n'
  );
  if patched = src then raise exception 'new_calls_pool: outer projection not matched'; end if;
  src := patched;

  -- 3. The filter itself, appended to the last of the existing ones.
  patched := replace(
    src,
    '             and tch.institute_id = p_institute_id))',
    '             and tch.institute_id = p_institute_id))'
    || E'\n    and (p_call_types is null or cardinality(p_call_types) = 0'
    || E'\n         or e.call_type = any (p_call_types))'
  );
  if patched = src then raise exception 'new_calls_pool: institute filter not matched'; end if;

  drop function if exists public.new_calls_pool(
    uuid[], uuid, uuid[], public.importance[], uuid, date, date, text, uuid[],
    integer, integer, uuid);

  execute patched;
end $$;

grant execute on function public.new_calls_pool(
  uuid[], uuid, uuid[], public.importance[], uuid, date, date, text, uuid[],
  integer, integer, uuid, text[]
) to anon, authenticated, service_role;

-- The three tab counts.
--
-- Built by asking new_calls_pool itself rather than by restating its filters.
-- A count that disagrees with the list under it is worse than a slow one, and
-- a second copy of a sixty-line WHERE clause is how that disagreement starts.
-- p_call_types is deliberately not passed through: every tab shows all three
-- counts, so selecting one must not zero the other two.
create or replace function public.new_calls_type_counts(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_ids uuid[] default null,
  p_importance public.importance[] default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null,
  p_content_ids uuid[] default null,
  p_institute_id uuid default null
)
returns table(call_type text, n integer)
language sql
stable
set search_path to ''
as $$
  select p.call_type, count(*)::integer
    from public.new_calls_pool(
           p_source_ids   => p_source_ids,
           p_course_id    => p_course_id,
           p_teacher_ids  => p_teacher_ids,
           p_importance   => p_importance,
           p_term_id      => p_term_id,
           p_created_from => p_created_from,
           p_created_to   => p_created_to,
           p_product_text => p_product_text,
           p_content_ids  => p_content_ids,
           p_institute_id => p_institute_id,
           -- Everything the filters allow, so the counts describe the whole
           -- pool and not the first page of it.
           p_limit        => 1000000,
           p_offset       => 0,
           p_call_types   => null
         ) p
   group by p.call_type;
$$;

grant execute on function public.new_calls_type_counts(
  uuid[], uuid, uuid[], public.importance[], uuid, date, date, text, uuid[], uuid
) to anon, authenticated, service_role;
