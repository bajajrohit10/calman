-- Give calls.call_date a default matching what the trigger already writes.
--
-- app.calls_before_write() sets call_date from called_at on every insert and
-- update, and remains the authority — a backdated called_at still produces the
-- right calendar day, which is what the slot arithmetic in §4.3 counts.
--
-- The column was NOT NULL with no default, so PostgREST advertises it as a
-- required field and the generated types demand that every caller supply a
-- value the trigger is about to overwrite. That pushed the application into
-- either casting the insert or computing an IST date of its own — the exact
-- duplication of database logic this schema is arranged to avoid.
--
-- A DEFAULT may use a STABLE expression (unlike GENERATED, which is why the
-- original comment ruled that out), so the honest fix is to state the same
-- rule here.

alter table public.calls
  alter column call_date set default (now() at time zone 'Asia/Kolkata')::date;

comment on column public.calls.call_date is
  'IST calendar day of the call. Defaulted for the benefit of the API schema, '
  'then always (re)computed from called_at by app.calls_before_write().';
