-- Close the rest of the purge's audit noise.
--
-- Migration 0031 suppressed the calls and enquiry_items delete rows. Measuring
-- a real purge of 99 enquiries showed 189 new audit rows where the brief asks
-- for 100 (one per enquiry, plus the batch summary). The other 89 were:
--
--   ~75  UPDATE rows on `enquiries`. Deleting an enquiry's calls fires
--        b_calls_recompute, and app.recompute_enquiry() rewrites the derived
--        status of a row that is about to be deleted a moment later. Churn
--        about a row that will not exist.
--    14  DELETE rows on `assignments`, which also carries an audit trigger.
--
-- So the gap now covers every child table of an enquiry, and `enquiries`
-- itself for everything except the DELETE. The DELETE is the record the brief
-- asks for and is never suppressed — it still carries old_data, so the purged
-- enquiry is fully reconstructable from the log.
--
-- The two guards from 0031 are unchanged and both still required: the
-- app.purging GUC, and PG_CONTEXT showing app.purge_archived() in the call
-- stack. See docs/known-issues.md, "Deliberate audit gaps".

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
  if coalesce(current_setting('app.purging', true), '') = 'on' then
    get diagnostics v_ctx = pg_context;
    if v_ctx like '%purge_archived%' then
      -- An enquiry's children leave no trace: they are itemised in the batch
      -- summary row and reconstructable from the export.
      if tg_table_name in ('calls', 'enquiry_items', 'assignments',
                           'whatsapp_sends', 'import_rows') then
        return null;
      end if;
      -- The enquiry itself keeps its DELETE and nothing else.
      if tg_table_name = 'enquiries' and tg_op <> 'DELETE' then
        return null;
      end if;
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
