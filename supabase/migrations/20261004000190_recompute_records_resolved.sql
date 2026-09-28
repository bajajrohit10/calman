-- §68.2. The recompute says why an after-sale enquiry closed, and the four rows
-- that predate it are labelled.

-- ---------------------------------------------------------------------------
-- 1. Closing because the last call said "resolved" now records that.
-- ---------------------------------------------------------------------------
--
-- Two edits to app.recompute_enquiry, and the second is not optional.
--
--   (a) The after_sale branch sets v_close := 'resolved' alongside the status,
--       so the close is self-describing from now on.
--
--   (b) 'resolved' joins the early-return guard. Brief 66 added
--       `or (enq.type = 'after_sale' and enq.close_reason is null)` so that a
--       closed after-sale enquiry could not be recomputed back open — that is
--       what reopened enquiry 1645 when a call was deleted. The backfill below
--       fills those nulls in, which would quietly take those very rows *out* of
--       that guard's reach. Adding 'resolved' to the list keeps the protection
--       Brief 66 bought instead of spending it on a label.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  -- (a) the reason, written where the status is decided.
  patched := replace(src,
$old$                  when 'resolved' then 'closed'::public.enquiry_status
                end;
    v_next := v_last.next_follow_up_date;$old$,
$new$                  when 'resolved' then 'closed'::public.enquiry_status
                end;
    -- §68.2. A resolved complaint closes for a reason, and now says so.
    if v_last.outcome = 'resolved' then
      v_close := 'resolved';
    end if;
    v_next := v_last.next_follow_up_date;$new$);

  if patched = src then
    raise exception 'recompute_enquiry: the after_sale status branch was not matched';
  end if;
  src := patched;

  -- (b) and the close, once labelled, still sticks.
  patched := replace(src,
$old$     and (enq.close_reason in ('superseded', 'converted', 'handed_to_support')$old$,
$new$     and (enq.close_reason in ('superseded', 'converted', 'handed_to_support',
                                -- §68.2. Labelled by the branch below, and just
                                -- as settled as a hand-off.
                                'resolved')$new$);

  if patched = src then
    raise exception 'recompute_enquiry: the close guard was not matched';
  end if;
  execute patched;
end $mig$;

-- ---------------------------------------------------------------------------
-- 2. The four rows that closed this way before the reason existed.
-- ---------------------------------------------------------------------------
--
-- Strictly the condition, never a list of ids: after_sale, already closed, no
-- reason recorded, and the latest call by time then id says 'resolved'. A row
-- that fails any part of that is left exactly as it is — including the two open
-- ones (1645, 1759) and any close whose last call said something else.
--
-- This is a fill of a value the system should have written itself, not an edit
-- to anything a person typed: the status and the call history already said
-- "resolved", and only the label was missing.
do $mig$
declare v_ids bigint[]; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.enquiries
   where type = 'after_sale' and status = 'closed' and close_reason is null;

  with target as (
    select e.id from public.enquiries e
     where e.type = 'after_sale'
       and e.status = 'closed'
       and e.close_reason is null
       and (select c.outcome from public.calls c
             where c.enquiry_id = e.id
             order by c.called_at desc, c.id desc limit 1) = 'resolved'
  )
  update public.enquiries e
     set close_reason = 'resolved'
   where e.id in (select id from target);

  select array_agg(id order by id) into v_ids from public.enquiries
   where type = 'after_sale' and close_reason = 'resolved';

  select count(*) into v_after from public.enquiries
   where type = 'after_sale' and status = 'closed' and close_reason is null;

  raise notice '§68.2 backfill: null-reason after-sale closes % -> %; now labelled resolved: %',
    v_before, v_after, v_ids;
end $mig$;

notify pgrst, 'reload schema';
