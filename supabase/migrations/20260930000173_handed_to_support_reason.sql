-- §62.2. A counselling after-sale call raises a support ticket.
--
-- Until now an after-sale call lived entirely in counselling: the enquiry took a
-- status derived from the call's outcome and sat on My Day's Tickets tab. That
-- tab is going, and the work moves to schema support — where the ticket team
-- already works, where the form's tickets already land, and where the queue,
-- the reports and the export already exist.
--
-- The counselling enquiry is closed rather than kept in step. There is no
-- write-back: the enquiry page reads the ticket's live status through
-- counselling_enquiry_id, which is the whole of the crossflow. Two records that
-- try to mirror each other eventually disagree, and then nobody knows which one
-- is the ticket.

-- ---------------------------------------------------------------------------
-- 1. The closing reason.
-- ---------------------------------------------------------------------------
--
-- A status of its own was the alternative and would have been worse: every
-- screen that asks "is this enquiry finished" already tests the status, and a
-- seventh value would have meant revisiting all of them. `closed` plus a reason
-- is the shape `superseded` and `converted` already use.
alter type public.close_reason add value if not exists 'handed_to_support';

notify pgrst, 'reload schema';
