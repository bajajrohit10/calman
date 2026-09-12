-- The conversion itself. Separate from 0074 because a new enum value cannot be
-- used in the same transaction that adds it, and Supabase runs one migration
-- per transaction.

-- ---------------------------------------------------------------------------
-- recompute must leave a converted enquiry alone
-- ---------------------------------------------------------------------------
--
-- app.recompute_enquiry derives status from call history and already refuses
-- to touch a superseded row, because that close was a human decision rather
-- than something the calls say. A converted row is the same kind of decision:
-- its sales calls are still sitting there, and without this the next recompute
-- would read them and quietly reopen the enquiry we had just closed.

do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  patched := replace(src,
    'if enq.status = ''closed'' and enq.close_reason = ''superseded'' then',
    'if enq.status = ''closed'' and enq.close_reason in (''superseded'', ''converted'') then');

  if patched = src then
    raise exception 'recompute_enquiry: the superseded guard was not found';
  end if;

  execute patched;
end $$;


-- ---------------------------------------------------------------------------
-- convert_to_after_sale
-- ---------------------------------------------------------------------------
--
-- Returns the enquiry the call should be logged against: the same one when it
-- was converted in place, a new one when the old had history worth keeping.
-- The caller logs the call afterwards rather than passing it in, so this stays
-- one decision — which enquiry — and the call-logging path keeps its single
-- implementation.

create or replace function public.convert_to_after_sale(p_enquiry_id bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
  v_calls integer;
  v_new bigint;
begin
  if not app.is_staff() then
    raise exception 'not authorised to convert an enquiry'
      using errcode = '42501';
  end if;

  select * into enq from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id using errcode = 'P0002';
  end if;
  if enq.archived_at is not null then
    raise exception 'enquiry % is archived', p_enquiry_id using errcode = '22023';
  end if;

  -- Idempotent: a double-submit settles rather than raising, and an enquiry
  -- that is already after-sale needs no conversion at all.
  if enq.type = 'after_sale' then
    return p_enquiry_id;
  end if;

  select count(*) into v_calls from public.calls c where c.enquiry_id = p_enquiry_id;

  -- ---- never called: convert in place ------------------------------------
  if v_calls = 0 then
    if enq.status <> 'open' then
      raise exception 'enquiry % has no calls but is % — cannot convert', p_enquiry_id, enq.status
        using errcode = '22023';
    end if;

    -- The interests were a guess about a sales conversation that never
    -- happened. Carrying them onto a ticket would put the student back in
    -- teacher-wise analytics as live interest in something they never
    -- discussed.
    delete from public.enquiry_items i
     where i.enquiry_id = p_enquiry_id and i.status = 'open';

    update public.enquiries e
       set type = 'after_sale',
           next_follow_up_date = null
     where e.id = p_enquiry_id;

    -- After-sale work is not assignment-backed: My Day reads it from
    -- tickets_list, and my_day() only returns purchase rows. Leaving the row
    -- would keep the lead counted as a purchase assignment on a desk that can
    -- no longer show it.
    delete from public.assignments a
     where a.enquiry_id = p_enquiry_id and a.date = app.ist_today();

    insert into public.enquiry_sources (enquiry_id, source_id, note)
    values (p_enquiry_id, enq.source_id,
            'Converted to after-sale before any call was logged.');

    return p_enquiry_id;
  end if;

  -- ---- already called: close it and open a ticket beside it ---------------
  update public.enquiries e
     set status = 'closed',
         close_reason = 'converted',
         -- lost_reason_iff_lost: a closed row must not carry one.
         lost_reason = null,
         next_follow_up_date = null,
         closed_at = coalesce(e.closed_at, now())
   where e.id = p_enquiry_id;

  insert into public.enquiries (
    student_id, type, source_id, term_id, status, created_by
  )
  values (
    enq.student_id, 'after_sale', enq.source_id, enq.term_id, 'open',
    (select auth.uid())
  )
  returning id into v_new;

  -- Both ends of the story say so, so either enquiry read on its own explains
  -- the other.
  insert into public.enquiry_sources (enquiry_id, source_id, note)
  values (p_enquiry_id, enq.source_id,
          'Converted to after-sale: this call moved to enquiry #' || v_new || '.'),
         (v_new, enq.source_id,
          'Converted from purchase enquiry #' || p_enquiry_id || '.');

  -- Assigned to whoever is making the call, for today (§25). Nothing reads it
  -- on My Day — Tickets is its own list — but the desk's history of who held
  -- what is the poorer without it.
  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  values (v_new, app.ist_today(), (select auth.uid()), 'fresh', (select auth.uid()))
  on conflict (enquiry_id, date) do nothing;

  return v_new;
end;
$$;

comment on function public.convert_to_after_sale is
  'Turn a purchase enquiry into an after-sale one (§25). Never called: '
  'converted in place, open interests dropped, today''s assignment released. '
  'Already called: closed with close_reason = converted and a new after-sale '
  'enquiry opened for the student, which is what the returned id points at.';

revoke all on function public.convert_to_after_sale from public;
grant execute on function public.convert_to_after_sale to authenticated;
