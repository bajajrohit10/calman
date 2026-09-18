-- §55.5. Students whose name is a checkout reference.
--
-- A generic-path Shopify import mapped `name` to the export's "Name" column,
-- which holds "#38732731547735" — the checkout's own reference, not a person.
-- The real name was in Billing Name on the same row all along.
--
-- Swept rather than corrected one at a time: the mapping that did this was
-- saveable until yesterday, so there may be more than the one that was
-- reported, and a rule beats a list. Bounded to 15 September onward, which is
-- when the Shopify exports started arriving.
--
-- Only a name that is unmistakably a reference is touched: a "#" followed by
-- eleven or more digits and nothing else. A student with a real name keeps it,
-- including one that merely looks odd.
with wrong as (
  select s.id, s.mobile, s.name as old_name
    from public.students s
   where s.created_at >= '2026-09-15'
     and s.name ~ '^#[0-9]{11,}$'
),
-- The Billing Name from any import row that reached this student. Distinct,
-- and only where the file actually carried one: a blank cell is not a name and
-- must not overwrite anything.
candidate as (
  select w.id, w.mobile, w.old_name,
         min(btrim(r.raw ->> 'Billing Name')) as billing_name,
         count(distinct btrim(r.raw ->> 'Billing Name')) as distinct_names
    from wrong w
    join public.enquiries e on e.student_id = w.id
    join public.import_rows r on r.enquiry_id = e.id
   where coalesce(btrim(r.raw ->> 'Billing Name'), '') <> ''
   group by w.id, w.mobile, w.old_name
)
update public.students s
   set name = c.billing_name
  from candidate c
 where s.id = c.id
   -- Two different Billing Names behind one number is a question, not a fact,
   -- and guessing would put the wrong person on a lead. Those are left as they
   -- are, still visibly wrong, for somebody to answer.
   and c.distinct_names = 1;
