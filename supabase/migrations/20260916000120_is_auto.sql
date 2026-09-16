-- §49.2. An interest line the parser guessed, not a person recorded.
--
-- The distinction has to live on the row because everything else about the two
-- is identical: same four columns, same reports, same facets. What differs is
-- how much it should be trusted, and that is exactly the thing a screen needs
-- to be able to say. A guess shown as a fact is worse than no guess.
--
-- Defaults false, so every line that exists now and every line a human types
-- from here is what it has always been. Only the auto-filler sets it true, and
-- the first human touch sets it back.
alter table public.enquiry_items
  add column if not exists is_auto boolean not null default false;

comment on column public.enquiry_items.is_auto is
  '§49.2: filled by the product-text parser and not yet verified by a person.';

-- The screens ask "does this enquiry have any unverified lines" per row of a
-- list, so the enquiry is the leading column and the index only carries the
-- rows that can answer yes.
create index if not exists enquiry_items_auto_idx
  on public.enquiry_items (enquiry_id) where is_auto;

-- is_auto joins the audit trigger's exclusion list, for the same reason
-- call_type is excluded on enquiries: it is set and cleared by machinery
-- around what a person did, and a row saying only "is_auto changed" records
-- nothing anybody needs. The line's four real columns stay audited.
--
-- The trigger takes no arguments today, so it is simply recreated with one.
drop trigger if exists z_audit_enquiry_items on public.enquiry_items;

create trigger z_audit_enquiry_items
  after insert or delete or update on public.enquiry_items
  for each row execute function audit.log_change('is_auto');
