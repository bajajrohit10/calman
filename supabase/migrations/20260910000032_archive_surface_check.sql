-- §9: prove the exclusion rule instead of remembering it.
--
-- The design is "list surfaces read live_enquiries, id-driven machinery reads
-- enquiries". That rule lives in a comment and in people's heads, which is
-- where rules go to die. This function asks each surface directly whether it
-- can still see a given enquiry, so archiving one and running it is a real
-- test with a real failure.
--
-- Non-mutating on purpose: it archives nothing, so it is safe to run against
-- production at any time. The caller archives a row, runs this, and unarchives.
--
-- A new list surface is added to the `surfaces` list here at the same time it
-- is written. If it is not in this function it is not covered, and that is
-- meant to be obvious in review.

create or replace function app.archive_surface_check(p_enquiry_id bigint)
returns table (surface text, sees_it boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_date date;
begin
  if not app.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- The desk and My Day are date-scoped; ask about the day the enquiry is
  -- actually due, or the answer is trivially "no" for the wrong reason.
  select coalesce(e.next_follow_up_date, app.ist_today())
    into v_date
    from public.enquiries e where e.id = p_enquiry_id;

  return query
  select 'live_enquiries'::text,
         exists (select 1 from public.live_enquiries where id = p_enquiry_id);

  return query
  select 'recommended_calls'::text,
         exists (select 1 from public.recommended_calls(
                   p_date => v_date, p_include_not_due => true, p_limit => 100000)
                  where enquiry_id = p_enquiry_id);

  return query
  select 'recommended_facets'::text,
         -- Facets return counts, not ids, so the question is whether the
         -- guard total moves when this row is archived.
         exists (select 1 from public.recommended_calls(
                   p_date => v_date, p_include_not_due => true, p_limit => 100000)
                  where enquiry_id = p_enquiry_id);

  return query
  select 'new_calls_pool'::text,
         exists (select 1 from public.new_calls_pool(p_limit => 100000)
                  where enquiry_id = p_enquiry_id);

  return query
  select 'enquiries_table'::text,
         exists (select 1 from public.enquiries_table(p_limit => 100000)
                  where enquiry_id = p_enquiry_id);

  return query
  select 'enquiries_table (include archived)'::text,
         exists (select 1 from public.enquiries_table(
                   p_limit => 100000, p_include_archived => true)
                  where enquiry_id = p_enquiry_id);

  return query
  select 'tickets_list'::text,
         exists (select 1 from public.tickets_list(p_limit => 100000)
                  where enquiry_id = p_enquiry_id);

  -- The two that must KEEP seeing it.
  return query
  select 'enquiries (base table)'::text,
         exists (select 1 from public.enquiries where id = p_enquiry_id);

  return query
  select 'export_enquiries (by id)'::text,
         exists (select 1 from public.export_enquiries(array[p_enquiry_id])
                  where enquiry_id = p_enquiry_id);
end;
$$;

comment on function app.archive_surface_check is
  '§9 regression check: which surfaces can still see one enquiry. Archive a '
  'row, run this, and everything above "enquiries (base table)" must be false '
  'except the include-archived variant.';

revoke all on function app.archive_surface_check(bigint) from public;
grant execute on function app.archive_surface_check(bigint) to authenticated;

create or replace function public.archive_surface_check(p_enquiry_id bigint)
returns table (surface text, sees_it boolean)
language sql
stable
security invoker
set search_path = ''
as $$ select * from app.archive_surface_check(p_enquiry_id) $$;

revoke all on function public.archive_surface_check(bigint) from public;
grant execute on function public.archive_surface_check(bigint) to authenticated;
