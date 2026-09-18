-- §55.2(c). The dedupe reads every place a checkout can have landed.
--
-- import_rows carries one ref per imported row, which is the first of a merged
-- candidate's checkouts and not the rest. enquiry_sources carries all of them,
-- one per cart. A checkout that reached us through a re-enquiry is only in the
-- second — so a dedupe that read only the first would let tomorrow's file
-- bring the same abandoned cart back as a new lead.
create or replace function public.seen_checkout_refs(p_refs text[])
returns table (checkout_ref text)
language sql
stable
set search_path to ''
as $$
  select distinct r.checkout_ref
    from public.import_rows r
   where r.checkout_ref = any (p_refs)
  union
  select distinct s.checkout_ref
    from public.enquiry_sources s
   where s.checkout_ref = any (p_refs)
  union
  select distinct h.checkout_ref
    from public.held_checkouts h
   where h.checkout_ref = any (p_refs);
$$;

-- The first Shopify batch was committed before the log covered both branches,
-- so the second and third carts of its merged candidates were recorded
-- nowhere. Recovered from what the import itself stored: import_rows.raw keeps
-- the candidate exactly as it was assembled, including every checkout Id that
-- went into it.
insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, checkout_ref, note)
select r.enquiry_id,
       (select e.source_id from public.enquiries e where e.id = r.enquiry_id),
       r.batch_id,
       btrim(ref),
       'Arrived in an import. Shopify checkout ' || btrim(ref) || '.'
  from public.import_rows r
  cross join lateral unnest(string_to_array(r.raw ->> 'Checkout Id', ',')) as ref
 where r.checkout_ref is not null
   and r.enquiry_id is not null
   and not exists (
     select 1 from public.enquiry_sources s
      where s.enquiry_id = r.enquiry_id and s.checkout_ref = btrim(ref));

notify pgrst, 'reload schema';
