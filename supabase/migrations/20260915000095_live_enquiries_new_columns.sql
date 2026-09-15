-- The view was written as an explicit column list, so it froze at the shape
-- the table had then: reopened_via_offer_id and reopened_from_enquiry_id were
-- already missing from it, and §44.1's three ticket columns would be too.
--
-- Rewritten to name every column the table has today. Still a list rather than
-- `select *`, because a view that silently changes shape when somebody adds a
-- column is how a function that selects from it starts returning a different
-- row than its RETURNS TABLE promises.

create or replace view public.live_enquiries as
select
  id, student_id, type, source_id, product_text, term_id, importance,
  lead_verification, status, lost_reason, close_reason, next_follow_up_date,
  fresh_call_date, follow_up_slots_used, last_slot_date, top_content_priority,
  created_at, created_by, closed_at, archived_at, archived_by,
  archive_batch_id, re_enquired_at, reopened_via_offer_id,
  reopened_from_enquiry_id,
  -- §44.1
  order_id, teacher_id, escalated_to
from public.enquiries
where archived_at is null;

do $$
begin
  if position('teacher_id' in pg_get_viewdef('public.live_enquiries'::regclass, true)) = 0 then
    raise exception 'live_enquiries: the ticket columns did not land';
  end if;
end $$;
