-- Grant EXECUTE on app.import_update_enquiry to authenticated.
--
-- Migration 0010 revoked it from PUBLIC and then granted only on the public
-- wrapper. But that wrapper is SECURITY INVOKER — it deliberately adds no
-- authority of its own — so the caller needs EXECUTE on the definer function
-- behind it. Without this grant every "Update existing" row in a bulk import
-- failed with "permission denied for function import_update_enquiry" and was
-- recorded as skipped.
--
-- app.supersede_enquiry has had this grant since migration 0004, which is why
-- the supersede path worked and this one did not. Granting EXECUTE is safe for
-- the same reason it is safe there: the definer function performs its own
-- app.is_staff() check before touching anything.

grant execute on function app.import_update_enquiry(
  bigint, uuid, text, uuid, public.importance, public.lead_verification
) to authenticated;
