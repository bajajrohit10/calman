-- Three more words mean video: "full", "regular", "batch". All word-bounded,
-- so "fully", "regularly" and "batches" do not match.
--
-- Two entries leave the list at the same time, because these three swallow
-- them whole and a regex alternative that can never be the one that matched is
-- dead weight that reads as though it does something:
--
--   "full course"   is subsumed by \mfull\M
--   "regular batch" is subsumed by \mregular\M and by \mbatch\M
--
-- Worth knowing if either word is ever taken back out: removing "full" also
-- stops "full course" matching, and removing both "regular" and "batch" stops
-- "regular batch".
--
-- Measured on the live database before this ran: of 147 purchase enquiries,
-- exactly 2 move — "DT full" and "DT Full", both on \mfull\M. "regular" and
-- "batch" match nothing currently recorded, so they are here for what gets
-- typed next rather than for what is already there.
create or replace function app.derive_call_type(p_text text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_text is null or btrim(p_text) = '' then 'unknown'
    when p_text ~* '(\mlectures?\M|\mvideos?\M|\mclasses\M|\mfull\M|\mregular\M|\mbatch\M|exam oriented|fast track|test series|\mFT\M|\mEO\M)'
      then 'video'
    else 'books'
  end;
$$;

comment on function app.derive_call_type(text) is
  '§47.5: video | books | unknown, from product text and the latest call note.';

-- Re-derive every stored value under the new rule. The no-op update fires the
-- before-write trigger, which is the one writer of this column; call_type is
-- in the audit trigger's exclusion list, so this writes no audit rows.
update public.enquiries set product_text = product_text;
