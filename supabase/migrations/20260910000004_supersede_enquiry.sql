-- Supersede: the one enquiry status transition the application owns.
--
-- app.recompute_enquiry() derives every other status from call history and
-- deliberately refuses to touch a superseded enquiry (§4.9) — it was closed by
-- a human decision in Quick Add, not by anything the calls say. So the app has
-- to make this transition itself.
--
-- It cannot do so through RLS: enquiries_update allows only an admin, or the
-- creator on the same IST day. A counsellor superseding an enquiry that was
-- bulk-imported yesterday is the ordinary case and would be denied. Rather
-- than hand the application a service-role client — which would bypass RLS on
-- enquiries for every write, not just this one — the transition lives here as
-- a definer function with its own authorisation check, next to the trigger
-- that respects it.

create or replace function app.supersede_enquiry(p_enquiry_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
begin
  -- Definer functions run as the owner, so the caller's authority is
  -- established here and never assumed from the fact that the UI offered it.
  if not app.is_staff() then
    raise exception 'not authorised to supersede an enquiry'
      using errcode = '42501';
  end if;

  select * into enq
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id
      using errcode = 'P0002';
  end if;

  -- Idempotent: a double-submit settles rather than raising.
  if enq.status = 'closed' and enq.close_reason = 'superseded' then
    return;
  end if;

  if enq.type <> 'purchase' then
    raise exception 'only a purchase enquiry can be superseded'
      using errcode = '22023';
  end if;

  -- Superseding is "this enquiry is replaced by the new one". A won or lost
  -- enquiry is already resolved and §4.8 says the caller simply gets a new
  -- enquiry alongside it, so there is nothing to close.
  if enq.status <> 'open' then
    raise exception 'only an open enquiry can be superseded (this one is %)', enq.status
      using errcode = '22023';
  end if;

  update public.enquiries
     set status = 'closed',
         close_reason = 'superseded',
         -- lost_reason_iff_lost: a closed row must not carry one.
         lost_reason = null,
         next_follow_up_date = null,
         closed_at = coalesce(closed_at, now())
   where id = p_enquiry_id;
end;
$$;

comment on function app.supersede_enquiry(bigint) is
  'Closes an open purchase enquiry with close_reason = superseded (§5.1). The '
  'only enquiry status transition written by the application; every other one '
  'is derived by app.recompute_enquiry() from call history.';

revoke all on function app.supersede_enquiry(bigint) from public;
grant execute on function app.supersede_enquiry(bigint) to authenticated;
