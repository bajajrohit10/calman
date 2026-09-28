-- §70.1. A call records which assignment it was made under.
--
-- Until now the link was inferred: call_report joined assignments on
-- (enquiry_id, date = call_date). That is right often enough to be believable
-- and wrong in a way nobody can see — a lead handed to one counsellor as a
-- campaign and rung by another is filed under the campaign batch, and a lead
-- called on a day it was not assigned has no bucket at all.
--
-- Nullable, and it stays nullable: every call already in the table predates
-- this column, and the report keeps the time-based inference for those. Nothing
-- is backfilled — an inferred value written into a column that claims to be a
-- fact is worse than an inference the reader can see being made.
--
-- ON DELETE SET NULL rather than CASCADE: deleting an assignment is a
-- housekeeping act and must never take a call — the record that work happened —
-- with it.
alter table public.calls
  add column if not exists assignment_id uuid
    references public.assignments (id) on delete set null;

comment on column public.calls.assignment_id is
  '§70.1. The assignment this call was made under, where it is known. Null for '
  'calls made before the column existed and for calls with no assignment at all; '
  'public.call_report falls back to inferring one from the day in both cases.';

-- The report joins on it for every call in the range.
create index if not exists calls_assignment_id_idx
  on public.calls (assignment_id) where assignment_id is not null;
