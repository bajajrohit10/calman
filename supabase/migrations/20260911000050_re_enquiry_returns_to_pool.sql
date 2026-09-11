-- A re-enquiry puts the lead back in New Calls. Always.
--
-- Brief 15 made an assignment the stronger claim: a lead somebody was working
-- today kept its follow-up date and stayed on their list, on the reasoning that
-- taking it off them was lost work. In practice that is the wrong way round.
-- The number rang again. Whoever picks it up next should be whoever is free,
-- not whoever happened to hold it this morning, and a lead sitting on one
-- counsellor's list is invisible to everybody else.
--
-- So the guard is reversed. When the caller asks to return a lead to the pool:
--
--   * today's assignment is deleted, if there is one, and who held it is
--     reported back so the import log can say so;
--   * past assignments are left alone — they are the record of who called it
--     on the days they called it, and §5.8 reads them;
--   * next_follow_up_date is cleared, so it is a fresh lead rather than a
--     follow-up with a date in the past;
--   * re_enquired_at is set to today, which is what new_calls_pool() reads.
--
-- Rule (b) — open, never called — is untouched. Such a lead is already in the
-- pool by virtue of fresh_call_date being null, and if somebody has taken it
-- today they are mid-first-call: there is nothing to return it from.

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
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
  incoming text := nullif(btrim(coalesce(p_product_text, '')), '');
  taken_from text;
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

  if p_clear_follow_up then
    -- Today's assignment only. Deleting and reporting in one statement so the
    -- name cannot be read from a row that a concurrent take has already moved.
    with gone as (
      delete from public.assignments a
       where a.enquiry_id = enq.id
         and a.date = app.ist_today()
      returning a.counsellor_id
    )
    select pr.full_name into taken_from
      from gone
      join public.profiles pr on pr.id = gone.counsellor_id
     limit 1;
  end if;

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
           case when p_clear_follow_up then null else e.next_follow_up_date end,
         re_enquired_at = app.ist_today()
   where e.id = p_enquiry_id;

  landed := case
    when p_clear_follow_up then
      'Returned to New Calls.' ||
      coalesce(' (was with ' || taken_from || ')', '')
    else 'Already waiting in New Calls.'
  end;

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
           e.product_text as old_text,
           e.source_id    as old_source,
           e.created_at   as old_created_at
      from input i
      join public.enquiries e on e.id = i.enquiry_id
     where e.status = 'open'
       and e.archived_at is null
  ),
  -- Who held each of these today, read before the delete below removes them.
  -- A data-modifying CTE cannot see another's output, so the name has to be
  -- captured from the pre-statement snapshot rather than from `freed`.
  held as (
    select a.enquiry_id, pr.full_name
      from public.assignments a
      join public.profiles pr on pr.id = a.counsellor_id
      join eligible el on el.enquiry_id = a.enquiry_id and el.clear_follow_up
     where a.date = app.ist_today()
  ),
  freed as (
    delete from public.assignments a
     using eligible el
     where a.enquiry_id = el.enquiry_id
       and el.clear_follow_up
       and a.date = app.ist_today()
    returning a.enquiry_id
  ),
  described as (
    select el.*,
           case
             when el.clear_follow_up then
               'Returned to New Calls.' ||
               coalesce(' (was with ' || h.full_name || ')', '')
             else 'Already waiting in New Calls.'
           end as landed
      from eligible el
      left join held h on h.enquiry_id = el.enquiry_id
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
             case when d.clear_follow_up then null else e.next_follow_up_date end,
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
         case when d.enquiry_id is not null then d.landed
              else 'no longer an open, unarchived enquiry' end
    from input i
    left join described d on d.enquiry_id = i.enquiry_id
    -- `freed` is referenced so the delete runs; the count is not needed.
    left join freed f on f.enquiry_id = i.enquiry_id;
end;
$$;

comment on function app.import_re_enquire_many is
  'Re-enquire a chunk (§10.1). A lead returned to the pool loses today''s '
  'assignment and its follow-up date and is stamped re_enquired_at; past '
  'assignments are kept. Returns where each lead landed, for the import log.';
