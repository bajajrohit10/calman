-- §54.3. An enquiry that was never the type it was created as.
--
-- Quick Add makes a purchase enquiry, because that is what a number arriving
-- usually is. When the first call turns out to be an after-sale one, the
-- counsellor flips the switch in the call panel and a ticket is opened beside
-- it — and the purchase enquiry is deliberately left alone, because §25 is
-- about not destroying a lead's history when somebody rings in with a problem.
--
-- That is right when there is history. It is wrong when there is none. On
-- 6816484621 the purchase enquiry was created at 08:21:49, the switch was
-- thrown at 08:22:25, and the purchase row stayed open with zero calls and
-- zero items — back into the New Calls pool the next morning as work nobody
-- had done, when in fact somebody had spoken to them a minute after it was
-- created. Taking it from the pool and switching again opened a second ticket
-- and left the same orphan behind, which is how that number ended up with one
-- open purchase enquiry and two closed tickets.
--
-- So: if the enquiry the counsellor started from has no calls and no items, it
-- was never that type, and it is closed as superseded rather than left to
-- circulate. Anything with a call or an item on it is untouched — the
-- never-convert rule stands, and this does not weaken it.
create or replace function app.close_if_never_that_type(
  p_enquiry_id bigint,
  p_opened_id bigint
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_closed boolean := false;
begin
  update public.enquiries e
     set status = 'closed',
         close_reason = 'superseded',
         closed_at = now()
   where e.id = p_enquiry_id
     and e.status not in ('closed', 'lost')
     and e.archived_at is null
     -- The whole test: nothing on it worth preserving. A call or an item
     -- means somebody did something here, and §25 protects that.
     and not exists (select 1 from public.calls c where c.enquiry_id = e.id)
     and not exists (select 1 from public.enquiry_items i where i.enquiry_id = e.id);

  if found then
    v_closed := true;
    insert into public.enquiry_sources (enquiry_id, source_id, note)
    select p_enquiry_id, e.source_id,
           'Type corrected at first call; superseded by enquiry #'
             || p_opened_id || '.'
      from public.enquiries e where e.id = p_enquiry_id;
  end if;

  return v_closed;
end $$;

-- Both directions, mirrored. The patch is applied to the live definitions so
-- the rest of each function — the reuse rule, the assignment, the notes on
-- both ends — cannot drift from what was there.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'convert_to_after_sale';

  patched := replace(src,
$old$  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  values (v_new, app.ist_today(), (select auth.uid()), 'fresh', (select auth.uid()))
  on conflict (enquiry_id, date) do nothing;

  return v_new;$old$,
$new$  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  values (v_new, app.ist_today(), (select auth.uid()), 'fresh', (select auth.uid()))
  on conflict (enquiry_id, date) do nothing;

  -- §54.3. It was never a purchase enquiry, so it does not stay open as one.
  perform app.close_if_never_that_type(p_enquiry_id, v_new);

  return v_new;$new$);
  if patched = src then raise exception 'convert_to_after_sale: tail not matched'; end if;
  execute patched;
end $mig$;

do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'convert_to_purchase';

  patched := replace(src,
$old$  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  values (v_new, app.ist_today(), (select auth.uid()), 'fresh', (select auth.uid()))
  on conflict (enquiry_id, date) do nothing;

  return v_new;$old$,
$new$  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  values (v_new, app.ist_today(), (select auth.uid()), 'fresh', (select auth.uid()))
  on conflict (enquiry_id, date) do nothing;

  -- §54.3, mirrored: a ticket nobody ever worked was never a ticket.
  perform app.close_if_never_that_type(p_enquiry_id, v_new);

  return v_new;$new$);
  if patched = src then raise exception 'convert_to_purchase: tail not matched'; end if;
  execute patched;
end $mig$;

notify pgrst, 'reload schema';
