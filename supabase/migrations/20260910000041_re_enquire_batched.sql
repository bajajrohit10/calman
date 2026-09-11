-- §10.1: re-enquire a whole chunk in one round trip.
--
-- The first cut called app.import_re_enquire() once per row. That matched the
-- old per-row update path it replaced, but the create path was batched in
-- Brief 5 precisely because per-row round trips are what made a 3,000-row
-- import take nine minutes — and a morning re-upload is mostly re-enquiries,
-- so the slow path is the common one.
--
-- One statement per chunk. The data-modifying CTEs run exactly once each,
-- independently of whether the outer query reads them, which is what makes
-- this safe to write as a single query.
--
-- Per-row status comes back so the import log can still say what happened to
-- each row: an enquiry that stopped being open between the review pass and the
-- commit is reported, not silently skipped.

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
-- The OUT parameters (enquiry_id, ok, message) share names with columns the
-- query below selects, and plpgsql resolves such a reference to the *variable*
-- by default — which fails as "column reference is ambiguous" at run time, not
-- at create time. Caught only because the measurement showed the batch taking
-- exactly as long as the per-row fallback it was supposed to replace.
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
  -- The rows this may actually touch, with the values they had before the
  -- update. Every other CTE reads this, so they all agree about "before".
  eligible as (
    select i.enquiry_id,
           i.source_id,
           nullif(btrim(coalesce(i.product_text, '')), '') as incoming,
           i.term_id,
           i.importance,
           i.lead_verification,
           coalesce(i.clear_follow_up, false) as clear_follow_up,
           e.product_text as old_text,
           e.source_id    as old_source,
           e.created_at   as old_created_at
      from input i
      join public.enquiries e on e.id = i.enquiry_id
     where e.status = 'open'
       and e.archived_at is null
  ),
  -- Defensive, as in the single-row function: "log the old and the new" has to
  -- hold even for a row that never got a creation entry. Reads the
  -- pre-statement snapshot, so it cannot see the rows `logged` is adding.
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
             case when el.clear_follow_up then null else e.next_follow_up_date end,
           re_enquired_at =
             case when el.clear_follow_up then app.ist_today() else e.re_enquired_at end
      from eligible el
     where e.id = el.enquiry_id
    returning e.id
  ),
  logged as (
    insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, note)
    select el.enquiry_id, el.source_id, p_import_batch_id,
           case when el.clear_follow_up
                then 'Re-uploaded; returned to New Calls.'
                else 'Re-uploaded before the first call.' end
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

create or replace function public.import_re_enquire_many(
  p_rows jsonb,
  p_import_batch_id uuid default null
)
returns table (enquiry_id bigint, ok boolean, message text)
language sql volatile security invoker set search_path = ''
as $$ select * from app.import_re_enquire_many(p_rows, p_import_batch_id) $$;

revoke all on function app.import_re_enquire_many(jsonb, uuid) from public;
grant execute on function app.import_re_enquire_many(jsonb, uuid) to authenticated;
revoke all on function public.import_re_enquire_many(jsonb, uuid) from public;
grant execute on function public.import_re_enquire_many(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- New Calls: a re-enquired lead sorts by the day it came back.
--
-- It kept its original created_at, so a lead re-uploaded today was landing
-- among leads six months old — at the top of a list ordered oldest-first, which
-- is the opposite of where a counsellor expects today's arrivals. The sort now
-- uses the *arrival* date: re_enquired_at when there is one, the creation day
-- otherwise. created_at stays as the tiebreak so same-day arrivals keep their
-- order, and it is still what the Enquired column shows.
-- ---------------------------------------------------------------------------

drop function if exists public.new_calls_pool(uuid[], uuid, uuid, public.importance, uuid, date, date, text, integer, integer, uuid);

create or replace function public.new_calls_pool(
  p_source_ids uuid[] default null,
  p_course_id uuid default null,
  p_teacher_id uuid default null,
  p_importance public.importance default null,
  p_term_id uuid default null,
  p_created_from date default null,
  p_created_to date default null,
  p_product_text text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_institute_id uuid default null
)
returns table (
  enquiry_id bigint,
  student_id uuid,
  mobile text,
  student_name text,
  importance public.importance,
  term_name text,
  source_name text,
  product_text text,
  teacher_names text,
  item_count integer,
  created_at timestamptz,
  re_enquired_at date,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
with base as (
  select
    e.id as enquiry_id,
    e.student_id,
    s.mobile,
    s.name as student_name,
    e.importance,
    tm.name as term_name,
    src.name as source_name,
    e.product_text,
    (select string_agg(distinct tch.name, ', ' order by tch.name)
       from public.enquiry_items i
       join public.teachers tch on tch.id = i.teacher_id
      where i.enquiry_id = e.id and i.status = 'open') as teacher_names,
    (select count(*)::integer from public.enquiry_items i
      where i.enquiry_id = e.id and i.status = 'open') as item_count,
    e.created_at,
    e.re_enquired_at,
    -- The day this lead arrived in the pool, however it got there.
    coalesce(e.re_enquired_at, (e.created_at at time zone 'Asia/Kolkata')::date)
      as arrived_on
  from public.enquiries e
  join public.students s on s.id = e.student_id
  left join public.terms tm on tm.id = e.term_id
  left join public.sources src on src.id = e.source_id
  where e.type = 'purchase'
    and e.status = 'open'
    and e.archived_at is null
    and (e.fresh_call_date is null or e.re_enquired_at = app.ist_today())
    and not exists (
      select 1 from public.assignments a
       where a.enquiry_id = e.id
         and a.date = app.ist_today()
    )
    and (
      p_source_ids is null
      or cardinality(p_source_ids) = 0
      or e.source_id = any (p_source_ids)
    )
    and (p_importance is null or e.importance = p_importance)
    and (p_term_id is null or e.term_id = p_term_id)
    and (p_created_from is null
         or (e.created_at at time zone 'Asia/Kolkata')::date >= p_created_from)
    and (p_created_to is null
         or (e.created_at at time zone 'Asia/Kolkata')::date <= p_created_to)
    and (p_product_text is null or e.product_text ilike '%' || p_product_text || '%')
    and (p_course_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.course_id = p_course_id))
    and (p_teacher_id is null or exists (
          select 1 from public.enquiry_items i
           where i.enquiry_id = e.id and i.status = 'open'
             and i.teacher_id = p_teacher_id))
    and (p_institute_id is null or exists (
          select 1 from public.enquiry_items i
            join public.teachers tch on tch.id = i.teacher_id
           where i.enquiry_id = e.id and i.status = 'open'
             and tch.institute_id = p_institute_id))
)
select
  b.enquiry_id, b.student_id, b.mobile, b.student_name, b.importance,
  b.term_name, b.source_name, b.product_text, b.teacher_names, b.item_count,
  b.created_at, b.re_enquired_at,
  count(*) over () as total_count
from base b
-- Importance A → D, then oldest arrival first. A lead that came back today
-- sits with today's arrivals rather than with the six-month-old leads it was
-- created alongside.
order by b.importance nulls last, b.arrived_on, b.created_at, b.enquiry_id
limit coalesce(p_limit, 50)
offset coalesce(p_offset, 0);
$$;

revoke all on function public.new_calls_pool from public;
grant execute on function public.new_calls_pool to authenticated;
