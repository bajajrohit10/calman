-- §73. The Counsellor tab means "still with the counsellor who raised it".
--
-- It meant "came from counselling and is being worked", which is a fact about
-- where a ticket started rather than about whose desk it is on now. The moment
-- the support team picked one up and carried on working it, it stayed on the
-- counsellor's tab — counted against a queue they could do nothing about, and
-- exempt from the Issue rule (§72.2) that the team's own queue depends on.
--
-- assigned_to = raised_by is the whole of it. A hand-over clears assigned_to
-- (§65.3), so a handed-over ticket can never re-qualify; the team taking one
-- puts their own id there; and a ticket nobody owns is nobody's tab, which is
-- what New and Working are for.

-- ---------------------------------------------------------------------------
-- 1. The rule, in the one place that states it.
-- ---------------------------------------------------------------------------
create or replace function support.tab_matches(t support.tickets, p_tab text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select case coalesce(p_tab, 'open')
           when 'all'        then true
           when 'resolved'   then t.status = 'resolved'
           when 'open'       then t.status <> 'resolved'
           -- §73. Counselling's own work in progress, still on the desk it
           -- started on. raised_by is tested for null explicitly: a form ticket
           -- has no raiser and no owner, and `null = null` must not read as
           -- "still theirs".
           when 'counsellor' then t.status = 'working'
                              and t.source = 'counselling'
                              and t.raised_by is not null
                              and t.assigned_to = t.raised_by
           -- …which the ticket team's Working tab therefore excludes, and only
           -- that. A counselling ticket the team has taken is Working like any
           -- other, which is exactly what it is.
           when 'working'    then t.status = 'working'
                              and not (t.source = 'counselling'
                                       and t.raised_by is not null
                                       and t.assigned_to = t.raised_by)
           else t.status::text = p_tab
         end;
$$;

grant execute on function support.tab_matches(support.tickets, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The counts ask the rule rather than restating it.
-- ---------------------------------------------------------------------------
--
-- This used to re-derive the split from status and source, which is how the tab
-- and its own count came to disagree in §64.2. support.queue does not return
-- raised_by and does not need to: the ids come back from the queue under all the
-- filters, and the classification is asked of the row.
create or replace function support.tab_counts(
  p_institute_id uuid    default null,
  p_teacher_id   uuid    default null,
  p_issues       text[]  default null,
  p_follow_from  date    default null,
  p_follow_to    date    default null,
  p_assigned_to  text[]  default null,
  p_sources      text[]  default null,
  p_search       text    default null,
  p_raised_from  date    default null,
  p_raised_to    date    default null
)
returns table (tab text, n integer)
language sql
stable
set search_path to ''
as $function$
with cand as (
  select t.*
    from support.queue(
           p_tab => 'all',
           p_institute_id => p_institute_id,
           p_teacher_id   => p_teacher_id,
           p_issues       => p_issues,
           p_follow_from  => p_follow_from,
           p_follow_to    => p_follow_to,
           p_assigned_to  => p_assigned_to,
           p_sources      => p_sources,
           p_search       => p_search,
           p_raised_from  => p_raised_from,
           p_raised_to    => p_raised_to,
           p_limit        => 1000000,
           p_offset       => 0
         ) q
    join support.tickets t on t.id = q.id
)
-- Working excludes the counsellor's own, and Counsellor is only those, so the
-- six status tabs still sum to All exactly.
select 'new',        count(*) filter (where support.tab_matches(c, 'new'))::integer        from cand c
union all
select 'working',    count(*) filter (where support.tab_matches(c, 'working'))::integer    from cand c
union all
select 'counsellor', count(*) filter (where support.tab_matches(c, 'counsellor'))::integer from cand c
union all
select 'escalated',  count(*) filter (where support.tab_matches(c, 'escalated'))::integer  from cand c
union all
select 'future',     count(*) filter (where support.tab_matches(c, 'future'))::integer     from cand c
union all
select 'resolved',   count(*) filter (where support.tab_matches(c, 'resolved'))::integer   from cand c
union all
select 'open',       count(*) filter (where support.tab_matches(c, 'open'))::integer       from cand c
union all
select 'all',        count(*)::integer from cand;
$function$;

grant execute on function support.tab_counts(
  uuid, uuid, text[], date, date, text[], text[], text, date, date
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The reports' status buckets, from the same rule.
-- ---------------------------------------------------------------------------
create or replace function support.report_open_by_status(
  p_from         date default null,
  p_to           date default null,
  p_institute_id uuid default null,
  p_teacher_id   uuid default null,
  p_assigned_to  text[] default null
)
returns table (bucket text, n integer)
language sql
stable
set search_path to ''
as $function$
with open as (
  select t.*
    from support.tickets t
   where t.parent_ticket_id is null
     and t.status <> 'resolved'
     and support.in_report_scope(t, p_from, p_to, p_institute_id, p_teacher_id, p_assigned_to)
)
select b.bucket, count(o.status)::integer
  from (values ('new'), ('working'), ('counsellor'),
               ('escalated_team'), ('escalated_institute'), ('future')) as b(bucket)
  left join open o
    on b.bucket = case
                    when o.status = 'escalated'
                      then 'escalated_' || coalesce(o.escalation_kind, 'team')
                    -- §73. The same test the tab uses, so the card and the list
                    -- it links to cannot disagree about a number.
                    when support.tab_matches(o, 'counsellor') then 'counsellor'
                    when o.status = 'working' then 'working'
                    else o.status::text
                  end
 group by b.bucket;
$function$;

grant execute on function support.report_open_by_status(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
