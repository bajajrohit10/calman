-- §55.4. Repairing the 18 September import that went through the generic path.
--
-- Batch 92b47534 uploaded the same Shopify file seventeen minutes after batch
-- 5ae9ac17 had already imported it correctly, from a client running the code
-- from before the checkout grouping existed. It therefore read the export as
-- 51 unrelated rows with a hand-mapped column set, and that mapping put
-- "Lineitem quantity" in product_text — so a day's leads recorded the word "1"
-- as what the student had asked about.
--
-- Four kinds of damage, repaired in the order they compound.

-- 1. The mapping itself, which would have done it again on the next upload.
--    saveMapping now refuses a Shopify-shaped header, but the row already
--    written has to go.
delete from public.import_column_maps
 where mapping ->> 'product_text' = 'Lineitem quantity';

-- 2. The quantity appended to eighteen existing leads' product text.
--    Only the trailing line is removed; every title above it was already
--    there and is left exactly as it was.
update public.enquiries
   set product_text = regexp_replace(product_text, '\n1$', '')
 where id in (
   select r.enquiry_id from public.import_rows r
    where r.batch_id = '92b47534-b67c-48d7-8d5d-0875edea33f7'
      and r.outcome = 're_enquired'
      and r.enquiry_id is not null
 )
   and product_text like E'%\n1';

-- 3. The enquiry that the bad batch superseded.
--
--    #770 is the real lead for 8527799484: it carries both titles and both
--    interest lines, which is precisely what the report said was missing. It
--    was closed only because an ungrouped row looked like a duplicate of it.
update public.enquiries
   set status = 'open', close_reason = null, closed_at = null
 where id = 770 and close_reason = 'superseded';

-- 4. The six enquiries that batch created.
--
--    All six have no calls and no interest lines, and every one of them
--    duplicates a lead the correct batch had already imported or updated. They
--    are closed rather than deleted: a real row that was written by a real
--    import is part of the record, and the audit log is how anybody later
--    works out what happened here.
update public.enquiries e
   set status = 'closed',
       close_reason = 'superseded',
       closed_at = now()
 where e.id in (
   select r.enquiry_id from public.import_rows r
    where r.batch_id = '92b47534-b67c-48d7-8d5d-0875edea33f7'
      and r.outcome in ('imported', 'duplicate_new_enquiry')
      and r.enquiry_id is not null
 )
   and e.status <> 'closed'
   and not exists (select 1 from public.calls c where c.enquiry_id = e.id)
   and not exists (select 1 from public.enquiry_items i where i.enquiry_id = e.id);

insert into public.enquiry_sources (enquiry_id, source_id, note)
select e.id, e.source_id,
       'Closed by the 18 Sep repair: created by an ungrouped Shopify import '
       'that duplicated a lead already imported correctly.'
  from public.enquiries e
 where e.id in (
   select r.enquiry_id from public.import_rows r
    where r.batch_id = '92b47534-b67c-48d7-8d5d-0875edea33f7'
      and r.outcome in ('imported', 'duplicate_new_enquiry')
      and r.enquiry_id is not null
 )
   and e.close_reason = 'superseded';

-- 5. The student whose name became a checkout reference.
--
--    The bad mapping pointed `name` at Shopify's "Name" column, which holds
--    "#38735244099671" — the checkout's own reference, not a person. The real
--    name was in Billing Name on the same row.
update public.students
   set name = 'SUMAN KARMAKAR'
 where mobile = '9830436964' and name = '#38735244099671';
