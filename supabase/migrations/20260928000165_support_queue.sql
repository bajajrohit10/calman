-- §58.4. The queue, its counts, and the writes the ticket page makes.
--
-- The action panel is one form and therefore has to be one transaction: it
-- changes working fields, moves the status, records the action details as a
-- note, and stamps a called and a messaged event per ticked box. Five writes
-- that must all land or none — a status change with no note beside it is a
-- ticket nobody can account for — so it is a function, not five round trips
-- from the server action.

-- ---------------------------------------------------------------------------
-- Age, in calendar days, in IST.
-- ---------------------------------------------------------------------------
--
-- Calendar days and not 24-hour periods, because "raised on Monday, still open
-- Thursday" is what the team means by three days old, whatever o'clock it was.
create or replace function support.age_days(p_raised timestamptz)
returns integer
language sql
stable
set search_path to ''
as $$
  select greatest(0, app.ist_today() - (p_raised at time zone 'Asia/Kolkata')::date);
$$;

grant execute on function support.age_days(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The queue.
-- ---------------------------------------------------------------------------
create or replace function support.queue(
  p_tab            text    default 'open',
  p_statuses       text[]  default null,
  p_institute_id   uuid    default null,
  p_teacher_id     uuid    default null,
  p_issues         text[]  default null,
  p_follow_from    date    default null,
  p_follow_to      date    default null,
  p_assigned_to    text[]  default null,
  p_sources        text[]  default null,
  p_search         text    default null,
  p_limit          integer default 50,
  p_offset         integer default 0
)
returns table (
  id bigint, raised_at timestamptz, age_days integer,
  student_name text, mobile text, mobile_raw text,
  order_id text, order_id_raw text, order_id_work text,
  institute_name text, teacher_name text,
  issues_work text[], issue_other_work text,
  status support.ticket_status, follow_up_date date, overdue boolean,
  assigned_to_name text, assigned_to uuid,
  escalated_to_name text,
  last_touched_at timestamptz, source support.ticket_source,
  child_count integer,
  total_count bigint
)
language sql
stable
set search_path to ''
as $function$
with base as (
  select
    t.id, t.raised_at, support.age_days(t.raised_at) as age_days,
    t.student_name, t.mobile, t.mobile_raw,
    t.order_id, t.order_id_raw, t.order_id_work,
    i.name as institute_name, tc.name as teacher_name,
    t.issues_work, t.issue_other_work,
    t.status, t.follow_up_date,
    (t.follow_up_date is not null
       and t.follow_up_date < app.ist_today()
       and t.status <> 'resolved')                as overdue,
    ap.full_name as assigned_to_name, t.assigned_to,
    ep.full_name as escalated_to_name,
    t.last_touched_at, t.source,
    (select count(*)::integer from support.tickets c where c.parent_ticket_id = t.id)
      as child_count
  from support.tickets t
  left join public.institutes i on i.id = t.institute_id
  left join public.teachers   tc on tc.id = t.teacher_id
  left join public.profiles   ap on ap.id = t.assigned_to
  left join public.profiles   ep on ep.id = t.escalated_to
  -- A merged duplicate never stands in the queue on its own; it is read on the
  -- parent, where its events are.
  where t.parent_ticket_id is null
    and case coalesce(p_tab, 'open')
          when 'all'      then true
          when 'resolved' then t.status = 'resolved'
          when 'open'     then t.status <> 'resolved'
          else t.status::text = p_tab
        end
    and (p_statuses is null or cardinality(p_statuses) = 0
         or t.status::text = any (p_statuses))
    and (p_institute_id is null or t.institute_id = p_institute_id)
    and (p_teacher_id is null or t.teacher_id = p_teacher_id)
    and (p_issues is null or cardinality(p_issues) = 0
         or t.issues_work && p_issues)
    and (p_follow_from is null or t.follow_up_date >= p_follow_from)
    and (p_follow_to is null or t.follow_up_date <= p_follow_to)
    and (p_assigned_to is null or cardinality(p_assigned_to) = 0
         or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
         -- 'nobody' is a real answer to "assigned to whom", and a filter that
         -- could not express it would hide exactly the tickets that need
         -- picking up.
         or (t.assigned_to is null and 'nobody' = any (p_assigned_to)))
    and (p_sources is null or cardinality(p_sources) = 0
         or t.source::text = any (p_sources))
    and (
      p_search is null or btrim(p_search) = ''
      or t.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
      or t.mobile_raw ilike '%' || p_search || '%'
      or coalesce(t.order_id_work, t.order_id) ilike '%' || p_search || '%'
      or t.order_id_raw ilike '%' || p_search || '%'
      or t.student_name ilike '%' || p_search || '%'
    )
)
select b.*, count(*) over () as total_count
from base b
-- §58.4. Overdue first, then by the date they are due, then oldest raised.
-- Nulls last within the date: a ticket with no follow-up date is either new or
-- resolved, and neither is what the team works down this list for.
order by b.overdue desc,
         b.follow_up_date asc nulls last,
         b.raised_at asc,
         b.id asc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

grant execute on function support.queue(
  text, text[], uuid, uuid, text[], date, date, text[], text[], text, integer, integer
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tab counts.
-- ---------------------------------------------------------------------------
--
-- Every tab on every render, under the *other* filters, so choosing a tab
-- narrows the list without zeroing the numbers beside it — the same rule the
-- New Calls type tabs follow. 'all' counts everything including new, and
-- 'open' is everything unresolved.
create or replace function support.tab_counts(
  p_institute_id uuid    default null,
  p_teacher_id   uuid    default null,
  p_issues       text[]  default null,
  p_follow_from  date    default null,
  p_follow_to    date    default null,
  p_assigned_to  text[]  default null,
  p_sources      text[]  default null,
  p_search       text    default null
)
returns table (tab text, n integer)
language sql
stable
set search_path to ''
as $function$
with cand as (
  select q.status
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
           p_limit        => 1000000,
           p_offset       => 0
         ) q
)
select s.tab, count(c.status)::integer
  from (values ('new'), ('working'), ('escalated'), ('future'), ('resolved')) as s(tab)
  left join cand c on c.status::text = s.tab
 group by s.tab
union all
select 'open', count(*)::integer from cand c where c.status <> 'resolved'
union all
select 'all', count(*)::integer from cand;
$function$;

grant execute on function support.tab_counts(
  uuid, uuid, text[], date, date, text[], text[], text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Facets, with the _total guard.
-- ---------------------------------------------------------------------------
--
-- Same contract as every other facet function in this app: one row per option
-- with the count behind it, each dimension counted under every filter *except*
-- its own, plus a '_total' row the caller compares against the list's own total
-- and hides the whole bar when they disagree.
create or replace function support.queue_facets(
  p_tab          text    default 'open',
  p_institute_id uuid    default null,
  p_teacher_id   uuid    default null,
  p_issues       text[]  default null,
  p_follow_from  date    default null,
  p_follow_to    date    default null,
  p_assigned_to  text[]  default null,
  p_sources      text[]  default null,
  p_search       text    default null
)
returns table (facet text, value_id text, numbers integer, items integer)
language sql
stable
set search_path to ''
as $function$
with cand as materialized (
  select
    t.id, t.institute_id, t.teacher_id, t.issues_work, t.assigned_to, t.source,
    (p_institute_id is null or t.institute_id = p_institute_id) as m_institute,
    (p_teacher_id is null or t.teacher_id = p_teacher_id)       as m_teacher,
    (p_issues is null or cardinality(p_issues) = 0
       or t.issues_work && p_issues)                            as m_issue,
    (p_assigned_to is null or cardinality(p_assigned_to) = 0
       or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
       or (t.assigned_to is null and 'nobody' = any (p_assigned_to))) as m_assigned,
    (p_sources is null or cardinality(p_sources) = 0
       or t.source::text = any (p_sources))                     as m_source
  from support.tickets t
  where t.parent_ticket_id is null
    and case coalesce(p_tab, 'open')
          when 'all'      then true
          when 'resolved' then t.status = 'resolved'
          when 'open'     then t.status <> 'resolved'
          else t.status::text = p_tab
        end
    and (p_follow_from is null or t.follow_up_date >= p_follow_from)
    and (p_follow_to is null or t.follow_up_date <= p_follow_to)
    and (
      p_search is null or btrim(p_search) = ''
      or t.mobile like '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
      or t.mobile_raw ilike '%' || p_search || '%'
      or coalesce(t.order_id_work, t.order_id) ilike '%' || p_search || '%'
      or t.order_id_raw ilike '%' || p_search || '%'
      or t.student_name ilike '%' || p_search || '%'
    )
)
select 'institute', c.institute_id::text, count(*)::integer, 0
  from cand c
 where c.m_teacher and c.m_issue and c.m_assigned and c.m_source
   and c.institute_id is not null
 group by 2
union all
select 'teacher', c.teacher_id::text, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_issue and c.m_assigned and c.m_source
   and c.teacher_id is not null
 group by 2
union all
-- One ticket can carry several issues, so `numbers` counts tickets and `items`
-- counts the option's appearances — the same distinction the teacher facet on
-- New Calls makes between leads and interest lines.
select 'issue', x.issue, count(distinct c.id)::integer, count(*)::integer
  from cand c
  cross join lateral unnest(c.issues_work) as x(issue)
 where c.m_institute and c.m_teacher and c.m_assigned and c.m_source
 group by 2
union all
select 'assigned_to', coalesce(c.assigned_to::text, 'nobody'), count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_source
 group by 2
union all
select 'source', c.source::text, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned
 group by 2
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned and c.m_source;
$function$;

grant execute on function support.queue_facets(
  text, uuid, uuid, text[], date, date, text[], text[], text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §58.4. The action panel's single save.
-- ---------------------------------------------------------------------------
--
-- One form, one transaction. The outcome is required and so is the action note:
-- a status move with nothing said about it is the thing this module exists to
-- stop. The follow-up date is required for every outcome but 'resolved',
-- enforced here as well as by the table constraint, so the error names the
-- field instead of quoting a constraint at the user.
create or replace function support.save_ticket_action(
  p_ticket_id        bigint,
  p_issues           text[],
  p_issue_other      text,
  p_institute_id     uuid,
  p_teacher_id       uuid,
  p_order_id_work    text,
  p_details          text,
  p_outcome          support.ticket_status,
  p_follow_up_date   date,
  p_escalated_to     uuid,
  p_called           boolean default false,
  p_messaged         boolean default false,
  p_message_channel  text    default 'whatsapp'
)
returns bigint
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  t            support.tickets%rowtype;
  v_actor      uuid := (select auth.uid());
  v_now        timestamptz := now();
  v_details    text := btrim(coalesce(p_details, ''));
  v_issues     text[] := coalesce(p_issues, '{}'::text[]);
  v_other      text := nullif(btrim(coalesce(p_issue_other, '')), '');
  v_order      text := nullif(btrim(coalesce(p_order_id_work, '')), '');
begin
  if not app.is_support() then raise exception 'not permitted'; end if;

  select * into t from support.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket % does not exist', p_ticket_id; end if;
  if t.parent_ticket_id is not null then
    raise exception 'ticket % is merged into %; work the parent',
      p_ticket_id, t.parent_ticket_id;
  end if;

  if v_details = '' then
    raise exception 'Say what was done — the action details are required.';
  end if;
  if p_outcome is null then
    raise exception 'Pick an outcome.';
  end if;
  if p_outcome <> 'resolved' and p_follow_up_date is null then
    raise exception 'A follow-up date is required unless the ticket is resolved.';
  end if;
  if p_outcome = 'escalated' and p_escalated_to is null then
    raise exception 'Say who this ticket is escalated to.';
  end if;
  if not (v_issues <@ support.issue_options()) then
    raise exception 'Unknown issue option.';
  end if;

  -- ---- field changes, one event each, only where something moved.
  if v_order is distinct from t.order_id_work then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'order_id_work',
                               'old', t.order_id_work, 'new', v_order));
  end if;

  if p_institute_id is distinct from t.institute_id then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'institute_id',
                               'old', t.institute_id, 'new', p_institute_id));
  end if;

  if p_teacher_id is distinct from t.teacher_id then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'teacher_id',
                               'old', t.teacher_id, 'new', p_teacher_id));
  end if;

  -- Order-insensitive comparison: the checkbox order on screen is not a change.
  if not (v_issues <@ t.issues_work and t.issues_work <@ v_issues) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'issues_work',
                               'old', to_jsonb(t.issues_work), 'new', to_jsonb(v_issues)));
  end if;

  if v_other is distinct from t.issue_other_work then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'field_change',
            jsonb_build_object('field', 'issue_other_work',
                               'old', t.issue_other_work, 'new', v_other));
  end if;

  -- ---- the status move.
  if p_outcome is distinct from t.status
     or p_follow_up_date is distinct from t.follow_up_date
     or p_escalated_to is distinct from t.escalated_to then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor,
            case when p_outcome = 'resolved' and t.status <> 'resolved' then 'resolved'
                 when t.status = 'resolved' and p_outcome <> 'resolved' then 'reopened'
                 else 'status_change' end,
            jsonb_build_object('old', t.status, 'new', p_outcome,
                               'follow_up_date', p_follow_up_date,
                               'escalated_to', p_escalated_to));
  end if;

  -- ---- the note carrying the action details. Always written: it is the
  -- ---- reason the save is one form rather than a status dropdown.
  insert into support.events (ticket_id, actor_id, kind, detail)
  values (p_ticket_id, v_actor, 'note', jsonb_build_object('text', v_details));

  -- ---- one event per ticked box.
  if coalesce(p_called, false) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'called',
            jsonb_build_object('picked', true, 'note', v_details, 'via', 'action panel'));
  end if;

  if coalesce(p_messaged, false) then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor, 'messaged',
            jsonb_build_object('channel', coalesce(nullif(p_message_channel, ''), 'whatsapp'),
                               'note', v_details, 'via', 'action panel'));
  end if;

  -- ---- and the row itself.
  update support.tickets
     set order_id_work    = v_order,
         institute_id     = p_institute_id,
         teacher_id       = p_teacher_id,
         issues_work      = v_issues,
         issue_other_work = v_other,
         status           = p_outcome,
         follow_up_date   = case when p_outcome = 'resolved' then null
                                 else p_follow_up_date end,
         escalated_to     = case when p_outcome = 'escalated' then p_escalated_to
                                 else escalated_to end,
         resolved_at      = case when p_outcome = 'resolved' then coalesce(resolved_at, v_now)
                                 else null end,
         resolved_by      = case when p_outcome = 'resolved' then coalesce(resolved_by, v_actor)
                                 else null end,
         last_touched_at  = v_now
   where id = p_ticket_id;

  return p_ticket_id;
