-- §77.1. A sixth issue: "Pending books / Under printing".
--
-- The team has been recording this as free text in issue_other_work, which keeps
-- it out of the facets, the filter and the by-issue report — the three places
-- somebody would go to ask how many there are.
--
-- The Google Form is unchanged, and so is the intake parser. That parser works by
-- removing the form's known strings from the cell and keeping the remainder, so a
-- string the form cannot produce must never be in its subtraction list: it would
-- silently eat the phrase from a student who happened to type it. The TypeScript
-- side keeps the two lists apart for the same reason (FORM_ISSUE_OPTIONS versus
-- ISSUE_OPTIONS); this function is the validation list, so it carries all six.
--
-- Last, after the five, because the order here is the order the checkboxes and
-- the filter print.
create or replace function support.issue_options()
returns text[]
language sql
immutable
set search_path to ''
as $$
  select array[
    'Tracking ID Issues',
    'Courier & Delivery Issues',
    'Link / Serial Key Mail not received',
    'Technical Issue / Course Extension',
    'Received Damaged/Defective Product',
    'Pending books / Under printing'
  ]::text[];
$$;

notify pgrst, 'reload schema';
