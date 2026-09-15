-- §44.2, the sibling of 0098. enquiries carries the same kind of guard as
-- calls — which statuses are legal for which enquiry type — and it too was
-- written before Working on it and Pending with Institute existed. The
-- recompute trigger derived the new status correctly and the table then
-- refused the row.
--
-- Checked for siblings this time: these two are the only check constraints in
-- the schema that name the ticket states.

alter table public.enquiries drop constraint if exists status_matches_type;

alter table public.enquiries add constraint status_matches_type check (
  (type = 'purchase' and status in ('open', 'won', 'lost', 'closed'))
  or
  (type = 'after_sale' and status in
     ('open', 'working', 'escalated', 'pending_institute', 'closed'))
);

do $$
begin
  if position('pending_institute' in
       pg_get_constraintdef((select oid from pg_constraint where conname = 'status_matches_type'))) = 0 then
    raise exception 'status_matches_type: the new ticket states did not land';
  end if;
end $$;
