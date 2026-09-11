-- A re-enquiry records that the number came in again. Whether it goes back in
-- the pool is a separate question.
--
-- p_clear_follow_up did both jobs: it wiped next_follow_up_date *and* stamped
-- re_enquired_at, which is the flag new_calls_pool() reads. One consequence was
-- invisible and bit somebody in production: a lead already called today, whose
-- default decision (rule d) is "dismiss", re-enquired by hand — the importer
-- passes clear_follow_up = false for that state, so re_enquired_at was never
-- set, the pool's `fresh_call_date is null or re_enquired_at = today` stayed
-- false, and the number simply never appeared in New Calls. Three re-uploads
-- later there was still nothing to see and nothing saying why.
--
-- The other consequence is the one this brief is about. A re-enquired lead that
-- somebody is already working today should stay with them — clearing their
-- follow-up date out from under them is not "returned to the pool", it is lost
-- work — but it still needs to be visibly re-enquired on their My Day.
--
-- So the two are separated:
--   re_enquired_at       always set. It means "this number arrived again today".
--   next_follow_up_date  cleared only when the caller asks, which the importer
--                        now decides from the state *and* from whether anybody
--                        is assigned to it today.
--
-- The pool is unchanged and needs no change: it already excludes anything with
-- an assignment for today, so only unassigned leads can enter it.

