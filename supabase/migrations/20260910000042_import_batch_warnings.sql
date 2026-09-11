-- §10.1: record it when the batched re-enquiry path falls back to per-row.
--
-- The fallback exists so one bad enquiry id cannot cost a whole chunk, and it
-- works — which is the problem. When the batch RPC was broken by an ambiguous
-- column reference, every import still finished with the right counts and the
-- only symptom was that it took as long as the path it was meant to replace.
-- A silent correct-looking result is the worst kind, so the fallback now says
-- so: once in the server log, and once on the import report where the person
-- who ran it will actually see it.
--
-- Stored on the batch rather than returned to the browser, because the report
-- is read later and by other people.

alter table public.import_batches
  add column warnings text[] not null default '{}';

comment on column public.import_batches.warnings is
  'Things that went wrong during the commit without failing it — currently '
  'the batched re-enquiry falling back to one call per row. Shown on the '
  'import report.';

-- import_batches has no UPDATE policy, deliberately: a batch is a record of
-- what happened and the app does not edit it. Appending a warning is the one
-- exception, so it goes through a definer function that can only append.
create or replace function app.import_add_warning(
  p_batch_id uuid,
  p_warning text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if coalesce(btrim(p_warning), '') = '' then
    return;
  end if;

  -- Append, never replace: a three-chunk import that failed twice should say
  -- so twice. Atomic, so chunks committing concurrently cannot lose one.
  update public.import_batches
     set warnings = warnings || p_warning
   where id = p_batch_id;
end;
$$;

create or replace function public.import_add_warning(p_batch_id uuid, p_warning text)
returns void
language sql volatile security invoker set search_path = ''
as $$ select app.import_add_warning(p_batch_id, p_warning) $$;

revoke all on function app.import_add_warning(uuid, text) from public;
grant execute on function app.import_add_warning(uuid, text) to authenticated;
revoke all on function public.import_add_warning(uuid, text) from public;
grant execute on function public.import_add_warning(uuid, text) to authenticated;
