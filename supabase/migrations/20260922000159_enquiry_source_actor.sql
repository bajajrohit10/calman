-- §57.1. Who added this lead.
--
-- New Calls shows a pool of leads and says nothing about where any of them
-- came from, so a counsellor picking one up cannot tell a number somebody
-- keyed during a phone call from one that arrived in last night's Shopify
-- file. The three answers exist in three different places and one of them
-- does not exist at all:
--
--   * enquiries.created_by — who made the row. Right for a Quick Add lead,
--     and wrong the moment a lead is re-enquired, because it still names
--     whoever first typed the number months ago.
--   * import_batches.uploaded_by, reached through
--     enquiry_sources.import_batch_id — right for an import, and the only
--     one of the three that survives a re-enquiry.
--   * the arrival somebody logged by hand — recorded nowhere. enquiry_sources
--     has no actor column and no audit trigger, so "who added this most
--     recently" was unanswerable for every source that did not come from a
--     file.
--
-- So the arrival records its own actor. One row per arrival already exists;
-- it just never said who caused it.
alter table public.enquiry_sources
  add column added_by uuid references public.profiles (id),
  /**
   * How it arrived, for the rows where a person is the wrong answer. A
   * Shopify checkout is credited to "Shopify" rather than to whoever happened
   * to upload the file: the uploader did not find that lead, the store did.
   */
  add column added_via text
    check (added_via in ('quick_add', 'import', 'shopify', 'call', 'offer', 'ticket'));

comment on column public.enquiry_sources.added_by is
  'The person who caused this arrival. Null where nobody did — a Shopify '
  'checkout is the store''s, not the uploader''s; see added_via.';

create index enquiry_sources_added_idx
  on public.enquiry_sources (enquiry_id, occurred_at desc);

-- §57.1. Backfill what is recoverable, and nothing more.
--
-- A checkout row is Shopify's whatever else is true of it, so it goes first
-- and the later statements leave it alone.
update public.enquiry_sources
   set added_via = 'shopify'
 where checkout_ref is not null and added_via is null;

-- An import row belongs to whoever uploaded the file.
update public.enquiry_sources es
   set added_via = 'import', added_by = b.uploaded_by
  from public.import_batches b
 where b.id = es.import_batch_id and es.added_via is null;

-- Everything else is somebody typing. Where it is the enquiry's first
-- arrival, created_by is that person by definition. Where it is a later one
-- it is genuinely unknown, and is left null rather than credited to the
-- person who created the row — that would be a guess printed as a fact.
update public.enquiry_sources es
   set added_via = 'quick_add', added_by = e.created_by
  from public.enquiries e
 where e.id = es.enquiry_id
   and es.added_via is null
   and es.occurred_at = (
     select min(x.occurred_at) from public.enquiry_sources x
      where x.enquiry_id = es.enquiry_id);

update public.enquiry_sources
   set added_via = 'quick_add'
 where added_via is null;

notify pgrst, 'reload schema';
