-- §9: archive first, export second — and make the archive reversible.
--
-- The old order was export, then mark archived. That left a window: a call
-- logged between the two landed in the database but not in the workbook, and
-- the archive still succeeded. Reversing it closes the window, because an
-- archived enquiry is already out of every list and out of Quick Add's
-- "anything open on this number?" test before the export starts.
--
-- Reversing puts the risk on the other side: the archive is now real before
-- the file exists. So it has to be undoable, and undoable *completely* —
-- archiving deletes today's and future assignments, and a rollback that left
-- those destroyed would not be a rollback. They are snapshotted onto the batch
-- and put back.
--
--   exported_at         null until the browser confirms the download. A batch
--                       sitting with it null is one whose tab was closed
--                       mid-flight; the log offers to unarchive it.
--   removed_assignments the assignment rows archiving deleted, for the undo.

alter table public.archive_batches
  add column exported_at timestamptz,
  add column removed_assignments jsonb not null default '[]'::jsonb;

comment on column public.archive_batches.exported_at is
  'Set once the browser has actually produced the workbook. Null means the '
  'export never completed and the batch can still be unarchived.';

-- ---------------------------------------------------------------------------
-- Archive, now recording enough to undo itself.
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
  v_removed jsonb;
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
  --
  -- Snapshotted before deletion so app.unarchive_batch() can put them back —
  -- the export has not happened yet, and an archive that cannot be fully
  -- undone is not safe to do first.
  with removed as (
    delete from public.assignments a
     where a.enquiry_id = any (p_ids)
       and a.date >= app.ist_today()
    returning a.enquiry_id, a.date, a.counsellor_id, a.bucket, a.assigned_by
  )
  select coalesce(jsonb_agg(to_jsonb(removed)), '[]'::jsonb) into v_removed
    from removed;

  update public.archive_batches
     set removed_assignments = v_removed
   where id = v_batch;

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirm the export actually happened.
-- ---------------------------------------------------------------------------

create or replace function app.confirm_batch_export(p_batch_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.archive_batches
     set exported_at = now()
   where id = p_batch_id and exported_at is null;
end;
$$;

create or replace function public.confirm_batch_export(p_batch_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select app.confirm_batch_export(p_batch_id) $$;

revoke all on function app.confirm_batch_export(uuid) from public;
grant execute on function app.confirm_batch_export(uuid) to authenticated;
revoke all on function public.confirm_batch_export(uuid) from public;
grant execute on function public.confirm_batch_export(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Undo a whole batch: put the enquiries back in the lists, put the assignments
-- back on the day they were for, and drop the batch row. Used automatically
-- when an export fails, and offered in the log for a batch whose export was
-- never confirmed.
-- ---------------------------------------------------------------------------

create or replace function app.unarchive_batch(p_batch_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_restored integer;
  v_purged timestamptz;
  v_removed jsonb;
begin
  if not app.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select purged_at, removed_assignments into v_purged, v_removed
    from public.archive_batches where id = p_batch_id;

  if not found then
    raise exception 'no such batch';
  end if;
  -- Nothing to put back, and pretending otherwise would be worse than saying
  -- so plainly.
  if v_purged is not null then
    raise exception 'that batch has been purged and cannot be unarchived';
  end if;

  update public.enquiries
     set archived_at = null, archived_by = null, archive_batch_id = null
   where archive_batch_id = p_batch_id;
  get diagnostics v_restored = row_count;

  -- on conflict do nothing: if somebody has taken the enquiry for that day in
  -- the meantime, theirs wins — one owner per enquiry per day (§10 dec. 9).
  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  select (r->>'enquiry_id')::bigint,
         (r->>'date')::date,
         (r->>'counsellor_id')::uuid,
         (r->>'bucket')::public.assignment_bucket,
         (r->>'assigned_by')::uuid
    from jsonb_array_elements(coalesce(v_removed, '[]'::jsonb)) r
  on conflict (enquiry_id, date) do nothing;

  delete from public.archive_batches where id = p_batch_id;

  return v_restored;
end;
$$;

create or replace function public.unarchive_batch(p_batch_id uuid)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$ select app.unarchive_batch(p_batch_id) $$;

revoke all on function app.unarchive_batch(uuid) from public;
grant execute on function app.unarchive_batch(uuid) to authenticated;
revoke all on function public.unarchive_batch(uuid) from public;
grant execute on function public.unarchive_batch(uuid) to authenticated;
