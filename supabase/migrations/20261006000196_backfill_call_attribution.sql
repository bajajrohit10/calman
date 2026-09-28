-- §71. Recover what each historical call was made under, from the audit log.
--
-- Every call in the table predates calls.assignment_bucket (§70.1), so the
-- report infers their bucket from the assignment row as it stands *now*. That
-- row is mutable — the desk upserts on (enquiry_id, date) — so an evening
-- re-assignment rewrites the morning's attribution. On 28 Sept ten calls made
-- between 13:04 and 15:27 under follow_up and call_back assignments were
-- relabelled Customised by a 17:20 campaign batch, and the counsellors who made
-- them lost them from their follow-up count.
--
-- public.audit_log keeps every insert, update and delete on assignments with
-- the full row either side, so the state at any instant is recoverable. This
-- replays it once, per call.
--
-- The rules, and they are strict:
--
--   * The latest audit event for that enquiry's assignment on the call's own
--     date, at or before called_at. Not the latest event full stop: an
--     assignment for a different day says nothing about this call.
--   * A delete means there was no assignment at that moment — null, not the
--     bucket it had before it was deleted.
--   * No event at all means no state, and no state means null. Never a guess.
--     97 of the 98 such calls are the claim the call itself creates a
--     millisecond later, which the report resolves correctly on its own.
--   * assignment_id only where that row still exists; 7 replays name a row since
--     deleted, and those get the bucket alone.
--
-- Nothing already stamped is touched: the where clause requires
-- assignment_bucket is null, so re-running this is a no-op.
do $mig$
declare
  v_before_null integer;
  v_after_null  integer;
  v_bucket      integer;
  v_ids         integer;
begin
  select count(*) into v_before_null from public.calls where assignment_bucket is null;

  create temporary table _replay on commit drop as
  with a_norm as (
    select al.id, al.at, al.action::text as action, al.row_pk,
           (coalesce(al.new_data, al.old_data) ->> 'enquiry_id')::bigint    as enquiry_id,
           (coalesce(al.new_data, al.old_data) ->> 'date')::date            as a_date,
           coalesce(al.new_data, al.old_data) ->> 'bucket'                  as bucket,
           (coalesce(al.new_data, al.old_data) ->> 'counsellor_id')::uuid   as counsellor_id
      from public.audit_log al
     where al.table_name = 'assignments'
  )
  select c.id as call_id,
         case when r.action = 'delete' then null else r.bucket end as bucket,
         case when r.action = 'delete' then null else r.row_pk end as assignment_row
    from public.calls c
    left join lateral (
      select n.action, n.bucket, n.row_pk
        from a_norm n
       where n.enquiry_id = c.enquiry_id
         and n.a_date     = c.call_date
         and n.at        <= c.called_at
       order by n.at desc, n.id desc
       limit 1
    ) r on true
   where c.assignment_bucket is null;

  update public.calls c
     set assignment_bucket = p.bucket::public.assignment_bucket
    from _replay p
   where p.call_id = c.id
     and p.bucket is not null
     and c.assignment_bucket is null;
  get diagnostics v_bucket = row_count;

  -- Separately, and only where the row survives: assignment_id has a foreign key
  -- and a deleted row would fail the whole transaction rather than skip a call.
  update public.calls c
     set assignment_id = p.assignment_row::uuid
    from _replay p
   where p.call_id = c.id
     and p.assignment_row is not null
     and c.assignment_id is null
     and exists (select 1 from public.assignments a where a.id = p.assignment_row::uuid);
  get diagnostics v_ids = row_count;

  select count(*) into v_after_null from public.calls where assignment_bucket is null;

  raise notice '§71 backfill: assignment_bucket written on % calls, assignment_id on %; '
               'calls still unattributed % -> % (the claim each call creates, which the '
               'report resolves on its own)', v_bucket, v_ids, v_before_null, v_after_null;
end $mig$;
