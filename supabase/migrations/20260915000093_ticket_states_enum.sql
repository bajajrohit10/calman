-- §44.2. Two more states a ticket can be in, and the two outcomes that put it
-- there.
--
-- Open / Escalated / Resolved could not say the two things that actually take
-- up the week: somebody is working on it right now, and somebody is waiting on
-- the institute. Both were being recorded as "Open" with a note, which made
-- the queue unreadable — a list of forty Open tickets where six are live, four
-- are blocked on somebody else and thirty are untouched.
--
-- Alone in its own migration because a new enum value cannot be used in the
-- transaction that adds it. Everything that reads them is in the next one.

alter type public.enquiry_status add value if not exists 'working' after 'open';
alter type public.enquiry_status add value if not exists 'pending_institute' after 'escalated';

alter type public.call_outcome add value if not exists 'working' after 'noted';
alter type public.call_outcome add value if not exists 'pending_institute' after 'escalated';
