-- §76. One definition of "pending", read by everything that counts it.
--
-- The desk grid said Nilavo had 5 of 30 New Calls still to do on 29 Sept while
-- his own My Day said 0. Both were reading assignments and calls; they differed
-- on one clause. my_day() carries
--
--   and (e.status not in ('won','lost','closed') or <called that day> )
--
-- added by §62's addendum, and my_day_team never got it — so a lead closed with
-- no call on the day was invisible on My Day and permanently pending on the grid.
-- my_day_pending_count, which drives the sidebar badge, was missing the status
-- test *and* the carried_to test.
--
-- Those five were §69.2 doing its job: Nilavo ticked "this is an after-sale
-- call", a Support ticket was raised and the zero-call lead closed as superseded
-- in the same second. §62.2 deliberately writes no counselling call on that
-- path, so "no call on the day" was true for good and the grid could never clear
-- them. Special-casing `superseded` would have patched this instance; the status
-- test closes the shape.

-- ---------------------------------------------------------------------------
-- 1. Is this assignment part of that day at all?
-- ---------------------------------------------------------------------------
--
-- Deliberately not the same question as "is it pending". A lead closed *by* a
-- call that day is the day's work finished — it belongs in the total, on the Done
-- side. One closed with no call on the day was never that day's work: it left by
-- another door and counting it would have a manager reallocating something that
-- is already gone.
create or replace function app.assignment_in_day(
  p_enquiry_id  bigint,
  p_assigned_at timestamptz,
  p_status      public.enquiry_status,
  p_date        date
)
returns boolean
language sql
stable
set search_path to ''
as $$
  select p_status not in ('won', 'lost', 'closed')
      or exists (
           select 1 from public.calls c
            where c.enquiry_id = p_enquiry_id
              and c.call_date = p_date
              and c.called_at >= p_assigned_at
         );
$$;

-- ---------------------------------------------------------------------------
-- 2. Is it still to do?
-- ---------------------------------------------------------------------------
--
-- In the day, not carried to another date, and not yet called since it was handed
-- over. `called_at >= assigned_at` rather than merely "a call that day" is §17: a
-- six o'clock re-assignment makes the morning call somebody else's, and the new
-- owner has not rung them yet.
--
-- A lead reassigned to another counsellor needs no clause of its own —
-- assignments is unique on (enquiry_id, date), so a re-assignment moves the row
-- rather than adding one, and it counts for the new owner only. Stated here so it
-- cannot be broken by accident later.
create or replace function app.assignment_is_pending(
  p_enquiry_id  bigint,
  p_assigned_at timestamptz,
  p_carried_to  date,
  p_status      public.enquiry_status,
  p_date        date
)
returns boolean
language sql
stable
set search_path to ''
as $$
  select app.assignment_in_day(p_enquiry_id, p_assigned_at, p_status, p_date)
     and p_carried_to is null
     and not exists (
           select 1 from public.calls c
            where c.enquiry_id = p_enquiry_id
              and c.call_date = p_date
              and c.called_at >= p_assigned_at
         );
$$;

grant execute on function app.assignment_in_day(bigint, timestamptz, public.enquiry_status, date)
  to authenticated, service_role;
grant execute on function app.assignment_is_pending(
  bigint, timestamptz, date, public.enquiry_status, date) to authenticated, service_role;

notify pgrst, 'reload schema';
