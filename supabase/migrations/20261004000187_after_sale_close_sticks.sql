-- §66.3. A closed after-sale enquiry stays closed, reason or no reason.
--
-- The guard tested `close_reason in ('superseded', 'converted',
-- 'handed_to_support')`, and in SQL `null in (...)` is null — never true. So an
-- after-sale enquiry closed *without* a reason fell straight through and was
-- recomputed from its call history, which for a complaint whose last call was
-- 'escalated' means reopening it as escalated.
--
-- That is not hypothetical. Enquiry 1645 was closed by hand on 28 Sept when a
-- support ticket was raised from it; the close left close_reason null; and when
-- the Brief 65 reset deleted the raiser's call on it, the recompute fired and
-- put it back to 'escalated'. It then blocked the /tickets retirement gate,
-- which is how it was noticed at all.
--
-- Scoped to after_sale on purpose. A purchase lead closed with no reason is a
-- different animal — its status genuinely follows its calls, and making every
-- reasonless close permanent there would freeze rows the counsellors expect to
-- move. After-sale work no longer lives in counselling at all (§62.2), so a
-- closed one has nothing left to recompute towards.
--
-- Nothing is backfilled: the four rows in this state today are left exactly as
-- they are. This stops the next reopen, it does not rewrite history.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  patched := replace(src,
$old$  if enq.status = 'closed'
     and enq.close_reason in ('superseded', 'converted', 'handed_to_support') then
    return;
  end if;$old$,
$new$  if enq.status = 'closed'
     and (enq.close_reason in ('superseded', 'converted', 'handed_to_support')
          -- §66.3. A closed after-sale enquiry with no reason recorded. The
          -- close was somebody's decision even though nothing wrote down why,
          -- and `null in (...)` above would never have caught it.
          or (enq.type = 'after_sale' and enq.close_reason is null)) then
    return;
  end if;$new$);

  if patched = src then
    raise exception 'app.recompute_enquiry: the close guard was not matched';
  end if;
  execute patched;
end $mig$;

notify pgrst, 'reload schema';
