-- §9 Archive, purge and unarchive.
--
-- Three definer functions with public INVOKER wrappers, because PostgREST only
-- serves `public` and the inner function needs its own EXECUTE grant.
--
-- The deliberate audit gap
-- ------------------------
-- Purging 200 enquiries with 900 calls and 400 items would otherwise write
-- ~1,500 audit rows: the log would *grow* as you destroy data, which is the
-- opposite of the point, and the brief asks for one row per enquiry and a
-- summary, nothing else.
--
-- So audit.log_change() gains a skip — and it is double-guarded, because a
-- blind spot in the compliance record has to be impossible to open by
-- accident:
--
--   1. the `app.purging` GUC must be set to 'on', and
--   2. PG_CONTEXT must show app.purge_archived() in the current call stack.
--
-- Setting the GUC from anywhere else does nothing at all. The skip covers only
-- the child tables; the enquiry's own delete row is still written by the same
-- trigger, which is where the per-enquiry record the brief asks for comes
-- from. This is written up under "Deliberate audit gaps" in
-- docs/known-issues.md.

create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_excluded text[] := coalesce(tg_argv, '{}'::text[]);
  v_changed text[];
  v_actor uuid;
  v_source text;
  v_pk text;
  v_ctx text;
begin
  -- The §9 purge gap. Both conditions, or nothing is skipped.
  if tg_table_name in ('calls', 'enquiry_items')
     and coalesce(current_setting('app.purging', true), '') = 'on'
  then
    get diagnostics v_ctx = pg_context;
    if v_ctx like '%purge_archived%' then
      return null;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_changed
      from (select jsonb_object_keys(v_new) as k
            union
            select jsonb_object_keys(v_old)) keys
     where (v_old -> keys.k) is distinct from (v_new -> keys.k)
       and not (keys.k = any (v_excluded));

    -- Nothing a human changed. Without this test the derived columns from
    -- section 6 would write an audit row on every single call and bury the
    -- edits the log exists to capture.
    if coalesce(array_length(v_changed, 1), 0) = 0 then
      return null;
    end if;
  end if;

  -- auth.uid() is null for service-role work and for anything run from a
  -- script, so bulk imports would otherwise be attributed to nobody.
  v_actor := (select auth.uid());

  if v_actor is not null then
    v_source := 'jwt';
  else
    begin
      v_actor := nullif(current_setting('app.actor', true), '')::uuid;
    exception when others then
      v_actor := null;
    end;

    if v_actor is not null then
      v_source := 'guc';
    elsif current_user::text = 'service_role' then
      v_source := 'service_role';
    else
      v_source := 'unknown';
    end if;
  end if;

  -- Primary keys differ in type across these tables (uuid here, bigint
  -- there), so one generic function serves all of them.
  v_pk := coalesce(v_new, v_old) ->> 'id';

  insert into public.audit_log
    (table_name, row_pk, action, actor_id, actor_source, old_data, new_data, changed_fields)
  values
    (tg_table_name, v_pk, lower(tg_op), v_actor, v_source, v_old, v_new, v_changed);

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Which enquiries a filter matches.
--
-- One definition, used by the live count on the form, by the export, by the
-- archive and by the purge, so the number on screen and the set that moves
-- cannot be different things.
--
-- p_archived: false = live only (archiving), true = archived only (purging).
-- ---------------------------------------------------------------------------

