-- Brief 38: a purchase lead and a ticket are two conversations, always.
--
-- Brief 25 called this "converting", and the word carried an assumption: that
-- a student is in one pipeline at a time, so becoming an after-sale case means
-- ceasing to be a sales lead. That is not how the phone works. Somebody rings
-- about a video that will not play and mentions they are thinking about the
-- next paper; the complaint and the lead are both real, both live, and both
-- belong to different people on different screens.
--
-- So the switch stops converting and starts opening. Whatever the purchase
-- enquiry is — never called, open with calls, won, lost, closed — it is left
-- exactly as it is, and the call goes to a new after-sale enquiry beside it.
-- Two behaviours go with that:
--
--   * the in-place branch, which rewrote an uncalled lead's type and deleted
--     its interests. It was defensible when the two could not coexist; now it
--     destroys one of the two things we have decided to keep.
--   * close_reason 'converted'. Nothing writes it after this. The enum value
--     stays, because rows already carry it and history is not ours to edit.
--
-- And the mirror, which never existed: the same call from the other side.

create or replace function public.convert_to_after_sale(p_enquiry_id bigint)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  enq public.enquiries%rowtype;
  v_new bigint;
begin
  if not app.is_staff() then
    raise exception 'not authorised to open a ticket from this enquiry'
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
  -- that is already after-sale needs nothing doing to it.
  if enq.type = 'after_sale' then
    return p_enquiry_id;
  end if;

  -- A ticket already open for this student is the ticket this call belongs
  -- to. Opening a second one would split one complaint across two records.
  select e.id into v_new
    from public.enquiries e
   where e.student_id = enq.student_id
     and e.type = 'after_sale'
     and e.status in ('open', 'escalated')
     and e.archived_at is null
   order by e.id desc
   limit 1;

  if v_new is null then
    insert into public.enquiries (
      student_id, type, source_id, term_id, status, created_by
    )
    values (
      enq.student_id, 'after_sale', enq.source_id, enq.term_id, 'open',
      (select auth.uid())
    )
    returning id into v_new;

    -- Both ends of the story say so, so either enquiry read on its own
    -- explains the other. The purchase enquiry is untouched apart from this
    -- line, which is a note about where a call went, not a change to it.
    insert into public.enquiry_sources (enquiry_id, source_id, note)
    values (p_enquiry_id, enq.source_id,
            'After-sale call logged on enquiry #' || v_new
            || '; this enquiry was left as it was.'),
           (v_new, enq.source_id,
            'Opened from ' || enq.status::text || ' purchase enquiry #'
            || p_enquiry_id || '.');
  end if;

  -- Assigned to whoever is making the call, for today (§25). Nothing reads it
  -- on My Day — Tickets is its own list — but the desk's history of who held
  -- what is the poorer without it.
  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  values (v_new, app.ist_today(), (select auth.uid()), 'fresh', (select auth.uid()))
  on conflict (enquiry_id, date) do nothing;

  return v_new;
end;
$function$;

comment on function public.convert_to_after_sale is
  'Brief 38.1. Opens (or finds) the student''s after-sale enquiry so a call can '
  'be logged there. The purchase enquiry is never altered, whatever state it '
  'is in — the two pipelines coexist.';

revoke all on function public.convert_to_after_sale from public;
grant execute on function public.convert_to_after_sale to authenticated;

-- ---------------------------------------------------------------------------
-- The mirror (Brief 38.2)
--
-- Somebody rings about a delivery and asks what is coming for the next paper.
-- The ticket is not finished and must not be touched; the sales conversation
-- needs somewhere to live. Term is deliberately left blank: the ticket's term
-- is the one they already bought for, and carrying it onto a new lead would
-- put words in the student's mouth about which paper they are asking about.
-- ---------------------------------------------------------------------------
create or replace function public.convert_to_purchase(p_enquiry_id bigint)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  enq public.enquiries%rowtype;
  v_new bigint;
begin
  if not app.is_staff() then
    raise exception 'not authorised to open a lead from this enquiry'
      using errcode = '42501';
  end if;

  select * into enq from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id using errcode = 'P0002';
  end if;
  if enq.archived_at is not null then
    raise exception 'enquiry % is archived', p_enquiry_id using errcode = '22023';
  end if;

  if enq.type = 'purchase' then
    return p_enquiry_id;
  end if;

  -- An open lead already exists: this call belongs to it rather than to a
  -- second one. Same rule as the other direction, for the same reason.
  select e.id into v_new
    from public.enquiries e
   where e.student_id = enq.student_id
     and e.type = 'purchase'
     and e.status = 'open'
     and e.archived_at is null
   order by e.id desc
   limit 1;

  if v_new is null then
    insert into public.enquiries (
      student_id, type, source_id, term_id, status, created_by
    )
    values (
      enq.student_id, 'purchase', enq.source_id, null, 'open',
      (select auth.uid())
    )
    returning id into v_new;

    insert into public.enquiry_sources (enquiry_id, source_id, note)
    values (p_enquiry_id, enq.source_id,
            'Purchase call logged on enquiry #' || v_new
            || '; this ticket was left as it was.'),
           (v_new, enq.source_id,
            'Opened from after-sale enquiry #' || p_enquiry_id || '.');
  end if;

  -- A purchase enquiry *is* assignment-backed, so the caller holds it today:
  -- without this it would land in the New Calls pool as work nobody owns,
  -- moments after somebody actually spoke to them.
  insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
  values (v_new, app.ist_today(), (select auth.uid()), 'fresh', (select auth.uid()))
  on conflict (enquiry_id, date) do nothing;

  return v_new;
end;
$function$;

comment on function public.convert_to_purchase is
  'Brief 38.2. Opens (or finds) the student''s purchase enquiry so a call can '
  'be logged there. The ticket is never altered. Term is left blank on a new '
  'lead: the ticket''s term is what they already bought.';

revoke all on function public.convert_to_purchase from public;
grant execute on function public.convert_to_purchase to authenticated;
