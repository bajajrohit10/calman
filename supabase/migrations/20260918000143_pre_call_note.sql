-- §7.1. The discussion a counsellor has before there is a number to attach it
-- to.
--
-- Today the only free-text note is calls.discussion, which is call-level and
-- therefore cannot exist until a call does. But the order of events on the
-- floor is the other way round: the counsellor talks first, writes down what
-- was said, and only sees the number when the call ends. So the note had
-- nowhere to live between those two moments and was being retyped or lost.
--
-- This is enquiry-level and deliberately separate from calls.discussion rather
-- than a nullable call: it is what was said before anybody logged a call, and
-- collapsing the two would make "the first call's note" ambiguous.
--
-- It is not cleared once the first call is logged. It is the record of what
-- brought the lead in, and a later reader asking "what did we know before we
-- rang" should still have an answer.
alter table public.enquiries add column pre_call_note text;

comment on column public.enquiries.pre_call_note is
  'What was discussed before the first call was logged. Pre-fills the '
  'first-call Note field; never overwritten by it.';

-- §7.1. Quick Add inserts enquiries, so the insert grant already covers
-- writing this. Updating it afterwards does not: enquiries grants UPDATE on
-- four columns only, and that list is a deliberate fence rather than an
-- oversight. The note joins it because a counsellor who mistypes the
-- discussion before the call should be able to correct it without a call
-- existing to hang it on.
grant update (pre_call_note) on public.enquiries to authenticated;
