-- §75.1. An institute escalation needs at least one institute, not a first one.
--
-- The check read institute_id, which the transition trigger keeps as
-- institute_ids[1] — so it happens to hold today and would stop holding the
-- moment that column is dropped. Stated on the list it actually means.
alter table support.tickets
  drop constraint if exists tickets_institute_escalation_has_institute;

alter table support.tickets
  add constraint tickets_institute_escalation_has_institute
  check (escalation_kind is distinct from 'institute'
         or cardinality(institute_ids) > 0);

-- §75.1. And where one was chosen, it has to be one the ticket names. A name
-- from another house would print on the Escalated tab and in the reports as the
-- place this ticket is waiting on, which it is not.
alter table support.tickets
  drop constraint if exists tickets_escalated_institute_is_carried;

alter table support.tickets
  add constraint tickets_escalated_institute_is_carried
  check (escalated_institute_id is null
         or escalated_institute_id = any (institute_ids));
