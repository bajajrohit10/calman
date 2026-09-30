-- §77.2. A ticket can be waiting on our courier.
--
-- Alone in its own migration: ALTER TYPE ... ADD VALUE cannot be used in the
-- transaction that adds it, and everything after this uses it.
--
-- It is not an escalation. Escalated means somebody was asked to act — a
-- colleague or the institute — and the reports count those as handovers of
-- responsibility. Waiting on our own courier is the team still holding the
-- ticket with nothing to do but wait, which is why it wants a follow-up date and
-- a tab of its own rather than a sixth flavour of Escalated.
alter type support.ticket_status add value if not exists 'courier'
  after 'escalated';
