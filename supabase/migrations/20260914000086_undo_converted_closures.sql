-- Brief 38.4: give back the leads that Brief 25 closed.
--
-- convert_to_after_sale used to close the purchase enquiry as 'converted' when
-- it had calls on it, on the assumption that a student is in one pipeline at a
-- time. Brief 38 rejected that assumption, so the closures it made are wrong
-- by the rule we now hold: the lead was never finished, it was moved out of
-- the way. Each one goes back to open, keeping its calls and items, and the
-- after-sale enquiry created alongside it stays exactly where it is.
--
-- The two rows at the time of writing, both closed on 14 Sept 2026 by the same
-- person, both open beforehand with one follow_up call and no interests:
--
--   #510  Demo Check   9876543298  → ticket #511
--   #523  (no name)    9911111111  → ticket #540
--
-- Their full pre-repair state is in the commit message for this migration.
-- The audit trigger records this update as well, so the change is recoverable
-- from the log even if that is lost.
--
-- Written against close_reason rather than against those two ids on purpose:
-- nothing else in the schema has ever written 'converted', and nothing will
-- again, so the set is exactly the rows this is about.
do $$
declare
  v_before integer;
  v_after integer;
begin
  select count(*) into v_before
    from public.enquiries where close_reason = 'converted';

  if v_before = 0 then
    raise notice 'nothing closed as converted; migration is a no-op';
    return;
  end if;

  -- Back to open, with the closure undone. next_follow_up_date is left alone:
  -- it was already null on both rows, and where it is not, the recompute below
  -- is what should decide it rather than this migration guessing.
  update public.enquiries e
     set status = 'open',
         close_reason = null,
         closed_at = null
   where e.close_reason = 'converted';

  get diagnostics v_after = row_count;
  if v_after <> v_before then
    raise exception 'expected to reopen % rows, reopened %', v_before, v_after;
  end if;

  raise notice 'reopened % enquiries closed as converted', v_after;
end $$;

-- Now that close_reason is clear, app.recompute_enquiry will manage these rows
-- again — it skips anything closed as 'superseded' or 'converted', which is why
-- they have been frozen. Running it once settles each from its own call
-- history rather than leaving the status this migration set by hand.
do $$
declare
  r record;
begin
  for r in
    select e.id
      from public.enquiries e
      join public.audit_log a
        on a.table_name = 'enquiries'
       and a.action = 'update'
       and a.row_pk = e.id::text
       and a.new_data ->> 'close_reason' = 'converted'
     where e.status = 'open' and e.close_reason is null
     group by e.id
  loop
    perform app.recompute_enquiry(r.id);
  end loop;
end $$;
