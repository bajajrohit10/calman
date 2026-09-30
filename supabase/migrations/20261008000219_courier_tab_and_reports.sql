-- §77.2. The Courier tab, and where it is counted.
--
-- `courier` needs no branch in tab_matches: the fallback already matches a tab
-- name to a status name, so 'courier' resolves like 'future' and 'escalated' do.
-- It is listed in tab_counts because that function names its tabs explicitly, and
-- in the reports because those name their buckets.

-- ---------------------------------------------------------------------------
-- 1. The counts gain the tab.
-- ---------------------------------------------------------------------------
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
-- §77.2. Seven status tabs now, and they still sum to All: every ticket has
-- exactly one status, Working excludes the counsellor's own and Counsellor is
-- only those.
select 'new',        count(*) filter (where support.tab_matches(c, 'new'))::integer        from cand c
union all
select 'working',    count(*) filter (where support.tab_matches(c, 'working'))::integer    from cand c
union all
select 'counsellor', count(*) filter (where support.tab_matches(c, 'counsellor'))::integer from cand c
union all
select 'escalated',  count(*) filter (where support.tab_matches(c, 'escalated'))::integer  from cand c
union all
select 'courier',    count(*) filter (where support.tab_matches(c, 'courier'))::integer    from cand c
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
-- 2. The reports' open-by-status line.
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
               ('escalated_team'), ('escalated_institute'),
               -- §77.2. Its own line, and deliberately not under either
               -- escalation: nobody was asked to act, we are waiting.
               ('courier'), ('future')) as b(bucket)
  left join open o
    on b.bucket = case
                    when o.status = 'escalated'
                      then 'escalated_' || coalesce(o.escalation_kind, 'team')
                    when support.tab_matches(o, 'counsellor') then 'counsellor'
                    when o.status = 'working' then 'working'
                    else o.status::text
                  end
 group by b.bucket;
$function$;

grant execute on function support.report_open_by_status(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
