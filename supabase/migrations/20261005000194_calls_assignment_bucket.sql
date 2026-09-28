-- §70.1. The call records the bucket it was made under, not just which row.
--
-- assignment_id alone is not enough, and testing found it. The desk assigns with
-- upsert on (enquiry_id, date), so re-handing a lead later the same day
-- *overwrites* the one assignment row — the code that does it names the case:
-- "a six o'clock re-assignment". A lead given out as a follow-up in the morning
-- and re-handed as a campaign at six is one row whose bucket changes.
--
-- With only assignment_id, the morning call's attribution would change
-- retroactively to campaign: yesterday's report would not match today's reading
-- of it, and the rule §70.1 asks for — the bucket of the assignment active *at
-- the moment of the call* — would be quietly false for exactly the calls it was
-- written for.
--
-- So the bucket is copied onto the call when the call is logged. assignment_id
-- stays, because "which batch" is still worth knowing and is what a future
-- report would join on; the bucket here is the historical fact.
alter table public.calls
  add column if not exists assignment_bucket public.assignment_bucket;

comment on column public.calls.assignment_bucket is
  '§70.1. The bucket of the assignment this call was made under, as it stood at '
  'the moment of the call. Null for calls logged before the column existed and '
  'for calls with no assignment; public.call_report infers one for those.';