end $fn$;

grant execute on function support.save_ticket_action(
  bigint, text[], text, uuid, uuid, text, text, support.ticket_status, date, uuid,
  boolean, boolean, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §58.4. A touch with no outcome change: Log call, Log message, Add note.
-- ---------------------------------------------------------------------------
create or replace function support.log_ticket_touch(
  p_ticket_id bigint,
  p_kind      support.event_kind,
  p_note      text,
  p_picked    boolean default null,
  p_channel   text    default null
)
returns bigint
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_id    bigint;
begin
  if not app.is_support() then raise exception 'not permitted'; end if;
  if p_kind not in ('called', 'messaged', 'note') then
    raise exception 'log_ticket_touch handles called, messaged and note only';
  end if;
  if p_kind = 'note' and v_note is null then
    raise exception 'A note needs something in it.';
  end if;
  if p_kind = 'called' and p_picked is null then
    raise exception 'Say whether the call was picked up.';
  end if;

  if not exists (select 1 from support.tickets where id = p_ticket_id) then
    raise exception 'ticket % does not exist', p_ticket_id;
  end if;

  insert into support.events (ticket_id, actor_id, kind, detail)
  values (
    p_ticket_id, v_actor, p_kind,
    case p_kind
      when 'called'   then jsonb_build_object('picked', p_picked, 'note', v_note)
      when 'messaged' then jsonb_build_object(
                             'channel', coalesce(nullif(p_channel, ''), 'whatsapp'),
                             'note', v_note)
      else jsonb_build_object('text', v_note)
    end
  )
  returning id into v_id;

  -- A touch is work on the ticket, so it moves last_touched_at — but it never
  -- touches status or the follow-up date, which is the whole point of having
  -- these buttons beside the action panel rather than inside it.
  update support.tickets set last_touched_at = now() where id = p_ticket_id;
  return v_id;
end $fn$;

grant execute on function support.log_ticket_touch(
  bigint, support.event_kind, text, boolean, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §58.4. Merge, by hand.
-- ---------------------------------------------------------------------------
create or replace function support.merge_ticket(
  p_child_id  bigint,
  p_parent_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  c support.tickets%rowtype;
  p support.tickets%rowtype;
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
begin
  if not app.is_support() then raise exception 'not permitted'; end if;
  if p_child_id = p_parent_id then raise exception 'A ticket cannot merge into itself.'; end if;

  select * into c from support.tickets where id = p_child_id for update;
  if not found then raise exception 'ticket % does not exist', p_child_id; end if;
  select * into p from support.tickets where id = p_parent_id for update;
  if not found then raise exception 'ticket % does not exist', p_parent_id; end if;

  if c.parent_ticket_id is not null then
    raise exception 'Ticket % is already merged into %.', p_child_id, c.parent_ticket_id;
  end if;
  if p.parent_ticket_id is not null then
    raise exception 'Ticket % is itself a duplicate of %; merge into that one instead.',
      p_parent_id, p.parent_ticket_id;
  end if;
  -- A child copies the parent's status, and a resolved parent would hand the
  -- child a 'resolved' with no resolved_at of its own. Refused rather than
  -- papered over: merging into a closed ticket is nearly always the wrong
  -- target, and the team can reopen it first if it really is the right one.
  if p.status = 'resolved' then
    raise exception 'Ticket % is resolved. Reopen it before merging into it.', p_parent_id;
  end if;
  if exists (select 1 from support.tickets x where x.parent_ticket_id = p_child_id) then
    raise exception 'Ticket % has duplicates of its own; merge those first.', p_child_id;
  end if;

  update support.tickets
     set parent_ticket_id = p_parent_id,
         merged_at        = v_now,
         status           = p.status,
         follow_up_date   = p.follow_up_date,
         escalated_to     = p.escalated_to,
         resolved_at      = null,
         resolved_by      = null,
         last_touched_at  = v_now
   where id = p_child_id;

  insert into support.events (ticket_id, actor_id, kind, detail) values
    (p_child_id,  v_actor, 'merged_into',  jsonb_build_object('ticket_id', p_parent_id, 'automatic', false)),
    (p_parent_id, v_actor, 'child_merged', jsonb_build_object('ticket_id', p_child_id,  'automatic', false));

  update support.tickets set last_touched_at = v_now where id = p_parent_id;
  return p_parent_id;
end $fn$;

grant execute on function support.merge_ticket(bigint, bigint)
  to authenticated, service_role;

notify pgrst, 'reload schema';
