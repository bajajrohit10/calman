-- §9 Archive: the representation, and the one place "live" is defined.
--
-- Archiving is per enquiry. The student row is untouched, other enquiries on
-- the same number are untouched, and nothing is deleted — an archived enquiry
-- is still there for the history page and for duplicate detection, it has just
-- left every working list.
--
-- The exclusion mechanism is `public.live_enquiries`: the eight list surfaces
-- read the view, everything acting on a known enquiry id reads the table. That
-- rule is the whole design, so it is written down in docs/known-issues.md and
-- enforced by app.archive_surface_check() (migration 0032) rather than left to
-- memory.
--
-- A view rather than swapping the table for one: the audit trigger writes
-- tg_table_name, so renaming `enquiries` would start writing
-- table_name = 'enquiries_all' and break the PLI report's filter; PostgREST
-- resolves the students→enquiries embed and the calls!fkey hint off real FK
-- constraints; and the column-level GRANT that makes re-grading safe is on the
-- table. Eight one-word edits cost less than moving any of that.

create table public.archive_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  -- The filter as the operator set it, so the log says what was asked for and
  -- not merely what came back.
  filter jsonb not null,
  enquiry_count integer not null,
  call_count integer not null,
  item_count integer not null,

  -- Filled in if and when the batch is purged. Counts of what was destroyed,
  -- because after the purge nothing else records it.
  purged_at timestamptz,
  purged_by uuid references public.profiles (id),
  purged_enquiries integer,
  purged_calls integer,
  purged_items integer,
  purged_assignments integer,
  purged_whatsapp_sends integer,
  purged_import_rows integer
);

create index archive_batches_created_idx on public.archive_batches (created_at desc);

alter table public.archive_batches enable row level security;

-- Reading the log is an admin matter; writing it happens only inside the
-- definer functions below, never directly.
create policy archive_batches_select on public.archive_batches
  for select to authenticated using ((select app.is_admin()));

alter table public.enquiries
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id),
  add column archive_batch_id uuid references public.archive_batches (id);

comment on column public.enquiries.archived_at is
  'Set by app.archive_enquiries(). Non-null means the enquiry has left every '
  'working list (see public.live_enquiries) but is still visible on the '
  'student history page and to duplicate detection.';

create index enquiries_archived_idx on public.enquiries (archived_at)
  where archived_at is not null;
create index enquiries_archive_batch_idx on public.enquiries (archive_batch_id)
  where archive_batch_id is not null;

-- ---------------------------------------------------------------------------
-- The one definition of "live".
--
-- security_invoker so the caller's RLS on public.enquiries still applies: a
-- view is not a way around a policy, and must not become one.
-- ---------------------------------------------------------------------------

create view public.live_enquiries with (security_invoker = true) as
  select * from public.enquiries where archived_at is null;

comment on view public.live_enquiries is
  'Enquiries that have not been archived. Every list, count, facet and report '
  'surface reads this; anything acting on a known enquiry id reads '
  'public.enquiries directly so history and duplicate detection keep working.';

grant select on public.live_enquiries to authenticated;
