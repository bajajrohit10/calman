-- Converting must never rewrite an enquiry that is already settled.
--
-- §25's second path closed the old enquiry with close_reason = 'converted'
-- whatever state it was in. For an open lead that is right: the sales
-- conversation is over and this is what ended it. For a won one it is
-- destructive — a sale becomes a closed row, the won status that §5.8 reads
-- and the amount behind it stop being a sale, and the revenue quietly leaves
-- the report. The same for a lost one: how a lead was lost is a fact worth
-- keeping, and 'converted' overwrites it.
--
-- So closing is now conditional on the enquiry being open, and it is the only
-- thing that is conditional. A settled enquiry is left exactly as it stands
-- and the student simply gets an after-sale enquiry beside it — which is what
-- §4.8 says happens to a student who comes back after an enquiry has
-- resolved, and has been true of Quick Add since Brief 3.
--
-- The in-place path narrows to match: never called *and* open. A won enquiry
-- with no calls — a sale recorded straight onto the row — used to raise here;
-- it now takes the same path as any other settled enquiry.

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

  -- ---- open and never called: convert in place ---------------------------
  -- Both conditions matter. No calls means there is no sales history to
  -- preserve; open means there is nothing recorded about how it ended that
  -- changing the type would contradict.
  if v_calls = 0 and enq.status = 'open' then
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

  -- ---- everything else: a ticket beside it --------------------------------
  -- An open enquiry with calls is ended by this call, so it closes. A won,
  -- lost or already-closed one is not ours to rewrite: it is left untouched
  -- and only gains a note saying where the call went.
  if enq.status = 'open' then
    update public.enquiries e
       set status = 'closed',
           close_reason = 'converted',
           -- lost_reason_iff_lost: a closed row must not carry one.
           lost_reason = null,
           next_follow_up_date = null,
           closed_at = coalesce(e.closed_at, now())
     where e.id = p_enquiry_id;
  end if;

  insert into public.enquiries (
    student_id, type, source_id, term_id, status, created_by
  )
  values (
    enq.student_id, 'after_sale', enq.source_id, enq.term_id, 'open',
    (select auth.uid())
  )
  returning id into v_new;

  -- Both ends of the story say so, so either enquiry read on its own explains
  -- the other. The wording follows what actually happened to this one.
  insert into public.enquiry_sources (enquiry_id, source_id, note)
  values (p_enquiry_id, enq.source_id,
          case when enq.status = 'open'
               then 'Converted to after-sale: this call moved to enquiry #' || v_new || '.'
               else 'After-sale call logged on enquiry #' || v_new
                    || '; this enquiry was left as it was.' end),
         (v_new, enq.source_id,
          'Converted from ' || enq.status::text || ' purchase enquiry #' || p_enquiry_id || '.');

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
  'Turn a purchase enquiry into an after-sale one (§25). Open and never '
  'called: converted in place, open interests dropped, today''s assignment '
  'released. Open with calls: closed with close_reason = converted and a new '
  'after-sale enquiry opened. Won, lost or closed: left exactly as it is, and '
  'the student gets an after-sale enquiry beside it (§4.8). The returned id is '
  'the enquiry the call belongs on.';

revoke all on function public.convert_to_after_sale from public;
grant execute on function public.convert_to_after_sale to authenticated;
