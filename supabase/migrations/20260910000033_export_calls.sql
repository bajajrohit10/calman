-- §9: every call belonging to a set of enquiries, flattened one row per call.
--
-- The archive export is the only copy of this data once the batch is purged,
-- and the 29-column enquiry sheet carries just the *last* call. So the archive
-- workbook gets a second sheet with the whole call history, one row each.
--
-- Id-driven like export_enquiries, and deliberately not filtered on
-- archived_at: re-exporting a batch means exporting archived rows.

create or replace function public.export_calls(p_ids bigint[])
returns table (
  enquiry_id bigint,
  mobile text,
  student_name text,
  call_date date,
  called_at timestamptz,
  called_by_name text,
  outcome public.call_outcome,
  discussion text,
  next_follow_up_date date,
  order_id text,
  issue_category public.issue_category
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.enquiry_id,
    s.mobile,
    s.name,
    c.call_date,
    c.called_at,
    pr.full_name,
    c.outcome,
    c.discussion,
    c.next_follow_up_date,
    c.order_id,
    c.issue_category
  from public.calls c
  join public.enquiries e on e.id = c.enquiry_id
  join public.students s on s.id = e.student_id
  left join public.profiles pr on pr.id = c.called_by
  where c.enquiry_id = any (p_ids)
  order by c.enquiry_id, c.call_date, c.called_at, c.id;
$$;

comment on function public.export_calls is
  '§9: the full call history for a set of enquiries, one row per call, for the '
  'second sheet of the archive export.';

revoke all on function public.export_calls from public;
grant execute on function public.export_calls to authenticated;
