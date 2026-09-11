-- §10.1: what the review table needs to know, and the one write it makes.
--
-- The old lookup embedded enquiries through students and knew three states.
-- The rules need two things it could not see: the enquiry's *type*, and *when
-- it was last called and by whom*. PostgREST cannot express "embed only the
-- latest call", and the old path chunked at 500 numbers to dodge the row cap.
-- One RPC settles both.

create or replace function app.import_lookup(p_mobiles text[])
returns table (
  mobile text,
  student_id uuid,
  student_name text,
  -- new              no student, or no enquiry at all
  -- open_uncalled    open purchase enquiry, never called      → rule (b)
  -- open_called_earlier  open, last call before today         → rule (c)
  -- open_called_today    open, called today                   → rule (d)
  -- wrong_number     no open purchase; last resolved one was a wrong number
  -- resolved         no open purchase enquiry                 → rule (a)
  state text,
  open_enquiry_id bigint,
  last_call_at timestamptz,
  last_call_date date,
  last_call_by text,
  enquiry_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
with wanted as (
  select distinct m from unnest(coalesce(p_mobiles, '{}'::text[])) m
),
matched as (
  select w.m as mobile, s.id as student_id, s.name as student_name
    from wanted w
    left join public.students s on s.mobile = w.m
),
-- The open purchase enquiry, if there is one. Archived does not count as open
-- (Brief 9): it has been exported, and re-enquiring into it would write to a
-- closed batch.
open_enq as (
  select distinct on (e.student_id)
         e.student_id, e.id, e.fresh_call_date
    from public.enquiries e
   where e.status = 'open'
     and e.type = 'purchase'
     and e.archived_at is null
     and e.student_id in (select student_id from matched where student_id is not null)
   order by e.student_id, e.id desc
),
last_call as (
  select distinct on (c.enquiry_id)
         c.enquiry_id, c.called_at, c.call_date, pr.full_name
    from public.calls c
    left join public.profiles pr on pr.id = c.called_by
   where c.enquiry_id in (select id from open_enq)
   order by c.enquiry_id, c.call_date desc, c.called_at desc, c.id desc
),
counts as (
  select e.student_id, count(*)::integer as n
    from public.enquiries e
   where e.student_id in (select student_id from matched where student_id is not null)
   group by 1
),
wrong as (
  select distinct e.student_id
    from public.enquiries e
   where e.close_reason = 'wrong_number' and e.archived_at is null
     and e.student_id in (select student_id from matched where student_id is not null)
)
select
  m.mobile,
  m.student_id,
  m.student_name,
  case
    when m.student_id is null then 'new'
    when oe.id is null then
      case when w.student_id is not null then 'wrong_number' else 'resolved' end
    when oe.fresh_call_date is null then 'open_uncalled'
    -- IST calendar day, the same boundary §4.3 uses for a slot, so 23:50 and
    -- 00:10 are different days.
    when lc.call_date = app.ist_today() then 'open_called_today'
    else 'open_called_earlier'
  end,
  oe.id,
  lc.called_at,
  lc.call_date,
  lc.full_name,
  coalesce(cn.n, 0)
from matched m
left join open_enq oe on oe.student_id = m.student_id
left join last_call lc on lc.enquiry_id = oe.id
left join counts cn on cn.student_id = m.student_id
left join wrong w on w.student_id = m.student_id;
$$;

create or replace function public.import_lookup(p_mobiles text[])
returns table (
  mobile text, student_id uuid, student_name text, state text,
  open_enquiry_id bigint, last_call_at timestamptz, last_call_date date,
  last_call_by text, enquiry_count integer
)
language sql stable security invoker set search_path = ''
as $$ select * from app.import_lookup(p_mobiles) $$;

revoke all on function app.import_lookup(text[]) from public;
grant execute on function app.import_lookup(text[]) to authenticated;
revoke all on function public.import_lookup(text[]) from public;
grant execute on function public.import_lookup(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-enquiry: rules (b) and (c).
--
-- Both keep the enquiry, override its source, log the arrival and append the
-- incoming product text. (c) additionally clears the follow-up date and stamps
-- re_enquired_at so the lead shows up in New Calls today.
--
-- No interest lines are created. An import never invents an enquiry_item —
-- items are the counsellor's record of what was actually discussed, and the
-- teacher-wise analytics are built on them. The incoming product text is
-- appended instead, and the counsellor adds the line when they call.
--
-- Clearing next_follow_up_date here is a deliberate write to a column
-- app.recompute_enquiry() otherwise owns. The next logged call will derive a
-- new one and overwrite this — which is correct: a call *should* set the next
-- date, and a re-enquiry that gets called has stopped being a re-enquiry.
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

  -- The old source. Every enquiry got a row at migration time and new ones log
  -- theirs at creation, so this is defensive rather than routine — but "log the
  -- old and the new" has to hold even for a row that slipped through.
  if not exists (select 1 from public.enquiry_sources es where es.enquiry_id = enq.id) then
    insert into public.enquiry_sources (enquiry_id, source_id, occurred_at, note)
    values (enq.id, enq.source_id, enq.created_at, 'Source held when the re-upload arrived.');
  end if;

  update public.enquiries e
     set -- Overridden, not filled: the newest arrival is the current source,
         -- and the old one survives in enquiry_sources.
         source_id         = coalesce(p_source_id, e.source_id),
         -- These keep the §5.6 fill-blanks rule.
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
         next_follow_up_date =
           case when p_clear_follow_up then null else e.next_follow_up_date end,
         re_enquired_at =
           case when p_clear_follow_up then app.ist_today() else e.re_enquired_at end
   where e.id = p_enquiry_id;

  insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, note)
  values (
    enq.id, p_source_id, p_import_batch_id,
    case when p_clear_follow_up
         then 'Re-uploaded; returned to New Calls.'
         else 'Re-uploaded before the first call.' end
  );
end;
$$;

create or replace function public.import_re_enquire(
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
language sql volatile security invoker set search_path = ''
as $$
  select app.import_re_enquire(
    p_enquiry_id, p_source_id, p_product_text, p_term_id, p_importance,
    p_lead_verification, p_import_batch_id, p_clear_follow_up);
$$;

revoke all on function app.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) from public;
grant execute on function app.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) to authenticated;
revoke all on function public.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) from public;
grant execute on function public.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) to authenticated;

-- import_update_enquiry is superseded: rules (b) and (c) are the only way an
-- import touches an existing enquiry now, and both go through the function
-- above. Dropped rather than left deployed and unused.
drop function if exists public.import_update_enquiry(bigint, uuid, text, uuid, public.importance, public.lead_verification);
drop function if exists app.import_update_enquiry(bigint, uuid, text, uuid, public.importance, public.lead_verification);

-- ---------------------------------------------------------------------------
-- §10.2: an institute cannot be deactivated out from under its teachers.
-- ---------------------------------------------------------------------------

create or replace function app.institutes_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if tg_op = 'UPDATE' and old.is_active and not new.is_active then
    select count(*) into v_n
      from public.teachers t
     where t.institute_id = new.id and t.is_active;

    if v_n > 0 then
      raise exception
        '% active teacher% still belong% to %. Reassign or clear them in Settings → Teachers first.',
        v_n,
        case when v_n = 1 then '' else 's' end,
        case when v_n = 1 then 's' else '' end,
        new.name
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger a_institutes_before_write
  before update on public.institutes
  for each row execute function app.institutes_before_write();
