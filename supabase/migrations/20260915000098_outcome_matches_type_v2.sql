-- §44.2. The constraint that pairs an outcome with an enquiry type predates
-- the two new ticket states, so a call recording "Working on it" or "Pending
-- with the institute" was refused by the table after the screen had accepted
-- it — and the screen, until a moment ago, did not even show the refusal.
--
-- The purchase side is unchanged. The after-sale side gains the two outcomes
-- added in 0093, which is the whole of the difference.

alter table public.calls drop constraint if exists outcome_matches_type;

alter table public.calls add constraint outcome_matches_type check (
  (enquiry_type = 'purchase' and outcome in
     ('follow_up', 'call_back', 'purchased', 'competitor', 'closed'))
  or
  (enquiry_type = 'after_sale' and outcome in
     ('noted', 'working', 'escalated', 'pending_institute', 'resolved'))
);

do $$
begin
  if position('pending_institute' in
       pg_get_constraintdef((select oid from pg_constraint where conname = 'outcome_matches_type'))) = 0 then
    raise exception 'outcome_matches_type: the new ticket outcomes did not land';
  end if;
end $$;
