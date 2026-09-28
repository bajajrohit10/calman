-- §64.3, §64.2, §64.1. The merge bug, the Counsellor tab, and the institute fill.

-- ---------------------------------------------------------------------------
-- 1. §64.3. merge_ticket must carry the institute, not just the kind.
-- ---------------------------------------------------------------------------
--
-- Reproduced exactly:
--
--   new row for relation "tickets" violates check constraint
--   "tickets_institute_escalation_has_institute"
--
-- A child copies the parent's status and escalation_kind (Brief 62 taught it the
-- kind, because without it the child had a status of 'escalated' and no kind at
-- all). What that fix missed is that 'institute' *requires* an institute_id —
-- the Brief 61 constraint — so merging a child whose faculty text matched
-- nothing into a parent sitting with an institute always failed. On the ticket
-- page that surfaced as an error on the first Merge click.
--
-- coalesce, not assignment: the child keeps its own institute where it has one,
-- and inherits the parent's where it does not. They are the same complaint about
-- the same order, so the parent's answer is the right default.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'support' and p.proname = 'merge_ticket';

  patched := replace(src,
$old$         escalation_kind  = p.escalation_kind,
         escalated_to     = p.escalated_to,$old$,
$new$         escalation_kind  = p.escalation_kind,
         escalated_to     = p.escalated_to,
         -- §64.3. The institute the kind needs. Without this a merge into an
         -- institute-escalated parent broke the check constraint.
         institute_id     = coalesce(c.institute_id, p.institute_id),$new$);

  if patched = src then raise exception 'merge_ticket: the copy block was not matched'; end if;
  execute patched;
end $mig$;

-- ---------------------------------------------------------------------------
-- 2. §64.1. An institute follows from its teacher.
-- ---------------------------------------------------------------------------
--
-- The masters already say which house a teacher sells through, so a ticket that
-- names a teacher and no institute is carrying an answer it could have worked
-- out. One function, used by intake, by the counselling hand-off and by the
-- backfill below, so the three cannot disagree.
create or replace function support.institute_of_teacher(p_teacher_id uuid)
returns uuid
language sql
stable
set search_path to ''
as $$
  select t.institute_id from public.teachers t where t.id = p_teacher_id;
$$;

grant execute on function support.institute_of_teacher(uuid)
  to authenticated, service_role;

-- The one-off fill. Derived data only: it writes institute_id where it is null
-- and a teacher is already named, and touches nothing a person typed.
update support.tickets t
   set institute_id = support.institute_of_teacher(t.teacher_id)
 where t.teacher_id is not null
   and t.institute_id is null
   and support.institute_of_teacher(t.teacher_id) is not null;

-- ---------------------------------------------------------------------------
-- 3. §64.2. The Counsellor tab.
-- ---------------------------------------------------------------------------
--
-- Tickets a counsellor raised and is still working are a different queue from
-- the ticket team's own work in progress: the team should not be picking them up
-- and the counsellor should not lose them among sixty form tickets. So
-- `counsellor` is its own tab, and `working` stops including them — otherwise the
-- two tabs would double-count and no total would reconcile.
--
-- One function decides which tab a ticket belongs to, called from the list, the
-- counts and the facets. The rule lived in three copies of the same CASE before
-- this, which is how a tab starts meaning different things on the same screen.
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
           -- §64.2. Counselling's own work in progress, and only that.
           when 'counsellor' then t.status = 'working' and t.source = 'counselling'
           -- …which the ticket team's Working tab therefore excludes.
           when 'working'    then t.status = 'working' and t.source <> 'counselling'
           else t.status::text = p_tab
         end;
$$;

grant execute on function support.tab_matches(support.tickets, text)
  to authenticated, service_role;

-- The list, the counts and the facets all defer to it.
do $mig$
declare
  fn      text;
  src     text;
  patched text;
  target  text := $t$    and case coalesce(p_tab, 'open')
          when 'all'      then true
          when 'resolved' then t.status = 'resolved'
          when 'open'     then t.status <> 'resolved'
          else t.status::text = p_tab
        end$t$;
begin
  foreach fn in array array['queue', 'queue_facets'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'support' and p.proname = fn;

    patched := replace(src, target, '    and support.tab_matches(t, p_tab)');
    if patched = src then
      raise exception 'support.%: the tab CASE was not matched', fn;
    end if;
    execute patched;
  end loop;
end $mig$;

-- ---------------------------------------------------------------------------
-- 4. §64.2. The tab counts gain Counsellor.
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
  select q.status, q.source
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
)
-- Working excludes counselling and Counsellor is only counselling, so the six
-- status tabs still sum to All exactly as they did.
select 'new', count(*)::integer from cand c where c.status = 'new'
union all
select 'working', count(*)::integer from cand c
 where c.status = 'working' and c.source <> 'counselling'
union all
select 'counsellor', count(*)::integer from cand c
 where c.status = 'working' and c.source = 'counselling'
union all
select 'escalated', count(*)::integer from cand c where c.status = 'escalated'
union all
select 'future', count(*)::integer from cand c where c.status = 'future'
union all
select 'resolved', count(*)::integer from cand c where c.status = 'resolved'
union all
select 'open', count(*)::integer from cand c where c.status <> 'resolved'
union all
select 'all', count(*)::integer from cand;
$function$;

grant execute on function support.tab_counts(
  uuid, uuid, text[], date, date, text[], text[], text, date, date
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. §64.2. The reports' status breakdown gains its own line.
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
  select t.status, t.escalation_kind, t.source
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
                    -- §64.2. Same split as the queue, so the report and the tab
                    -- it links to cannot disagree about a number.
                    when o.status = 'working' and o.source = 'counselling'
                      then 'counsellor'
                    when o.status = 'working' then 'working'
                    else o.status::text
                  end
 group by b.bucket;
$function$;

grant execute on function support.report_open_by_status(
  date, date, uuid, uuid, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
