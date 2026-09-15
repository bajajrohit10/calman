-- §47.5, corrected. Deriving call_type inside recompute_enquiry was not
-- enough, and testing said so: a brand-new lead came out 'unknown' however
-- much product text it carried.
--
-- recompute_enquiry runs off calls and items. An enquiry that has neither —
-- every row in New Calls, by definition — never reaches it, so the one screen
-- the tabs were built for was the one screen where they could not work. The
-- same hole swallowed an edit: changing the product text on an existing lead
-- left the old classification in place.
--
-- The derivation belongs on the write instead. a_enquiries_before_write already
-- fires BEFORE INSERT OR UPDATE on every path into the table, including the
-- UPDATE recompute_enquiry itself issues — so calls and items still refresh it,
-- and now so do creation and correction.
--
-- It is therefore removed from recompute_enquiry: the rule has always lived in
-- app.derive_call_type, but the wiring should be in one place, and two writers
-- of the same column is how they start disagreeing.

create or replace function app.enquiries_before_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_note text;
begin
  new.next_follow_up_date := app.next_working_day(new.next_follow_up_date);

  -- §47.5. Product text plus the latest call note. After-sale enquiries are
  -- never classified: the brief scopes this to purchase, and the Video/Books
  -- question is meaningless for a complaint.
  if new.type = 'purchase' then
    select c.discussion into v_note
      from public.calls c
     where c.enquiry_id = new.id
     order by c.call_date desc, c.called_at desc, c.id desc
     limit 1;

    new.call_type := app.derive_call_type(
      concat_ws(' ', new.product_text, v_note));
  else
    new.call_type := 'unknown';
  end if;

  return new;
end;
$function$;

-- recompute_enquiry stops writing the column.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  patched := replace(src, E'         call_type = v_call_type,\n', '');
  if patched = src then
    raise exception 'recompute_enquiry: call_type assignment not found';
  end if;
  src := patched;

  -- And the now-unused computation above it, so nothing reads as if it still
  -- decides something.
  patched := replace(
    src,
    E'  v_call_type := case\n'
    || E'                    when enq.type = ''purchase''\n'
    || E'                    then app.derive_call_type(\n'
    || E'                           concat_ws('' '', enq.product_text, v_last.discussion))\n'
    || E'                    else ''unknown''\n'
    || E'                  end;\n\n',
    ''
  );
  if patched = src then
    raise exception 'recompute_enquiry: call_type computation not found';
  end if;
  src := patched;

  patched := replace(src, E'  v_call_type text;\n', '');
  if patched = src then
    raise exception 'recompute_enquiry: v_call_type declaration not found';
  end if;

  execute patched;
end $$;

-- Re-run the backfill through the new writer, so stored values and the rule
-- agree everywhere rather than only on rows touched since.
update public.enquiries set product_text = product_text;
