-- Offers were the one thing nobody could ask "who changed this" about.
--
-- §8 puts every insert and update behind an audit trigger, and six tables got
-- one in the first migration: enquiries, items, calls, assignments, students,
-- profiles. Offers did not, because in Brief 1 they were schema with no code
-- behind them. They have code behind them now — a deactivation takes every
-- lead out of a bucket, and a change of targets silently changes who a
-- campaign reaches — and when one of ours turned out to be deactivated there
-- was no way to find out by whom.
--
-- The join tables are audited too, not just the parent. An offer's targets are
-- most of what an offer *is*, and they are replaced wholesale on save, so an
-- edit that swaps two teachers shows up as deletes and inserts against the
-- offer. Noisy in the abstract; these change monthly, and the alternative is a
-- log that cannot answer the question it exists for.

-- ---------------------------------------------------------------------------
-- The generic function learns about child tables keyed by their parent
-- ---------------------------------------------------------------------------
--
-- audit_log.row_pk is text and not null, filled from the row's `id`. The five
-- target tables have no `id`: their primary key is (offer_id, <target>_id), so
-- the insert would fail and take every write to them down with it.
--
-- The fallback is offer_id rather than the composite. row_pk answers "which
-- thing is this a change to", and for a target row the answer is the offer —
-- which makes "everything that ever happened to offer X" a single equality on
-- row_pk across table_name, the same shape the log already supports for an
-- enquiry and its items.

create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_excluded text[] := coalesce(tg_argv, '{}'::text[]);
  v_changed text[];
  v_actor uuid;
  v_source text;
  v_pk text;
  v_row jsonb;
begin
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
  -- there), so one generic function serves all of them. A child table keyed by
  -- its parent has no id of its own and is logged against the parent.
  v_row := coalesce(v_new, v_old);
  v_pk := coalesce(v_row ->> 'id', v_row ->> 'offer_id');

  if v_pk is null then
    raise exception
      'audit.log_change(): % has neither an id nor an offer_id to key the log on',
      tg_table_name;
  end if;

  insert into public.audit_log
    (table_name, row_pk, action, actor_id, actor_source, old_data, new_data, changed_fields)
  values
    (tg_table_name, v_pk, lower(tg_op), v_actor, v_source, v_old, v_new, v_changed);

  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- The triggers
-- ---------------------------------------------------------------------------
--
-- z_* like the others, so they sort after any business trigger on the same
-- table and observe final values rather than intermediates. Created only if
-- absent, so re-running the migration set is harmless.

do $$
declare
  t text;
begin
  foreach t in array array['offers', 'offer_teachers', 'offer_courses',
                           'offer_subjects', 'offer_contents', 'offer_institutes']
  loop
    if not exists (
      select 1 from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t
         and tg.tgname = 'z_audit_' || t
    ) then
      execute format(
        'create trigger z_audit_%1$s after insert or update or delete on public.%1$I '
        'for each row execute function audit.log_change()', t);
    end if;
  end loop;
end $$;

-- Assert it: a trigger that was not created is a log that is not kept, and
-- this migration exists because nobody noticed one missing for a fortnight.
do $$
declare
  n integer;
begin
  select count(*) into n
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('offers', 'offer_teachers', 'offer_courses',
                       'offer_subjects', 'offer_contents', 'offer_institutes')
     and tg.tgname like 'z_audit_%';

  if n <> 6 then
    raise exception 'expected 6 offer audit triggers, found %', n;
  end if;
end $$;
