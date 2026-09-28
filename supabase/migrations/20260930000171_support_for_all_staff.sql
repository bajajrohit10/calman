-- §62.1. Support opens to every staff role.
--
-- Support started as the ticket team's screen. It is now where a counsellor
-- ends up whenever a student rings about an order rather than a purchase, so
-- locking them out means the person holding the phone cannot see or touch the
-- ticket they are about to raise.
--
-- One function changes, not seven call sites. app.is_support() is read by three
-- RLS policies (support.tickets, support.events, support.faculty_aliases) and by
-- four functions (save_ticket_action, log_ticket_touch, merge_ticket, and the
-- Brief 61 search helper's callers), so widening the definition widens all of
-- them at once and none of them can fall out of step.
--
-- `accounts` stays out, as everywhere else: that role reaches the remittance
-- module and no counselling or support table, and giving it a queue of student
-- complaints would be giving it a screen with no work on it.
create or replace function app.is_support()
returns boolean
language sql
stable
set search_path to ''
as $$
  -- Every staff role but accounts. Deliberately spelled out rather than
  -- delegating to app.is_staff(): that function means "has a working login",
  -- and if a sixth role is added one day the question "may they work support"
  -- should be answered here on purpose rather than inherited by accident.
  select app.role() in (
    'counsellor'::public.user_role,
    'ticket_team'::public.user_role,
    'manager'::public.user_role,
    'super_admin'::public.user_role
  );
$$;

comment on function app.is_support() is
  '§62.1. Every staff role except accounts. Read by the support RLS policies '
  'and by save_ticket_action / log_ticket_touch / merge_ticket. The reports and '
  'the CSV export are narrower and gated in their routes, not here.';

notify pgrst, 'reload schema';
