-- Brief 35.3: what changed on a call, and who changed it.
--
-- The audit trigger has recorded every edit since the first migration, but
-- audit_log is admin-only — and the person who most needs to see that a note
-- was rewritten is the counsellor reading the note. So this exposes exactly
-- one slice of it: the updates to one call, in the words the history table
-- shows, and nothing else.
--
-- Security definer with a staff guard, the same shape call_report uses for the
-- same reason. It returns no old/new blobs, only the fields that changed and
-- their before and after, so nothing can be read out of it that the history
-- table does not already show.
create or replace function public.call_edits(p_call_id bigint)
returns table (
  changed_at timestamptz,
  actor_name text,
  field text,
  old_value text,
  new_value text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    a.at,
    coalesce(pr.full_name, '(unknown)'),
    f.field,
    a.old_data ->> f.field,
    a.new_data ->> f.field
  from public.audit_log a
  cross join lateral unnest(coalesce(a.changed_fields, '{}'::text[])) as f(field)
  left join public.profiles pr on pr.id = a.actor_id
  where app.is_staff()
    and a.table_name = 'calls'
    and a.action = 'update'
    and a.row_pk = p_call_id::text
    -- row_pk is not unique over the life of the database, so the enquiry is
    -- checked too: an id reused after a purge would otherwise drag a stranger's
    -- edits into this call's history.
    and a.new_data ->> 'enquiry_id' = (
      select c.enquiry_id::text from public.calls c where c.id = p_call_id
    )
    -- Only the fields a person can change from the call window. The trigger
    -- records every column that moved, and the recompute's own churn is not
    -- an edit anybody made.
    and f.field in (
      'outcome', 'discussion', 'next_follow_up_date',
      'importance', 'lead_verification', 'issue_category'
    )
  order by
    -- Brief 35.3 asks for outcome changes first: it is the field that moves the
    -- lead, and the rest are detail about the same edit.
    (f.field <> 'outcome'), a.at desc;
$function$;

comment on function public.call_edits is
  'Brief 35.3. The edit history of one call — field, before, after, who and '
  'when — for the Edits column on the student history. Staff may read it; the '
  'audit log itself stays admin-only.';

revoke all on function public.call_edits from public;
grant execute on function public.call_edits to authenticated;

-- Which calls have been edited at all, for one student, in one round trip.
-- The history table needs the marker on every row and the detail on none of
-- them until somebody asks, so the two are separate questions.
create or replace function public.calls_edited(p_call_ids bigint[])
returns table (call_id bigint, edits integer)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.id, count(distinct a.id)::integer
    from public.calls c
    join public.audit_log a
      on a.table_name = 'calls'
     and a.action = 'update'
     and a.row_pk = c.id::text
     and a.new_data ->> 'enquiry_id' = c.enquiry_id::text
     and coalesce(a.changed_fields, '{}'::text[]) && array[
       'outcome', 'discussion', 'next_follow_up_date',
       'importance', 'lead_verification', 'issue_category'
     ]
   where app.is_staff()
     and c.id = any (coalesce(p_call_ids, '{}'::bigint[]))
   group by c.id;
$function$;

comment on function public.calls_edited is
  'Brief 35.3. How many edits each of these calls has had, so the history can '
  'show the marker without asking for every call''s history up front.';

revoke all on function public.calls_edited from public;
grant execute on function public.calls_edited to authenticated;
