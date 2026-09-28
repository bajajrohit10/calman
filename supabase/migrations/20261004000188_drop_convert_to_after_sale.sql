-- §66.2. Drop public.convert_to_after_sale.
--
-- §62.2 stopped calling it: "this is an after-sale call" raises a support ticket
-- and leaves the purchase lead alone, instead of closing the lead as superseded
-- and opening an after-sale counselling enquiry beside it. The call was removed
-- from the code in 18a5236 and nothing has replaced it — no TypeScript caller,
-- no SQL function, no trigger, no view, no constraint (all checked in the
-- catalogue before writing this).
--
-- Dropping it is the point rather than tidiness. On 28 Sept a client running the
-- pre-§62.2 bundle still reached this function over PostgREST and fed the old
-- pipeline: enquiry 1758 closed as superseded, 1759 opened as after_sale, no
-- support ticket raised — and that row is one of the two still blocking the
-- /tickets retirement gate. While the function exists, any stale tab can do it
-- again. Without it, the stale call fails and the person retries on a reloaded
-- page, which is the outcome we want.
--
-- convert_to_purchase is deliberately left alone: the call panel still uses it
-- to move a call from a ticket to a purchase enquiry (§38.2).
drop function if exists public.convert_to_after_sale(bigint);

notify pgrst, 'reload schema';
