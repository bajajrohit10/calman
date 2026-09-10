-- When an item was actually bought.
--
-- §5.8's "Purchased (count + amount)" asks for the amounts won *on a given
-- day*, and enquiry_items had no way to answer that. Joining items to the
-- purchase call by shared order_id came close, but is wrong the first time an
-- order ID is reused, and silently so.
--
-- The panel sets this when it marks an item won, so the timestamp is a fact
-- about the sale rather than an inference from it.

alter table public.enquiry_items
  add column if not exists won_at timestamptz;

create index if not exists enquiry_items_won_at_idx
  on public.enquiry_items (won_at)
  where won_at is not null;

comment on column public.enquiry_items.won_at is
  'Set when the item is marked won (§5.3). Drives the daily purchased amount '
  'in §5.8; null for items that were never won.';

-- Backfill from the call that won them, which is the truest timestamp
-- available for rows written before this column existed. Items with no
-- purchased call on their enquiry stay null rather than being given an
-- invented date.
update public.enquiry_items i
   set won_at = (
     select max(c.called_at)
       from public.calls c
      where c.enquiry_id = i.enquiry_id
        and c.outcome = 'purchased'
   )
 where i.status = 'won'
   and i.won_at is null;