-- ---------------------------------------------------------------------------
-- 1. Single row.
-- ---------------------------------------------------------------------------
create or replace function app.import_re_enquire(
  p_enquiry_id bigint,
  p_source_id uuid default null,
  p_product_text text default null,
  p_term_id uuid default null,
  p_importance public.importance default null,
  p_lead_verification public.lead_verification default null,
  p_import_batch_id uuid default null,
  p_clear_follow_up boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
  incoming text := nullif(btrim(coalesce(p_product_text, '')), '');
  held boolean;
begin
  if not app.is_staff() then
    raise exception 'not authorised to re-enquire from an import'
      using errcode = '42501';
  end if;

  select * into enq from public.enquiries where id = p_enquiry_id for update;

  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id using errcode = 'P0002';
  end if;
  if enq.status <> 'open' then
    raise exception 'only an open enquiry can be re-enquired (this one is %)', enq.status
      using errcode = '22023';
  end if;
  if enq.archived_at is not null then
    raise exception 'enquiry % is archived', p_enquiry_id using errcode = '22023';
  end if;

  -- Somebody is working this today. Recorded here as well as in the importer
  -- so the note in enquiry_sources says what actually happened, whichever path
  -- called this.
  held := exists (
    select 1 from public.assignments a
     where a.enquiry_id = enq.id and a.date = app.ist_today()
  );

  if not exists (select 1 from public.enquiry_sources es where es.enquiry_id = enq.id) then
    insert into public.enquiry_sources (enquiry_id, source_id, occurred_at, note)
    values (enq.id, enq.source_id, enq.created_at, 'Source held when the re-upload arrived.');
  end if;

  update public.enquiries e
     set source_id         = coalesce(p_source_id, e.source_id),
         term_id           = coalesce(e.term_id, p_term_id),
         importance        = coalesce(e.importance, p_importance),
         lead_verification = coalesce(e.lead_verification, p_lead_verification),
         product_text = case
           when incoming is null then e.product_text
           when nullif(btrim(coalesce(e.product_text, '')), '') is null then incoming
           when e.product_text = incoming then e.product_text
           when incoming = any (string_to_array(e.product_text, E'\n')) then e.product_text
           else e.product_text || E'\n' || incoming
         end,
         -- Never wiped for a lead somebody holds today, whatever the caller
         -- asked for: the assignment is the stronger claim.
         next_follow_up_date =
           case when p_clear_follow_up and not held then null else e.next_follow_up_date end,
         -- Always. This is the record that the number arrived again.
         re_enquired_at = app.ist_today()
   where e.id = p_enquiry_id;

  insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, note)
  values (
    enq.id, p_source_id, p_import_batch_id,
    case
      when held then 'Re-uploaded; already assigned today, left with that counsellor.'
      when p_clear_follow_up then 'Re-uploaded; returned to New Calls.'
      else 'Re-uploaded; already waiting in New Calls.'
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The batched path, same rules.
-- ---------------------------------------------------------------------------
create or replace function app.import_re_enquire_many(
  p_rows jsonb,
  p_import_batch_id uuid default null
)
returns table (enquiry_id bigint, ok boolean, message text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
-- The OUT parameters share names with columns the query selects, and plpgsql
-- resolves such a reference to the *variable* by default — "column reference is
-- ambiguous" at run time, not at create time (Brief 10).
#variable_conflict use_column
begin
  if not app.is_staff() then
    raise exception 'not authorised to re-enquire from an import'
      using errcode = '42501';
  end if;

  return query
  with input as (
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
      enquiry_id bigint,
      source_id uuid,
      product_text text,
      term_id uuid,
      importance public.importance,
      lead_verification public.lead_verification,
      clear_follow_up boolean
    )
  ),
  eligible as (
    select i.enquiry_id,
           i.source_id,
           nullif(btrim(coalesce(i.product_text, '')), '') as incoming,
           i.term_id,
           i.importance,
           i.lead_verification,
           coalesce(i.clear_follow_up, false) as clear_follow_up,
           -- One pass for the whole chunk rather than an exists() per row.
           exists (
             select 1 from public.assignments a
              where a.enquiry_id = e.id and a.date = app.ist_today()
           ) as held,
           e.product_text as old_text,
           e.source_id    as old_source,
           e.created_at   as old_created_at
      from input i
      join public.enquiries e on e.id = i.enquiry_id
     where e.status = 'open'
       and e.archived_at is null
  ),
  seed_old as (
    insert into public.enquiry_sources (enquiry_id, source_id, occurred_at, note)
    select el.enquiry_id, el.old_source, el.old_created_at,
           'Source held when the re-upload arrived.'
      from eligible el
     where not exists (
       select 1 from public.enquiry_sources es where es.enquiry_id = el.enquiry_id)
    returning 1
  ),
  updated as (
    update public.enquiries e
       set source_id         = coalesce(el.source_id, e.source_id),
           term_id           = coalesce(e.term_id, el.term_id),
           importance        = coalesce(e.importance, el.importance),
           lead_verification = coalesce(e.lead_verification, el.lead_verification),
           product_text = case
             when el.incoming is null then el.old_text
             when nullif(btrim(coalesce(el.old_text, '')), '') is null then el.incoming
             when el.old_text = el.incoming then el.old_text
             when el.incoming = any (string_to_array(el.old_text, E'\n')) then el.old_text
             else el.old_text || E'\n' || el.incoming
           end,
           next_follow_up_date =
             case when el.clear_follow_up and not el.held
                  then null else e.next_follow_up_date end,
           re_enquired_at = app.ist_today()
      from eligible el
     where e.id = el.enquiry_id
    returning e.id
  ),
  logged as (
    insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, note)
    select el.enquiry_id, el.source_id, p_import_batch_id,
           case
             when el.held then 'Re-uploaded; already assigned today, left with that counsellor.'
             when el.clear_follow_up then 'Re-uploaded; returned to New Calls.'
             else 'Re-uploaded; already waiting in New Calls.'
           end
      from eligible el
    returning enquiry_id
  )
  select i.enquiry_id,
         el.enquiry_id is not null,
         case when el.enquiry_id is not null then null
              else 'no longer an open, unarchived enquiry' end
    from input i
    left join eligible el on el.enquiry_id = i.enquiry_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2b. live_enquiries had gone stale, and that is why step 3 could not compile.
--
-- The view was created in Brief 9 as `select * from enquiries`, and Postgres
-- expands the star once, at creation. re_enquired_at arrived a brief later
-- (0038) and the view has been missing it ever since — invisible, because
-- every surface selects named columns and none had asked for that one yet.
--
-- Replacing it re-expands the star. Columns are appended to a table, so the
-- existing ones keep their names, types and positions and `create or replace`
-- is allowed; the eight surfaces reading the view are unaffected.
-- ---------------------------------------------------------------------------
create or replace view public.live_enquiries with (security_invoker = true) as
  select * from public.enquiries where archived_at is null;

