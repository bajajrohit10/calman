-- §57.1. The arrivals written in SQL record their actor too.
--
-- Three functions insert into enquiry_sources without going through the
-- application: the bulk re-enquiry the importer uses, the offer reopen, and
-- attaching a call to a ticket. Patched in place so the rest of each function
-- — which is the part carrying the rules — cannot drift from what was there.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'import_re_enquire_many';

  -- The arrival the re-upload itself causes. Shopify's own checkouts are
  -- credited to the store by the application, which writes its own rows; this
  -- one is the uploader's, and p_import_batch_id is how it finds them.
  patched := replace(src,
$old$    insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, note)
    select d.enquiry_id, d.source_id, p_import_batch_id, 'Re-uploaded. ' || d.landed
      from described d$old$,
$new$    insert into public.enquiry_sources
      (enquiry_id, source_id, import_batch_id, note, added_by, added_via)
    select d.enquiry_id, d.source_id, p_import_batch_id,
           'Re-uploaded. ' || d.landed,
           (select b.uploaded_by from public.import_batches b
             where b.id = p_import_batch_id),
           'import'
      from described d$new$);
  if patched = src then
    raise exception 'import_re_enquire_many: source log insert not matched';
  end if;
  src := patched;

  -- The backfill row for an enquiry that had no arrival logged at all. It
  -- describes the source the enquiry already held, so it belongs to whoever
  -- created it.
  patched := replace(src,
$old2$    insert into public.enquiry_sources (enquiry_id, source_id, occurred_at, note)
    select d.enquiry_id, d.old_source, d.old_created_at,
           'Source held when the re-upload arrived.'$old2$,
$new2$    insert into public.enquiry_sources
      (enquiry_id, source_id, occurred_at, note, added_by, added_via)
    select d.enquiry_id, d.old_source, d.old_created_at,
           'Source held when the re-upload arrived.',
           (select e.created_by from public.enquiries e where e.id = d.enquiry_id),
           'quick_add'$new2$);
  if patched = src then
    raise exception 'import_re_enquire_many: backfill insert not matched';
  end if;

  execute patched;
end $mig$;

do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reopen_via_offer';

  patched := replace(src,
$old$  insert into public.enquiry_sources (enquiry_id, source_id, note)
  values (v_new, old.source_id, v_note || ' (was #' || p_enquiry_id || ')');$old$,
$new$  insert into public.enquiry_sources
    (enquiry_id, source_id, note, added_by, added_via)
  values (v_new, old.source_id, v_note || ' (was #' || p_enquiry_id || ')',
          (select auth.uid()), 'offer');$new$);
  if patched = src then raise exception 'reopen_via_offer: insert not matched'; end if;
  execute patched;
end $mig$;

do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'attach_to_ticket';

  patched := replace(src,
$old$  insert into public.enquiry_sources (enquiry_id, source_id, note)
  values (p_enquiry_id, p_source_id, p_note);$old$,
$new$  insert into public.enquiry_sources
    (enquiry_id, source_id, note, added_by, added_via)
  values (p_enquiry_id, p_source_id, p_note, (select auth.uid()), 'ticket');$new$);
  if patched = src then raise exception 'attach_to_ticket: insert not matched'; end if;
  execute patched;
end $mig$;

notify pgrst, 'reload schema';
