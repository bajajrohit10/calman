-- §89. The competitor follows the lost reason, and the capture RPC.
--
-- app.recompute_enquiry is the only writer of enquiries.lost_reason, so it is
-- also the only place that can keep competitor_id/competitor_other honest
-- against it. See the comment inside.

CREATE OR REPLACE FUNCTION app.recompute_enquiry(p_enquiry_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  enq public.enquiries%rowtype;
  v_fresh date;
  v_fresh_slot date;
  v_last_slot date;
  v_slots integer := 0;
  v_last public.calls%rowtype;
  v_priority smallint;
  v_items_total integer := 0;
  v_items_open integer := 0;
  v_items_won integer := 0;
  v_items_competitor integer := 0;
  v_status public.enquiry_status;
  v_lost public.lost_reason;
  v_close public.close_reason;
  v_next date;
begin
  select * into enq
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    return;
  end if;

  -- A superseded enquiry was closed by a human decision in §5.1, not by call
  -- history. Never recompute it back open.
  if enq.status = 'closed'
     and (enq.close_reason in ('superseded', 'converted', 'handed_to_support',
                                -- §68.2. Labelled by the branch below, and just
                                -- as settled as a hand-off.
                                'resolved')
          -- §66.3. A closed after-sale enquiry with no reason recorded. The
          -- close was somebody's decision even though nothing wrote down why,
          -- and `null in (...)` above would never have caught it.
          or (enq.type = 'after_sale' and enq.close_reason is null)) then
    return;
  end if;

  select min(c.call_date), max(c.call_date)
    into v_fresh, v_last_slot
    from public.calls c
   where c.enquiry_id = p_enquiry_id;

  -- A slot is a calendar day AFTER the fresh-call day, so same-day repeat
  -- calls collapse into one and the fresh day itself never counts (§4.3).
  --
  -- Offer calls are outside the rule entirely (§23.2). An offer is a reason to
  -- ring somebody that has nothing to do with how far down the follow-up
  -- ladder they are, and spending a slot on one would mean a lead could be
  -- talked out of the pipeline by an offer we ourselves decided to run. So
  -- both ends of the count skip them: the fresh day the slots are measured
  -- from is the first *ordinary* call, and only ordinary days count after it.
  --
  -- fresh_call_date itself still comes from every call, offer ones included —
  -- it answers "has anybody spoken to this lead", and after an offer call the
  -- answer is yes.
  select min(c.call_date)
    into v_fresh_slot
    from public.calls c
   where c.enquiry_id = p_enquiry_id
     and not c.is_offer_call;

  select count(distinct c.call_date)
    into v_slots
    from public.calls c
   where c.enquiry_id = p_enquiry_id
     and not c.is_offer_call
     and c.call_date > v_fresh_slot;

  select c.* into v_last
    from public.calls c
   where c.enquiry_id = p_enquiry_id
   order by c.call_date desc, c.called_at desc, c.id desc
   limit 1;

  select count(*),
         count(*) filter (where i.status = 'open'),
         count(*) filter (where i.status = 'won'),
         count(*) filter (where i.status = 'competitor')
    into v_items_total, v_items_open, v_items_won, v_items_competitor
    from public.enquiry_items i
   where i.enquiry_id = p_enquiry_id;

  -- Best (lowest) content priority across still-open items, so §6 can sort
  -- the recommended list on enquiries alone rather than joining items.
  select min(ct.priority)
    into v_priority
    from public.enquiry_items i
    join public.contents ct on ct.id = i.content_id
   where i.enquiry_id = p_enquiry_id
     and i.status = 'open';

  if v_last.id is null then
    -- No calls yet: a fresh import or quick-add.
    v_status := 'open';
    v_next := enq.next_follow_up_date;

  elsif v_last.outcome = 'ticket_raised' then
    -- §78. The lead went to Support. Closed, and said so.
    v_status := 'closed';
    v_close  := 'handed_to_support';
    v_next   := null;

  elsif enq.type = 'after_sale' then
    -- §10 decision 4. The reminder date is carried, but after-sale enquiries
    -- never enter a §6 bucket — the Tickets screen (§5.11) reads them.
    v_status := case v_last.outcome
                  when 'noted' then 'open'::public.enquiry_status
                  when 'working' then 'working'::public.enquiry_status
                  when 'escalated' then 'escalated'::public.enquiry_status
                  when 'pending_institute' then 'pending_institute'::public.enquiry_status
                  when 'resolved' then 'closed'::public.enquiry_status
                end;
    -- §68.2. A resolved complaint closes for a reason, and now says so.
    if v_last.outcome = 'resolved' then
      v_close := 'resolved';
    end if;
    v_next := v_last.next_follow_up_date;

  elsif v_last.outcome = 'closed' then
    v_status := 'closed';
    v_close := 'wrong_number';          -- §4.7, the only import-flagging close
    v_next := null;

  elsif v_last.outcome = 'not_interested' then
    -- §47.3. The student said no. Lost, with the reason they gave, and
    -- from here indistinguishable from any other lost lead.
    v_status := 'lost';
    v_lost := 'not_interested';
    v_next := null;

  elsif v_last.outcome = 'competitor' then
    v_status := 'lost';
    v_lost := 'competitor';
    v_next := null;

  elsif v_last.outcome = 'purchased' then
    -- §4.5, as corrected by §10 decision 6: "no open items remain" is not
    -- enough to call it won — at least one item has to have been won.
    if v_items_open > 0 then
      v_status := 'open';
      v_next := v_last.next_follow_up_date;
    elsif v_items_won > 0 or v_items_total = 0 then
      v_status := 'won';
      v_next := null;
    elsif v_items_competitor > 0 then
      v_status := 'lost';
      v_lost := 'competitor';
      v_next := null;
    else
      v_status := 'lost';
      v_lost := 'dropped';
      v_next := null;
    end if;

  else
    -- follow_up | call_back
    if v_slots >= 3 then
      v_status := 'lost';
      v_lost := 'max_followups';
      v_next := null;
    else
      v_status := 'open';
      v_next := v_last.next_follow_up_date;
    end if;
  end if;

  update public.enquiries e
     set status = v_status,
         lost_reason = case when v_status = 'lost' then v_lost end,
         -- §89. The competitor named on the lead lives exactly as long as the
         -- reason it explains. Three things happen here:
         --
         --   * a lead that stops being a competitor loss loses both columns,
         --     which is the brief's "clear both if the lost reason changes
         --     away from competitor" — and this is the only place that can do
         --     it, because this is the only place lost_reason is written;
         --   * a competitor loss that already names one keeps it, so the
         --     recompute fired by an edited note does not wipe the answer;
         --   * a competitor loss that names neither gets the fallback row.
         --     That last case is not the counsellor's: the panel refuses to
         --     save a competitor call without an answer. It is the derived
         --     loss above — every item marked Competitor after a `purchased`
         --     call, which no picker sits in front of — and without a value
         --     there the "exactly one" constraint would reject the update and
         --     a legitimate item edit would fail.
         competitor_id = case
           when v_status = 'lost' and v_lost = 'competitor'
             then coalesce(e.competitor_id,
                    case when e.competitor_other is null
                           then (select c2.id from public.competitors c2
                                  where c2.is_fallback) end)
           end,
         competitor_other = case
           when v_status = 'lost' and v_lost = 'competitor' then e.competitor_other
           end,
         close_reason = case when v_status = 'closed' then coalesce(v_close, e.close_reason) end,
         next_follow_up_date = v_next,
         fresh_call_date = v_fresh,
         follow_up_slots_used = v_slots,
         last_slot_date = v_last_slot,
         top_content_priority = v_priority,
         closed_at = case
                       when v_status in ('won', 'lost', 'closed') then coalesce(e.closed_at, now())
                     end
   where e.id = p_enquiry_id;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Capture.
-- ---------------------------------------------------------------------------

/*
 * §89. Record which competitor took a lead.
 *
 * Called after the call is written, not before: the first half of the
 * constraint only lets a competitor sit on a lead whose lost reason is already
 * `competitor`, and that reason is derived from the call. So the order is
 * always write the call, let the recompute settle the status, then say who.
 *
 * Exactly one of the two arguments, and the enquiry has to be a competitor
 * loss — both re-checked here rather than only in the action, because the
 * action is one caller and the report is built on what lands in the table.
 */
create or replace function public.set_enquiry_competitor(
  p_enquiry_id bigint,
  p_competitor_id uuid default null,
  p_competitor_other text default null
) returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_other text := nullif(btrim(coalesce(p_competitor_other, '')), '');
  v_lost public.lost_reason;
begin
  if (p_competitor_id is null) = (v_other is null) then
    raise exception 'name one competitor: either a listed one or a typed name, not both and not neither';
  end if;

  select e.lost_reason into v_lost
    from public.enquiries e where e.id = p_enquiry_id;
  if not found then
    raise exception 'enquiry % not found', p_enquiry_id;
  end if;
  if v_lost is distinct from 'competitor' then
    raise exception 'enquiry % is not a competitor loss', p_enquiry_id;
  end if;

  if p_competitor_id is not null
     and not exists (select 1 from public.competitors c where c.id = p_competitor_id) then
    raise exception 'no such competitor';
  end if;

  -- Both in one statement: setting them in two would pass through the state
  -- the "not both" constraint exists to forbid.
  update public.enquiries e
     set competitor_id = p_competitor_id,
         competitor_other = v_other
   where e.id = p_enquiry_id;
end $fn$;

grant execute on function public.set_enquiry_competitor to authenticated;

-- ---------------------------------------------------------------------------
-- Settings → Competitors: the typed names, and the two ways to clear them up.
-- ---------------------------------------------------------------------------

/* Every name somebody typed, with how many leads carry it. */
create or replace function public.competitor_typed_names()
returns table (name text, leads bigint)
language sql
stable
security invoker
set search_path to ''
as $fn$
  select e.competitor_other, count(*)
    from public.enquiries e
   where e.competitor_other is not null
   group by e.competitor_other
   order by count(*) desc, e.competitor_other;
$fn$;

grant execute on function public.competitor_typed_names to authenticated;

/*
 * §89. A typed name turns out to be a real competitor: list it, and re-point
 * every lead that named it.
 *
 * One function rather than "create it in Settings, then merge into it", because
 * the two halves have to happen together — a promoted name that failed to
 * re-point its leads would read as a competitor with no losses.
 *
 * Admin only, and in one transaction. The enquiries audit trigger records each
 * re-pointed lead, which is the trail that makes a bulk edit reviewable.
 */
create or replace function public.promote_competitor_other(
  p_name text,
  p_new_name text default null
) returns uuid
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_new text := coalesce(nullif(btrim(coalesce(p_new_name, '')), ''), v_name);
  v_id uuid;
  v_next integer;
begin
  if not (select app.is_admin()) then
    raise exception 'only a manager or super admin can change the competitor list';
  end if;
  if v_name is null then
    raise exception 'which typed name?';
  end if;

  select c.id into v_id from public.competitors c where lower(c.name) = lower(v_new);
  if v_id is null then
    select coalesce(max(c.sort_order), 0) + 10 into v_next from public.competitors c;
    insert into public.competitors (name, sort_order)
    values (v_new, v_next)
    returning id into v_id;
  end if;

  update public.enquiries e
     set competitor_id = v_id,
         competitor_other = null
   where e.competitor_other = v_name;

  return v_id;
end $fn$;

grant execute on function public.promote_competitor_other to authenticated;

/* The same re-point, into a competitor that is already listed. */
create or replace function public.merge_competitor_other(
  p_name text,
  p_competitor_id uuid
) returns bigint
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_n bigint;
begin
  if not (select app.is_admin()) then
    raise exception 'only a manager or super admin can change the competitor list';
  end if;
  if v_name is null then
    raise exception 'which typed name?';
  end if;
  if not exists (select 1 from public.competitors c where c.id = p_competitor_id) then
    raise exception 'no such competitor';
  end if;

  with moved as (
    update public.enquiries e
       set competitor_id = p_competitor_id,
           competitor_other = null
     where e.competitor_other = v_name
    returning 1
  )
  select count(*) into v_n from moved;

  return v_n;
end $fn$;

grant execute on function public.merge_competitor_other to authenticated;
