-- Say where the lead landed, once, in the place that knows.
--
-- 0048 gave the re-enquiry three outcomes but only two words for them, so a
-- lead that had been called today and was now going back in the pool was logged
-- as "already waiting in New Calls" — which is what it says for a lead that was
-- never called at all, and is the opposite of what just happened.
--
-- Three cases, and fresh_call_date is enough to tell them apart:
--   held                     somebody is on it today; it stays with them
--   never called             it was already in the pool and still is
--   called, now unassigned   it has just gone back in the pool
--
-- The text is returned to the caller as well as written to enquiry_sources, so
-- the import report quotes the database instead of guessing from the review
-- state it happened to be holding — the two had no way to stay in step, and
-- the review state is the older of them by the time the commit runs.

-- void -> text, so both the definer and its public shim are dropped first.
drop function if exists public.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean);
drop function if exists app.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean);

create function app.import_re_enquire(
  p_enquiry_id bigint,
  p_source_id uuid default null,
  p_product_text text default null,
  p_term_id uuid default null,
  p_importance public.importance default null,
  p_lead_verification public.lead_verification default null,
  p_import_batch_id uuid default null,
  p_clear_follow_up boolean default false
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
  incoming text := nullif(btrim(coalesce(p_product_text, '')), '');
  holder text;
  landed text;
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

  select pr.full_name into holder
    from public.assignments a
    join public.profiles pr on pr.id = a.counsellor_id
   where a.enquiry_id = enq.id and a.date = app.ist_today()
   limit 1;

  landed := case
    when holder is not null then
      'Already assigned to ' || holder || ' today — stays on their list, flagged as re-enquired.'
    when enq.fresh_call_date is null then 'Already waiting in New Calls.'
    else 'Back in New Calls.'
  end;

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
         next_follow_up_date =
           case when p_clear_follow_up and holder is null then null else e.next_follow_up_date end,
         re_enquired_at = app.ist_today()
   where e.id = p_enquiry_id;

  insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, note)
  values (enq.id, p_source_id, p_import_batch_id, 'Re-uploaded. ' || landed);

  return landed;
end;
$$;

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
           (select pr.full_name
              from public.assignments a
              join public.profiles pr on pr.id = a.counsellor_id
             where a.enquiry_id = e.id and a.date = app.ist_today()
             limit 1) as holder,
           e.fresh_call_date as old_fresh,
           e.product_text as old_text,
           e.source_id    as old_source,
           e.created_at   as old_created_at
      from input i
      join public.enquiries e on e.id = i.enquiry_id
     where e.status = 'open'
       and e.archived_at is null
  ),
  described as (
    select el.*,
           case
             when el.holder is not null then
               'Already assigned to ' || el.holder ||
               ' today — stays on their list, flagged as re-enquired.'
             when el.old_fresh is null then 'Already waiting in New Calls.'
             else 'Back in New Calls.'
           end as landed
      from eligible el
  ),
  seed_old as (
    insert into public.enquiry_sources (enquiry_id, source_id, occurred_at, note)
    select d.enquiry_id, d.old_source, d.old_created_at,
           'Source held when the re-upload arrived.'
      from described d
     where not exists (
       select 1 from public.enquiry_sources es where es.enquiry_id = d.enquiry_id)
    returning 1
  ),
  updated as (
    update public.enquiries e
       set source_id         = coalesce(d.source_id, e.source_id),
           term_id           = coalesce(e.term_id, d.term_id),
           importance        = coalesce(e.importance, d.importance),
           lead_verification = coalesce(e.lead_verification, d.lead_verification),
           product_text = case
             when d.incoming is null then d.old_text
             when nullif(btrim(coalesce(d.old_text, '')), '') is null then d.incoming
             when d.old_text = d.incoming then d.old_text
             when d.incoming = any (string_to_array(d.old_text, E'\n')) then d.old_text
             else d.old_text || E'\n' || d.incoming
           end,
           next_follow_up_date =
             case when d.clear_follow_up and d.holder is null
                  then null else e.next_follow_up_date end,
           re_enquired_at = app.ist_today()
      from described d
     where e.id = d.enquiry_id
    returning e.id
  ),
  logged as (
    insert into public.enquiry_sources (enquiry_id, source_id, import_batch_id, note)
    select d.enquiry_id, d.source_id, p_import_batch_id, 'Re-uploaded. ' || d.landed
      from described d
    returning enquiry_id
  )
  select i.enquiry_id,
         d.enquiry_id is not null,
         -- On success this is where the lead landed, not an error. The import
         -- report shows it verbatim.
         case when d.enquiry_id is not null then d.landed
              else 'no longer an open, unarchived enquiry' end
    from input i
    left join described d on d.enquiry_id = i.enquiry_id;
end;
$$;

-- The public shim, rebuilt on the new return type.
create function public.import_re_enquire(
  p_enquiry_id bigint,
  p_source_id uuid default null,
  p_product_text text default null,
  p_term_id uuid default null,
  p_importance public.importance default null,
  p_lead_verification public.lead_verification default null,
  p_import_batch_id uuid default null,
  p_clear_follow_up boolean default false
)
returns text
language sql volatile security invoker set search_path = ''
as $$ select app.import_re_enquire(p_enquiry_id, p_source_id, p_product_text, p_term_id,
                                   p_importance, p_lead_verification, p_import_batch_id,
                                   p_clear_follow_up) $$;

revoke all on function app.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) from public;
grant execute on function app.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) to authenticated;
revoke all on function public.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) from public;
grant execute on function public.import_re_enquire(bigint, uuid, text, uuid, public.importance, public.lead_verification, uuid, boolean) to authenticated;
