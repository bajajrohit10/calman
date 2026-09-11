-- §10.1: two new import outcomes.
--
--   re_enquired  rules (b) and (c) — the open enquiry was kept, its source
--                overridden and logged, and for (c) it went back to New Calls.
--   dismissed    rule (d) — the number came in again on a day somebody had
--                already spoken to them, and the operator left it alone.
--
-- duplicate_updated stays in the enum although nothing writes it any more:
-- historical import_rows carry it, and dropping an enum value would rewrite
-- what those batches say happened.
--
-- ADD VALUE only. The values are not used anywhere in this transaction, which
-- is what PostgreSQL requires to allow this inside a migration.
alter type public.import_outcome add value if not exists 're_enquired';
alter type public.import_outcome add value if not exists 'dismissed';
