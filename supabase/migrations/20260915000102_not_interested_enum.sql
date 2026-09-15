-- §47.3. "Not interested — don't call" as a purchase outcome, and the lost
-- reason it produces.
--
-- Its own migration because a value added to an enum cannot be *used* in the
-- transaction that adds it, and the next migration uses both: the check
-- constraint names the outcome and recompute_enquiry writes the reason.
--
-- A distinct reason rather than folding it into 'dropped'. Dropped is what the
-- system concludes when a lead runs out of road; this is what a student said.
-- The two want counting separately, and once they share a value they can never
-- be told apart again.

alter type public.call_outcome add value if not exists 'not_interested';
alter type public.lost_reason add value if not exists 'not_interested';
