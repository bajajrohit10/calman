-- "Update existing" from the bulk-import review table (§5.7).
--
-- Same wall as supersede: enquiries_update allows only an admin, or the row's
-- creator on the IST day they created it. An import matched against an enquiry
-- raised last week is the ordinary case and would be denied. So this is a
-- definer function with its own is_staff() check, next to
-- app.supersede_enquiry, and it writes exactly six columns — never status,
-- never anything the recompute trigger owns.
--
-- Fill blanks only. An import file is generally less informed than the person
-- who took the call: if a counsellor has set the term to Sep-26 after speaking
-- to the student, an overnight file must not quietly reset it.
--
-- product_text is the exception, and deliberately so. A second abandoned
-- checkout for a different course is new information, not a correction, so a
-- genuinely different product line is APPENDED rather than dropped.

create or replace function app.import_update_enquiry(
  p_enquiry_id bigint,
  p_source_id uuid default null,
  p_product_text text default null,
  p_term_id uuid default null,
  p_importance public.importance default null,
  p_lead_verification public.lead_verification default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
  incoming text := nullif(btrim(coalesce(p_product_text, '')), '');
begin
  if not app.is_staff() then
    raise exception 'not authorised to update an enquiry from an import'
      using errcode = '42501';
  end if;

  select * into enq
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id using errcode = 'P0002';
  end if;

  -- The review table only offers "Update existing" for an open enquiry; a
  -- resolved one gets a new enquiry instead (§4.8).
  if enq.status <> 'open' then
    raise exception 'only an open enquiry can be updated from an import (this one is %)', enq.status
      using errcode = '22023';
  end if;

  update public.enquiries e
     set source_id         = coalesce(e.source_id, p_source_id),
         term_id           = coalesce(e.term_id, p_term_id),
         importance        = coalesce(e.importance, p_importance),
         lead_verification = coalesce(e.lead_verification, p_lead_verification),
         product_text = case
           -- Nothing came in: leave it alone.
           when incoming is null then e.product_text
           -- Nothing there yet: take it.
           when nullif(btrim(coalesce(e.product_text, '')), '') is null then incoming
           -- Already recorded, exactly or as one of the appended lines.
           when e.product_text = incoming then e.product_text
           when incoming = any (string_to_array(e.product_text, E'\n')) then e.product_text
           -- Genuinely different: a second interest, so keep both.
           else e.product_text || E'\n' || incoming
         end
   where e.id = p_enquiry_id;
end;
$$;

comment on function app.import_update_enquiry is
  'Bulk-import "Update existing" (§5.7): fills blank source/term/importance/'
  'lead_verification and appends a genuinely new product_text line. Never '
  'touches status or any trigger-derived column.';

revoke all on function app.import_update_enquiry(
  bigint, uuid, text, uuid, public.importance, public.lead_verification) from public;

-- PostgREST serves only `public`; app.* stays internal (see migration 0005).
create or replace function public.import_update_enquiry(
  p_enquiry_id bigint,
  p_source_id uuid default null,
  p_product_text text default null,
  p_term_id uuid default null,
  p_importance public.importance default null,
  p_lead_verification public.lead_verification default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.import_update_enquiry(
    p_enquiry_id, p_source_id, p_product_text, p_term_id,
    p_importance, p_lead_verification);
$$;

revoke all on function public.import_update_enquiry(
  bigint, uuid, text, uuid, public.importance, public.lead_verification) from public;
grant execute on function public.import_update_enquiry(
  bigint, uuid, text, uuid, public.importance, public.lead_verification) to authenticated;
