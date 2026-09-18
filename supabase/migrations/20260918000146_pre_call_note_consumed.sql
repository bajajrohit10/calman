-- §7.1. The pre-call note is consumed by the first call.
--
-- It exists to be read by whoever rings next: "what was said before anybody
-- logged a call". Once a call is logged, the call's own note carries it —
-- the panel opens with the text already in the Note field — and leaving the
-- copy on the enquiry would put the same sentence on the student history
-- twice, once as the chip and once as the last note, drifting apart the
-- moment somebody edits one of them.
--
-- This is also what makes the two halves of the brief one rule rather than
-- two: with "Log call now" the text ends up on the call, without it the text
-- waits on the enquiry. The difference is only whether the call happened yet.
--
-- A trigger rather than a line in the save action: calls arrive from the call
-- panel, the after-sale path and the importer, and a rule that three callers
-- have to remember is a rule that two of them will.
create or replace function app.consume_pre_call_note()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.enquiries e
     set pre_call_note = null
   where e.id = new.enquiry_id
     and e.pre_call_note is not null;
  return null;
end $$;

create trigger consume_pre_call_note
  after insert on public.calls
  for each row execute function app.consume_pre_call_note();

comment on column public.enquiries.pre_call_note is
  'What was discussed before the first call was logged. Pre-fills the '
  'first-call Note field and shows as a chip on the student history Now '
  'card; cleared by the first call, which then carries it.';
