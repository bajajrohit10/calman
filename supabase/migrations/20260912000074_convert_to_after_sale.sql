-- Turning a purchase enquiry into an after-sale one, from the call panel.
--
-- A counsellor picks up the phone expecting a sales call and finds somebody
-- whose videos will not play. Until now the only way to record that was to
-- log it as a purchase call and write the real story in the note, which puts
-- a support call in the sales figures and leaves the ticket screen — the one
-- place anybody looks for unresolved problems — not knowing about it.
--
-- Two paths, because a lead with history is not the same thing as a lead
-- without one:
--
--   * Never called: the enquiry was only ever a guess about why this person
--     rang. Convert it in place; there is no sales history to preserve
--     because there is no history at all.
--
--   * Already called: those calls happened and they were sales calls. The
--     enquiry is closed with a new reason and a fresh after-sale enquiry
--     takes the call, so both stories survive and each is readable on its
--     own terms. The same shape §4.8 uses for a lead that comes back.

alter type public.close_reason add value if not exists 'converted';

