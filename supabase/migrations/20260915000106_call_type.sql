-- §47.5. Book / Video / Unknown, derived for every purchase enquiry.
--
-- Derived and stored, the way follow_up_slots_used and top_content_priority
-- already are, rather than computed in each reader. It depends on the latest
-- call's note, so a view would have to join calls for every row of every list
-- that shows it; recompute_enquiry already holds that row and already runs
-- whenever a call lands.
--
-- The column is called call_type because that is what the brief and the
-- counsellors call it. Note for anyone reading call_report: the local alias
-- `call_type` in that function is an unrelated older thing meaning which of
-- the day's piles a call came from. Different scope, different meaning; there
-- is no SQL ambiguity, only a chance of confusion.

-- 1. The rule itself, in one place.
--
-- Immutable and text-in/text-out so it can be used in an index or a backfill
-- as freely as in a trigger. The caller decides what text to hand it — §47.5
-- says product text plus the latest call note — so this stays the rule and
-- nothing else.
create or replace function app.derive_call_type(p_text text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_text is null or btrim(p_text) = '' then 'unknown'
    -- Video wins when both match, so it is asked first. \m and \M are word
    -- boundaries: FT and EO are short enough to appear inside ordinary words,
    -- and "gift" or "video" must not be read as a content code. The longer
    -- phrases need no such guard. Test series is a video product (§47.5).
    when p_text ~* '(\mlectures?\M|full course|exam oriented|fast track|test series|\mFT\M|\mEO\M)'
      then 'video'
    -- Any text at all that did not look like video. §47.5: books is the
    -- default for a lead we know something about, unknown for one we do not.
    else 'books'
  end;
$$;

comment on function app.derive_call_type(text) is
  '§47.5: video | books | unknown, from product text and the latest call note.';

-- 2. The column.
alter table public.enquiries
  add column if not exists call_type text not null default 'unknown';

alter table public.enquiries drop constraint if exists call_type_known;
alter table public.enquiries add constraint call_type_known
  check (call_type in ('video', 'books', 'unknown'));

comment on column public.enquiries.call_type is
  '§47.5: derived, never entered. Purchase enquiries only; after-sale is always unknown.';

-- 3. recompute_enquiry maintains it.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  patched := replace(src, E'  v_next date;\n', E'  v_next date;\n  v_call_type text;\n');
  if patched = src then
    raise exception 'recompute_enquiry: v_next declaration not found';
  end if;
  src := patched;

  patched := replace(
    src,
    E'  update public.enquiries e\n     set status = v_status,',
    -- §47.5. Product text and the latest call note, together, as one string.
    -- concat_ws skips nulls, so a lead with no calls is classified on its
    -- product text alone and a lead with neither comes out unknown.
    E'  v_call_type := case\n'
    || E'                    when enq.type = ''purchase''\n'
    || E'                    then app.derive_call_type(\n'
    || E'                           concat_ws('' '', enq.product_text, v_last.discussion))\n'
    || E'                    else ''unknown''\n'
    || E'                  end;\n'
    || E'\n'
    || E'  update public.enquiries e\n     set status = v_status,\n         call_type = v_call_type,'
  );
  if patched = src then
    raise exception 'recompute_enquiry: update statement not found';
  end if;

  execute patched;
end $$;

-- 4. Backfill. Everything that exists now, classified the same way the trigger
-- will classify it from here — including archived rows, so an unarchived lead
-- does not come back unclassified.
with latest as (
  select distinct on (c.enquiry_id) c.enquiry_id, c.discussion
    from public.calls c
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
)
update public.enquiries e
   set call_type = case
                     when e.type = 'purchase'
                     then app.derive_call_type(
                            concat_ws(' ', e.product_text, l.discussion))
                     else 'unknown'
                   end
  from (select id from public.enquiries) ids
  left join latest l on l.enquiry_id = ids.id
 where e.id = ids.id;

-- 5. live_enquiries is an explicit column list, so it freezes at the shape the
-- table had when it was written. Brief 44 learned this the hard way: a column
-- added to the table is invisible to every function reading through the view
-- until the view is rewritten.
create or replace view public.live_enquiries as
  select id, student_id, type, source_id, product_text, term_id, importance,
         lead_verification, status, lost_reason, close_reason,
         next_follow_up_date, fresh_call_date, follow_up_slots_used,
         last_slot_date, top_content_priority, created_at, created_by,
         closed_at, archived_at, archived_by, archive_batch_id, re_enquired_at,
         reopened_via_offer_id, reopened_from_enquiry_id, order_id, teacher_id,
         escalated_to,
         call_type
    from public.enquiries
   where archived_at is null;
