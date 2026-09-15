-- Four more words mean video: "video", "videos", "regular batch", "classes".
--
-- The first three are unambiguous. "classes" is the one to know about: it is
-- also how most institutes are named — AKG Classes, Aaditya Jain Classes, ALT
-- Classes — so a note reading "sent books list for Aaditya Jain Classes" now
-- classifies as video, because video wins when both match. At Zeroinfy a class
-- is video content, so this is usually the right answer; it is written down
-- here because it is the one rule in the set that can be triggered by a name
-- rather than by what the student asked for.
--
-- Word boundaries on the single words so "masterclasses" and "videography" do
-- not match. The phrases need no guard.
create or replace function app.derive_call_type(p_text text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_text is null or btrim(p_text) = '' then 'unknown'
    when p_text ~* '(\mlectures?\M|\mvideos?\M|\mclasses\M|full course|regular batch|exam oriented|fast track|test series|\mFT\M|\mEO\M)'
      then 'video'
    else 'books'
  end;
$$;

comment on function app.derive_call_type(text) is
  '§47.5: video | books | unknown, from product text and the latest call note.';

-- call_type joins the audit trigger's exclusion list, where it should have
-- gone when §47.5 added the column.
--
-- That list is not decoration. Its own comment says why it exists: "the
-- derived columns would write an audit row on every single call and bury the
-- edits the log exists to capture." call_type is derived on every write, so it
-- has been doing precisely that — 35 rows on the live database right now
-- recording a change to call_type and nothing else, which is 35 rows saying a
-- machine re-read a rule. Nobody needs to know that, and re-deriving below
-- would have added one per reclassified lead on top.
--
-- The existing rows are left alone. They are history, however dull, and
-- deleting audit records to tidy up is not a thing to do unasked.
drop trigger if exists z_audit_enquiries on public.enquiries;

create trigger z_audit_enquiries
  after insert or delete or update on public.enquiries
  for each row execute function audit.log_change(
    'fresh_call_date', 'follow_up_slots_used', 'last_slot_date',
    'top_content_priority', 'call_type');

-- Re-derive every stored value under the new rule. A no-op update fires the
-- before-write trigger, which is the one writer of this column; the audit
-- trigger now stays quiet for it.
update public.enquiries set product_text = product_text;