create or replace function app.archive_match(
  p_created_from date default null,
  p_created_to date default null,
  p_statuses public.enquiry_status[] default null,
  p_type public.enquiry_type default null,
  p_lost_reason public.lost_reason default null,
  p_archived boolean default false
)
returns table (enquiry_id bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id
    from public.enquiries e
   where (case when p_archived then e.archived_at is not null
                                else e.archived_at is null end)
     and (p_created_from is null
          or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
     and (p_created_to is null
          or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
     and (p_statuses is null or cardinality(p_statuses) = 0
          or e.status = any (p_statuses))
     and (p_type is null or e.type = p_type)
     and (p_lost_reason is null or e.lost_reason = p_lost_reason)
   order by e.id
$$;

create or replace function public.archive_preview(
  p_created_from date default null,
  p_created_to date default null,
  p_statuses public.enquiry_status[] default null,
  p_type public.enquiry_type default null,
  p_lost_reason public.lost_reason default null,
  p_archived boolean default false
)
returns table (
  enquiry_count integer,
  call_count integer,
  item_count integer,
  assignment_count integer,
  whatsapp_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (
    select enquiry_id from app.archive_match(
      p_created_from, p_created_to, p_statuses, p_type, p_lost_reason, p_archived)
  )
  select
    (select count(*)::integer from m),
    (select count(*)::integer from public.calls c
      where c.enquiry_id in (select enquiry_id from m)),
    (select count(*)::integer from public.enquiry_items i
      where i.enquiry_id in (select enquiry_id from m)),
    (select count(*)::integer from public.assignments a
      where a.enquiry_id in (select enquiry_id from m)),
    (select count(*)::integer from public.whatsapp_sends w
      where w.enquiry_id in (select enquiry_id from m));
$$;

comment on function public.archive_preview is
  '§9: how much a Data management filter matches. p_archived false counts the '
  'live set (for archiving), true the archived set (for purging).';

revoke all on function public.archive_preview from public;
grant execute on function public.archive_preview to authenticated;

create or replace function public.archive_ids(
  p_created_from date default null,
  p_created_to date default null,
  p_statuses public.enquiry_status[] default null,
  p_type public.enquiry_type default null,
  p_lost_reason public.lost_reason default null,
  p_archived boolean default false
)
returns table (enquiry_id bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select enquiry_id from app.archive_match(
    p_created_from, p_created_to, p_statuses, p_type, p_lost_reason, p_archived);
$$;

revoke all on function public.archive_ids from public;
grant execute on function public.archive_ids to authenticated;

-- ---------------------------------------------------------------------------
-- Archive. Takes the explicit id list the export was built from, so the set
-- that gets marked is exactly the set that was downloaded — a filter re-run a
-- second later could match differently if a call landed in between.
-- ---------------------------------------------------------------------------

create or replace function app.archive_enquiries(
  p_ids bigint[],
  p_filter jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_batch uuid;
  v_enquiries integer;
  v_calls integer;
  v_items integer;
begin
  if not app.is_admin() then
    raise exception 'not authorised to archive' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'nothing to archive';
  end if;

  -- Only ever archive what is currently live. Re-running a batch must not
  -- reassign rows that already belong to an earlier one.
  select count(*) into v_enquiries
    from public.enquiries e
   where e.id = any (p_ids) and e.archived_at is null;

  if v_enquiries = 0 then
    raise exception 'those enquiries are already archived';
  end if;

  select count(*) into v_calls from public.calls c
   where c.enquiry_id = any (p_ids);
  select count(*) into v_items from public.enquiry_items i
   where i.enquiry_id = any (p_ids);

  insert into public.archive_batches
    (created_by, filter, enquiry_count, call_count, item_count)
  values (v_actor, p_filter, v_enquiries, v_calls, v_items)
  returning id into v_batch;

  update public.enquiries e
     set archived_at = now(),
         archived_by = v_actor,
         archive_batch_id = v_batch
   where e.id = any (p_ids)
     and e.archived_at is null;

  -- Today's and future assignments would otherwise dangle on someone's My Day
  -- pointing at a row no list returns. Past assignments stay: the §5.8
  -- overdue-carried-forward figure is built from them and must not move.
  delete from public.assignments a
   where a.enquiry_id = any (p_ids)
     and a.date >= app.ist_today();

  return v_batch;
end;
$$;

create or replace function public.archive_enquiries(p_ids bigint[], p_filter jsonb)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select app.archive_enquiries(p_ids, p_filter) $$;

revoke all on function app.archive_enquiries(bigint[], jsonb) from public;
grant execute on function app.archive_enquiries(bigint[], jsonb) to authenticated;
revoke all on function public.archive_enquiries(bigint[], jsonb) from public;
grant execute on function public.archive_enquiries(bigint[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Unarchive one enquiry, from the student history page.
-- ---------------------------------------------------------------------------

create or replace function app.unarchive_enquiry(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'not authorised to unarchive' using errcode = '42501';
  end if;

  update public.enquiries
     set archived_at = null, archived_by = null, archive_batch_id = null
   where id = p_id and archived_at is not null;

  if not found then
    raise exception 'that enquiry is not archived';
  end if;
end;
$$;

create or replace function public.unarchive_enquiry(p_id bigint)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select app.unarchive_enquiry(p_id) $$;

revoke all on function app.unarchive_enquiry(bigint) from public;
grant execute on function app.unarchive_enquiry(bigint) to authenticated;
revoke all on function public.unarchive_enquiry(bigint) from public;
grant execute on function public.unarchive_enquiry(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Purge. Super admin only, archived rows only, and the caller has to have
-- counted: p_expected_count must equal what is about to be destroyed, so a
-- filter that changed under the operator's feet aborts instead of deleting
-- more than they agreed to.
-- ---------------------------------------------------------------------------

create or replace function app.purge_archived(
  p_ids bigint[],
  p_expected_count integer
)
returns table (
  purged_enquiries integer,
  purged_calls integer,
  purged_items integer,
  purged_assignments integer,
  purged_whatsapp_sends integer,
  purged_import_rows integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ids bigint[];
  v_n integer;
  v_calls integer;
  v_items integer;
  v_assignments integer;
  v_whatsapp integer;
  v_import integer;
  v_batches uuid[];
begin
  if app.role() <> 'super_admin' then
    raise exception 'only a super admin may purge' using errcode = '42501';
  end if;

  -- Archived only. An id that is not archived is silently not purged rather
  -- than quietly deleted, and the count check below then fails loudly.
  select coalesce(array_agg(e.id), '{}'::bigint[]) into v_ids
    from public.enquiries e
   where e.id = any (p_ids) and e.archived_at is not null;

  v_n := cardinality(v_ids);

  if v_n <> p_expected_count then
    raise exception
      'purge refused: % archived enquiries match, the confirmation said %',
      v_n, p_expected_count using errcode = '22000';
  end if;
  if v_n = 0 then
    raise exception 'nothing to purge';
  end if;

  select coalesce(array_agg(distinct e.archive_batch_id), '{}'::uuid[])
    into v_batches
    from public.enquiries e
   where e.id = any (v_ids) and e.archive_batch_id is not null;

  select count(*) into v_calls       from public.calls          where enquiry_id = any (v_ids);
  select count(*) into v_items       from public.enquiry_items   where enquiry_id = any (v_ids);
  select count(*) into v_assignments from public.assignments     where enquiry_id = any (v_ids);
  select count(*) into v_whatsapp    from public.whatsapp_sends  where enquiry_id = any (v_ids);
  select count(*) into v_import      from public.import_rows     where enquiry_id = any (v_ids);

  -- The deliberate gap opens here and nowhere else. audit.log_change() also
  -- checks PG_CONTEXT for this function's name, so the GUC alone is not
  -- enough to open it.
  perform set_config('app.purging', 'on', true);

  delete from public.calls          where enquiry_id = any (v_ids);
  delete from public.enquiry_items  where enquiry_id = any (v_ids);
  delete from public.assignments    where enquiry_id = any (v_ids);
  delete from public.whatsapp_sends where enquiry_id = any (v_ids);
  -- The import row is history of a file, not of the enquiry: it survives with
  -- its link cleared, so the batch report still reconciles.
  update public.import_rows set enquiry_id = null where enquiry_id = any (v_ids);

  -- This one is NOT suppressed: the per-enquiry delete row the brief asks for
  -- is written by the ordinary trigger, with old_data intact.
  delete from public.enquiries where id = any (v_ids);

  perform set_config('app.purging', 'off', true);

  update public.archive_batches b
     set purged_at = now(),
         purged_by = v_actor,
         purged_enquiries      = coalesce(b.purged_enquiries, 0) + v_n,
         purged_calls          = coalesce(b.purged_calls, 0) + v_calls,
         purged_items          = coalesce(b.purged_items, 0) + v_items,
         purged_assignments    = coalesce(b.purged_assignments, 0) + v_assignments,
         purged_whatsapp_sends = coalesce(b.purged_whatsapp_sends, 0) + v_whatsapp,
         purged_import_rows    = coalesce(b.purged_import_rows, 0) + v_import
   where b.id = any (v_batches);

  -- The batch summary row. After this, nothing else records what was here.
  insert into public.audit_log
    (table_name, row_pk, action, actor_id, actor_source, old_data, new_data)
  values (
    'archive_batches',
    coalesce(v_batches[1]::text, 'ad-hoc'),
    'delete',
    v_actor,
    case when v_actor is not null then 'jwt' else 'unknown' end,
    jsonb_build_object(
      'batch_ids', to_jsonb(v_batches),
      'enquiry_ids', to_jsonb(v_ids),
      'purged_enquiries', v_n,
      'purged_calls', v_calls,
      'purged_items', v_items,
      'purged_assignments', v_assignments,
      'purged_whatsapp_sends', v_whatsapp,
      'purged_import_rows', v_import
    ),
    null
  );

  return query select v_n, v_calls, v_items, v_assignments, v_whatsapp, v_import;
end;
$$;

create or replace function public.purge_archived(p_ids bigint[], p_expected_count integer)
returns table (
  purged_enquiries integer,
  purged_calls integer,
  purged_items integer,
  purged_assignments integer,
  purged_whatsapp_sends integer,
  purged_import_rows integer
)
language sql
volatile
security invoker
set search_path = ''
as $$ select * from app.purge_archived(p_ids, p_expected_count) $$;

revoke all on function app.purge_archived(bigint[], integer) from public;
grant execute on function app.purge_archived(bigint[], integer) to authenticated;
revoke all on function public.purge_archived(bigint[], integer) from public;
grant execute on function public.purge_archived(bigint[], integer) to authenticated;
