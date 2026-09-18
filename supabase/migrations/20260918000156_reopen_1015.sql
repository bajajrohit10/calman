-- §55.4, corrected. One of the six was no longer an orphan.
--
-- The repair closed every enquiry from batch 92b47534 that had no calls and no
-- interest lines. #1015 met that test and should not have: between the bad
-- import and the repair, somebody filled in HARIHARAN S's number on the
-- Missing number tab and that checkout was attached to this enquiry. A held
-- checkout resolved onto a lead adds neither a call nor an item, so the test
-- could not see it.
--
-- Reopened, and the test is now written the way it should have been: an
-- enquiry that anything else points at is not an orphan.
update public.enquiries
   set status = 'open', close_reason = null, closed_at = null
 where id = 1015
   and close_reason = 'superseded'
   and exists (
     select 1 from public.held_checkouts h where h.resolved_enquiry_id = 1015
   );

insert into public.enquiry_sources (enquiry_id, source_id, note)
select e.id, e.source_id,
       'Reopened: closed in error by the 18 Sep repair, which did not look for '
       'a Missing-number checkout resolved onto it.'
  from public.enquiries e where e.id = 1015;