-- ---------------------------------------------------------------------------
-- 3. My Day carries the flag, so the counsellor holding the lead can see that
--    it came in again rather than finding out from the import report.
-- ---------------------------------------------------------------------------
-- Adding a column to the result means the signature changes, and `create or
-- replace` cannot do that. Dropped and rebuilt; nothing holds a reference to
-- it but the application.
drop function if exists public.my_day(date, uuid);

create function public.my_day(
  p_date date default null,
  p_counsellor_id uuid default null
)
returns table (
  enquiry_id bigint,
  bucket public.assignment_bucket,
  bucket_rank smallint,
  student_id uuid,
  mobile text,
  student_name text,
  type public.enquiry_type,
  status public.enquiry_status,
  importance public.importance,
  term_name text,
  product_text text,
  next_follow_up_date date,
  is_overdue boolean,
  follow_up_slots_used smallint,
  top_content_priority smallint,
  teacher_names text[],
  item_count integer,
  called_today boolean,
  last_call_at timestamptz,
  last_outcome public.call_outcome,
  re_enquired_today boolean
)
language sql
stable
set search_path to ''
as $function$
with target as (
  select
    coalesce(p_date, app.ist_today()) as d,
    coalesce(p_counsellor_id, (select auth.uid())) as who
),
mine as (
  select a.enquiry_id, a.bucket
    from public.assignments a
    cross join target t
   where a.date = t.d
     and a.counsellor_id = t.who
),
today_call as (
  select c.enquiry_id, max(c.called_at) as last_call_at
    from public.calls c
    join mine m on m.enquiry_id = c.enquiry_id
    cross join target t
   where c.call_date = t.d
   group by c.enquiry_id
)
select
  e.id,
  m.bucket,
  (case m.bucket
     when 'follow_up' then 1
     when 'offer'     then 2
     when 'fresh'     then 3
     when 'campaign'  then 4
     when 'call_back' then 5
   end)::smallint as bucket_rank,
  e.student_id,
  s.mobile,
  s.name,
  e.type,
  e.status,
  e.importance,
  tm.name,
  e.product_text,
  e.next_follow_up_date,
  (e.next_follow_up_date is not null and e.next_follow_up_date < t.d) as is_overdue,
  e.follow_up_slots_used,
  e.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = e.id and i.status = 'open') as teacher_names,
  (select count(*)::integer from public.enquiry_items i
    where i.enquiry_id = e.id) as item_count,
  (tc.enquiry_id is not null) as called_today,
  tc.last_call_at,
  (select c.outcome
     from public.calls c
    where c.enquiry_id = e.id
    order by c.call_date desc, c.called_at desc, c.id desc
    limit 1) as last_outcome,
  -- Against the day being viewed, not against today: on Tuesday's list, "came
  -- in again" has to mean Tuesday.
  (e.re_enquired_at is not null and e.re_enquired_at = t.d) as re_enquired_today
from mine m
join public.live_enquiries e on e.id = m.enquiry_id
join public.students s on s.id = e.student_id
cross join target t
left join public.terms tm on tm.id = e.term_id
left join today_call tc on tc.enquiry_id = e.id
where e.type = 'purchase'
order by
  (case m.bucket
     when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
     when 'campaign'  then 4 when 'call_back' then 5 end),
  e.importance nulls last,
  e.top_content_priority nulls last,
  e.next_follow_up_date nulls last,
  e.id;
$function$;

comment on function public.my_day is
  'One counsellor''s assigned day (§6). Keyed on assignments, so a row stays '
  'in its tab after the enquiry closes; called_today drives the Pending/Done '
  'split and re_enquired_today flags a lead that arrived again. Purchase only '
  '— after-sale is the Tickets tab.';

revoke all on function public.my_day from public;
grant execute on function public.my_day to authenticated;
