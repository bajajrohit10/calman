-- §61.2. Two kinds of escalation.
--
-- "Escalated" answered one question — is somebody senior on this — and the team
-- needs it to answer two: is a colleague holding it, or is it sitting with the
-- institute waiting for them to act. Those are different waits with different
-- chasing, and rolling them into one status hides the second entirely.
--
-- The kind is its own column rather than an inference from escalated_to being
-- null. Overloading that column would make the *absence* of data carry the
-- meaning, which means dropping tickets_escalatee_required — and then nothing at
-- the table level stops a genuinely half-finished team escalation. It also
-- leaves no room for a third kind and makes "who holds this ticket" a question
-- you can only answer if you already know the convention.
--
-- text with a check rather than an enum, unlike this schema's other
-- vocabularies: a third kind here is a plausible near-term change, and a check
-- constraint is editable in one statement where an enum is not.
alter table support.tickets
  add column escalation_kind text
    check (escalation_kind in ('team', 'institute'));

comment on column support.tickets.escalation_kind is
  '§61.2. Which kind of escalation, set exactly when status = escalated. '
  '''team'' names a colleague in escalated_to; ''institute'' means it is with '
  'the institute in institute_id and escalated_to does not apply.';

-- Existing escalated tickets are team escalations by definition: the old
-- constraint made an escalatee mandatory, so every one of them names a person.
-- Zero rows on the live database at the time of writing — 47 new and 1 working —
-- but written so it stays correct for anything that lands between now and the
-- migration running.
update support.tickets
   set escalation_kind = 'team'
 where status = 'escalated' and escalation_kind is null;

-- The old rule said "escalated implies a person". Now it says "escalated
-- implies a kind", and the kind says what else is required. Both halves are
-- enforced here as well as in save_ticket_action, because the function is not
-- the only thing that can write this table.
alter table support.tickets drop constraint tickets_escalatee_required;

alter table support.tickets
  add constraint tickets_escalation_kind_set check (
    (status = 'escalated') = (escalation_kind is not null)
  ),
  add constraint tickets_team_escalation_has_person check (
    escalation_kind is distinct from 'team' or escalated_to is not null
  ),
  -- An institute escalation is a claim about a specific institute, so the
  -- ticket has to name one. This also stops the institute being cleared while
  -- the ticket is still sitting with them.
  add constraint tickets_institute_escalation_has_institute check (
    escalation_kind is distinct from 'institute' or institute_id is not null
  );

create index tickets_escalation_kind_idx on support.tickets (escalation_kind)
  where escalation_kind is not null;

-- ---------------------------------------------------------------------------
-- The queue carries the kind, and can be filtered by it.
-- ---------------------------------------------------------------------------
drop function if exists support.queue(
  text, text[], uuid, uuid, text[], date, date, text[], text[], text, integer, integer);

create function support.queue(
  p_tab             text    default 'open',
  p_statuses        text[]  default null,
  p_institute_id    uuid    default null,
  p_teacher_id      uuid    default null,
  p_issues          text[]  default null,
  p_follow_from     date    default null,
  p_follow_to       date    default null,
  p_assigned_to     text[]  default null,
  p_sources         text[]  default null,
  p_search          text    default null,
  p_limit           integer default 50,
  p_offset          integer default 0,
  /** §61.2: 'team' and/or 'institute'; only meaningful on the Escalated tab. */
  p_escalation_kinds text[] default null,
  /** §61.3: raised-date window, for the reports' click-through. */
  p_raised_from     date    default null,
  p_raised_to       date    default null
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
  escalation_kind text, escalated_label text,
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
    t.escalation_kind,
    -- §61.2. Who the ticket is with, in one column, so the row does not have to
    -- branch on the kind to print an arrow.
    case t.escalation_kind
      when 'team'      then ep.full_name
      when 'institute' then i.name
    end                                           as escalated_label,
    t.last_touched_at, t.source,
    (select count(*)::integer from support.tickets c where c.parent_ticket_id = t.id)
      as child_count
  from support.tickets t
  left join public.institutes i on i.id = t.institute_id
  left join public.teachers   tc on tc.id = t.teacher_id
  left join public.profiles   ap on ap.id = t.assigned_to
  left join public.profiles   ep on ep.id = t.escalated_to
  where t.parent_ticket_id is null
    and case coalesce(p_tab, 'open')
          when 'all'      then true
          when 'resolved' then t.status = 'resolved'
          when 'open'     then t.status <> 'resolved'
          else t.status::text = p_tab
        end
    and (p_statuses is null or cardinality(p_statuses) = 0
         or t.status::text = any (p_statuses))
    and (p_escalation_kinds is null or cardinality(p_escalation_kinds) = 0
         or t.escalation_kind = any (p_escalation_kinds))
    and (p_institute_id is null or t.institute_id = p_institute_id)
    and (p_teacher_id is null or t.teacher_id = p_teacher_id)
    and (p_issues is null or cardinality(p_issues) = 0
         or t.issues_work && p_issues)
    and (p_follow_from is null or t.follow_up_date >= p_follow_from)
    and (p_follow_to is null or t.follow_up_date <= p_follow_to)
    -- §61.3. Raised, in IST calendar days — the form's timestamp, not when the
    -- webhook happened to deliver it.
    and (p_raised_from is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date >= p_raised_from)
    and (p_raised_to is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date <= p_raised_to)
    and (p_assigned_to is null or cardinality(p_assigned_to) = 0
         or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
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
order by b.overdue desc,
         b.follow_up_date asc nulls last,
         b.raised_at asc,
         b.id asc
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$function$;

grant execute on function support.queue(
  text, text[], uuid, uuid, text[], date, date, text[], text[], text, integer,
  integer, text[], date, date
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tab counts. The escalation chip is deliberately NOT passed through: it only
-- exists on the Escalated tab, and narrowing every count by it would zero the
-- New tab the moment somebody picked Institute. Same reasoning as the New Calls
-- type tabs. The raised window IS passed, because the reports link through with
-- one and the counts must then describe that window.
-- ---------------------------------------------------------------------------
drop function if exists support.tab_counts(
  uuid, uuid, text[], date, date, text[], text[], text);

create function support.tab_counts(
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
           p_raised_from  => p_raised_from,
           p_raised_to    => p_raised_to,
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
  uuid, uuid, text[], date, date, text[], text[], text, date, date
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Facets gain the same two parameters, so the _total guard keeps agreeing with
-- the list once a chip or a raised window is in play.
-- ---------------------------------------------------------------------------
drop function if exists support.queue_facets(
  text, uuid, uuid, text[], date, date, text[], text[], text);

create function support.queue_facets(
  p_tab             text    default 'open',
  p_institute_id    uuid    default null,
  p_teacher_id      uuid    default null,
  p_issues          text[]  default null,
  p_follow_from     date    default null,
  p_follow_to       date    default null,
  p_assigned_to     text[]  default null,
  p_sources         text[]  default null,
  p_search          text    default null,
  p_escalation_kinds text[] default null,
  p_raised_from     date    default null,
  p_raised_to       date    default null
)
returns table (facet text, value_id text, numbers integer, items integer)
language sql
stable
set search_path to ''
as $function$
with cand as materialized (
  select
    t.id, t.institute_id, t.teacher_id, t.issues_work, t.assigned_to, t.source,
    t.escalation_kind,
    (p_institute_id is null or t.institute_id = p_institute_id) as m_institute,
    (p_teacher_id is null or t.teacher_id = p_teacher_id)       as m_teacher,
    (p_issues is null or cardinality(p_issues) = 0
       or t.issues_work && p_issues)                            as m_issue,
    (p_assigned_to is null or cardinality(p_assigned_to) = 0
       or (t.assigned_to is not null and t.assigned_to::text = any (p_assigned_to))
       or (t.assigned_to is null and 'nobody' = any (p_assigned_to))) as m_assigned,
    (p_sources is null or cardinality(p_sources) = 0
       or t.source::text = any (p_sources))                     as m_source,
    (p_escalation_kinds is null or cardinality(p_escalation_kinds) = 0
       or t.escalation_kind = any (p_escalation_kinds))          as m_kind
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
    and (p_raised_from is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date >= p_raised_from)
    and (p_raised_to is null
         or (t.raised_at at time zone 'Asia/Kolkata')::date <= p_raised_to)
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
 where c.m_teacher and c.m_issue and c.m_assigned and c.m_source and c.m_kind
   and c.institute_id is not null
 group by 2
union all
select 'teacher', c.teacher_id::text, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_issue and c.m_assigned and c.m_source and c.m_kind
   and c.teacher_id is not null
 group by 2
union all
select 'issue', x.issue, count(distinct c.id)::integer, count(*)::integer
  from cand c
  cross join lateral unnest(c.issues_work) as x(issue)
 where c.m_institute and c.m_teacher and c.m_assigned and c.m_source and c.m_kind
 group by 2
union all
select 'assigned_to', coalesce(c.assigned_to::text, 'nobody'), count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_source and c.m_kind
 group by 2
union all
select 'source', c.source::text, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned and c.m_kind
 group by 2
union all
select 'escalation_kind', c.escalation_kind, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned and c.m_source
   and c.escalation_kind is not null
 group by 2
union all
select '_total', null, count(*)::integer, 0
  from cand c
 where c.m_institute and c.m_teacher and c.m_issue and c.m_assigned and c.m_source
   and c.m_kind;
$function$;

grant execute on function support.queue_facets(
  text, uuid, uuid, text[], date, date, text[], text[], text, text[], date, date
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §61.2. The save learns the kind.
-- ---------------------------------------------------------------------------
--
-- The signature gains p_escalation_kind, so the function is dropped rather than
-- replaced — CREATE OR REPLACE with a new parameter makes an ambiguous overload
-- rather than an updated function.
drop function if exists support.save_ticket_action(
  bigint, text[], text, uuid, uuid, text, text, support.ticket_status, date, uuid,
  boolean, boolean, text);

create function support.save_ticket_action(
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
  p_message_channel  text    default 'whatsapp',
  /** §61.2: required when the outcome is escalated, ignored otherwise. */
  p_escalation_kind  text    default null
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
  -- The kind only exists while the ticket is escalated. Anything else clears
  -- it, so a ticket moved from escalated to working does not keep claiming to
  -- be with the institute.
  v_kind       text := case when p_outcome = 'escalated' then p_escalation_kind end;
  v_person     uuid;
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

  if p_outcome = 'escalated' then
    if v_kind is null or v_kind not in ('team', 'institute') then
      raise exception 'Say whether this is escalated to a team member or to the institute.';
    end if;
    if v_kind = 'team' and p_escalated_to is null then
      raise exception 'Say who this ticket is escalated to.';
    end if;
    -- The institute comes from this very save, so the value being written is
    -- what is checked — not the stale one on the row.
    if v_kind = 'institute' and p_institute_id is null then
      raise exception 'Set Institute first — an institute escalation has to name one.';
    end if;
  end if;

  if not (v_issues <@ support.issue_options()) then
    raise exception 'Unknown issue option.';
  end if;

  -- An institute escalation has no person, so the column is cleared rather than
  -- left holding whoever it went to last time.
  v_person := case
                when v_kind = 'team' then p_escalated_to
                when v_kind = 'institute' then null
                else t.escalated_to
              end;

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

  -- ---- the status move. The kind is part of it: escalating the same ticket
  -- ---- from a colleague to the institute is a real change even though the
  -- ---- status did not move.
  if p_outcome is distinct from t.status
     or p_follow_up_date is distinct from t.follow_up_date
     or v_person is distinct from t.escalated_to
     or v_kind is distinct from t.escalation_kind then
    insert into support.events (ticket_id, actor_id, kind, detail)
    values (p_ticket_id, v_actor,
            (case when p_outcome = 'resolved' and t.status <> 'resolved' then 'resolved'
                  when t.status = 'resolved' and p_outcome <> 'resolved' then 'reopened'
                  else 'status_change' end)::support.event_kind,
            jsonb_build_object('old', t.status, 'new', p_outcome,
                               'follow_up_date', p_follow_up_date,
                               'escalation_kind', v_kind,
                               'escalated_to', v_person,
                               'institute_id', case when v_kind = 'institute'
                                                    then p_institute_id end));
  end if;

  -- ---- the note carrying the action details. Always written.
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
         escalation_kind  = v_kind,
         escalated_to     = v_person,
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
  boolean, boolean, text, text
) to authenticated, service_role;

-- A merged child copies its parent's escalation, kind included, or the
-- constraints refuse the insert.
comment on constraint tickets_escalation_kind_set on support.tickets is
  'A kind exactly when escalated. lib/support/create.ts copies the parent''s '
  'status, follow-up date, escalatee and kind together for this reason.';

notify pgrst, 'reload schema';
