-- §77.3. A sale can be credited to somebody other than the caller.
--
-- Today the purchase belongs to whoever logged the call: call_report keys both
-- "Customers purchased" and "Purchase amount" on calls.called_by. That is right
-- almost always and wrong in the case that matters — a counsellor closes a sale
-- another counsellor built, or covers a colleague's number for an afternoon, and
-- the credit lands on the wrong person's row with no way to move it.
--
-- Nullable, and null means the caller. Nothing is backfilled: every call already
-- in the table was credited to its caller by definition, and writing that out
-- explicitly would turn an inference into a claim without adding a fact.
--
-- ON DELETE SET NULL, not CASCADE: removing a profile must never take a call —
-- the record that work happened — with it. The credit falls back to the caller,
-- which is the honest answer once the person it named is gone.
alter table public.calls
  add column if not exists credited_to uuid references public.profiles (id) on delete set null;

comment on column public.calls.credited_to is
  '§77.3. Who the sale belongs to, when that is not the caller. Null means the '
  'caller. Only the sale moves: the call itself always counts in called_by''s '
  'call columns.';

-- The report joins on it for every purchased call in the range.
create index if not exists calls_credited_to_idx
  on public.calls (credited_to) where credited_to is not null;
