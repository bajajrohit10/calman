-- Price check: the owner's own pricing and matching instructions per vendor
-- site (23 Oct 2026).
--
-- Separate from `notes`, which holds technical notes about how a site is read.
-- This column is for business rules in plain words — "Rs 500 below BB above
-- Rs 4,000", "Mohnish Vora's own courses stay at BB price" — that the team
-- reads while matching, and that Brief 2 turns into structured price rules
-- where they can be applied automatically. Free text on purpose: rules arrive
-- with exceptions, and a form would lose them.

alter table public.vendor_sites add column instructions text;

comment on column public.vendor_sites.instructions is
  'Owner-written pricing/matching rules for this site, plain text. Read by the team; Brief 2 derives structured rules from it.';

-- Pre-filled with the rules the owner has already stated, so the box opens as
-- a draft to correct rather than empty. Only where nothing has been written.
update public.vendor_sites set instructions =
'Offer (Oct 2026): Zeroinfy price = BB price minus Rs 500.
- Rs 500 off does NOT apply when the product price is Rs 4,000 or below (keep BB price).
- Mohnish Vora''s own courses: keep BB price (no Rs 500). Combos pairing him with other faculty (e.g. Keswani + Mohnish Vora Audit & FM/SM) DO get Rs 500 off.
- Group 1 combo follows the Rs 500 rule.
- Karan Kumar courses: Rs 1,000 below BB (not Rs 500).
- Amit Mahajan CA/CMA Inter Taxation (DT + GST) Practice Batch: keep BB price.'
where lower(name) = 'bb virtuals' and instructions is null;

update public.vendor_sites set instructions =
'Vendor price = Vsmart total after its automatic coupon.
- Vsmart / Vishal Bhattad courses follow the Rs 500 rule (Rs 500 below; not when Rs 4,000 or below).
- Exceptions kept unchanged: Vsmart IDT Regular (Vishal Bhattad), CA Rajkumar GST.
- Shubham Singhal: compare with shubhamsinghal.com too and follow whichever is lower.'
where lower(name) = 'vsmart academy' and instructions is null;

update public.vendor_sites set instructions =
'Also sold via Vsmart Academy. Zeroinfy follows whichever of the two prices is lower.'
where lower(name) = 'ca shubham singhal' and instructions is null;
