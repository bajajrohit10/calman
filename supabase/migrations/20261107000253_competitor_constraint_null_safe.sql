-- §89. The half-constraint was not null-safe, so it checked nothing on an open
-- lead.
--
--   check (lost_reason = 'competitor' or (competitor_id is null and ...))
--
-- `lost_reason` is NULL on every open lead, `NULL = 'competitor'` is NULL,
-- `NULL or false` is NULL — and a CHECK passes when its expression is NULL.
-- So "a lead that is not a competitor loss names no competitor" was enforced
-- on lost and won leads and silently waived on open ones, which are most of
-- them. Caught by a probe that set a competitor on an open ZTEST lead and was
-- allowed to.
--
-- The same trap as §73's tab_matches and §83's closed predicate. The `case`
-- form below is null-safe by construction: a NULL lost_reason takes the ELSE
-- branch rather than evaluating to NULL, which is also why the backfill
-- migration's "exactly one" version is written the same way.

alter table public.enquiries
  drop constraint enquiries_competitor_only_when_lost_to_one;

alter table public.enquiries
  add constraint enquiries_competitor_only_when_lost_to_one
  check (
    case
      when lost_reason = 'competitor' then true
      else competitor_id is null and competitor_other is null
    end
  );
