-- §55.6. What happened to a held checkout, in the words the import uses.
--
-- The Missing-number tab answered "Done." and dropped the row off the list.
-- That is the one moment the person filling it in learns anything: whether the
-- number was new, whether it landed on a lead somebody was already following
-- up, and — the case that matters most — whether it just took a lead off a
-- colleague's day. "Done." said none of it, and the row vanished before
-- anybody could ask.
--
-- So the outcome is recorded rather than announced and forgotten: the number
-- that was typed, the five-case verdict in Brief 31's own sentences, and who
-- did it. The tab shows the last twenty underneath.
alter table public.held_checkouts
  add column resolved_mobile text,
  /** 1-6, Brief 31's case numbering. Null on a discard. */
  add column resolution_case smallint,
  /** "Already in follow-up list · last called 18 Sept 2026 by Neha Saraf" */
  add column resolution_label text,
  /** "Released from Neha Saraf's follow-ups to New Calls" */
  add column resolution_action text;

comment on column public.held_checkouts.resolution_action is
  'What the fill did, in the import review''s wording. Case 4 names the '
  'counsellor whose follow-up list the lead left, because that is a change to '
  'somebody else''s day and they are not the one reading this.';

-- The tab reads the last twenty, newest first.
create index held_checkouts_resolved_idx
  on public.held_checkouts (resolved_at desc)
  where resolution is not null;

notify pgrst, 'reload schema';
