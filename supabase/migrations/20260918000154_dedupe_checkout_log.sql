-- §55.2(c). One log row per cart, not two.
--
-- The first Shopify batch wrote the leading checkout twice on every created
-- enquiry: once on the ordinary "arrived in an import" row and again on the
-- per-cart row. Harmless to the dedupe, which reads distinct refs, and wrong
-- on a student's history, which shows the source log as a list of arrivals.
delete from public.enquiry_sources a
 using public.enquiry_sources b
 where a.enquiry_id = b.enquiry_id
   and a.checkout_ref is not null
   and a.checkout_ref = b.checkout_ref
   and a.id > b.id;

-- And it cannot happen again.
create unique index enquiry_sources_checkout_unique
  on public.enquiry_sources (enquiry_id, checkout_ref)
  where checkout_ref is not null;
