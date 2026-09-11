-- §5.8 stage-wise report: how many calls each counsellor made on each day, cut
-- by where the lead was in its life when the call happened.
--
-- The stage of a call is the enquiry's slot count at the time of that call.
-- §4.3 defines a slot as a distinct IST calendar day after the fresh-call day,
-- which is exactly what dense_rank() over call_date gives: rank 1 is the fresh
-- day, rank 2 the first follow-up day, and two calls on the same day share a
-- rank. app.recompute_enquiry() derives follow_up_slots_used the same way
-- (count(distinct call_date) where call_date > min(call_date)), so this is the
-- same rule read a second time rather than a second rule.
--
-- The window must see each enquiry's WHOLE call history, not just the rows in
-- the reporting range — otherwise the first call inside the range would look
-- like a fresh call. So the ranking runs over every call belonging to an
-- enquiry touched in the range, and the range filter is applied afterwards.
--
-- Brief 8 decision (3): the stage columns are a full partition. Every call row
-- lands in exactly one of Fresh / 1st / 2nd / 3rd / After-sale, and those five
-- sum to Total calls. Call backs, Purchased, Competitor and Closed are memo
-- columns cut by outcome — they overlap the stage columns by design and must
-- never be added into the total, which is why the UI labels them "of which".
--
-- Slot 3 absorbs anything beyond it. §4.3 caps slots at three for scheduling,
-- but nothing stops a fourth distinct day being logged after a same-day
-- revival, and a row that does not add up to its own total is worse than a
-- column labelled "3rd or later".

create or replace function public.daily_stage_report(
  p_from date,
  p_to date,
  p_counsellor_id uuid default null
)
returns table (
  day date,
  counsellor_id uuid,
  counsellor_name text,
  fresh_calls integer,
  follow_up_1 integer,
  follow_up_2 integer,
  follow_up_3 integer,
  after_sale_calls integer,
  total_calls integer,
  call_backs integer,
  purchased integer,
  competitor integer,
  closed integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid;
begin
  if not app.is_staff() then
    raise exception 'not authorised to read the reports' using errcode = '42501';
  end if;

  -- Same rule as daily_counsellor_report: an admin may ask about anyone or
  -- everyone, a counsellor only ever sees themselves, whatever they pass.
  if app.is_admin() then
    v_scope := p_counsellor_id;
  else
    v_scope := (select auth.uid());
  end if;

  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  people as (
    select p.id, p.full_name
      from public.profiles p
     where p.is_active
       and (v_scope is null or p.id = v_scope)
  ),
  grid as (
    select d.d, pe.id, pe.full_name from days d cross join people pe
  ),
  -- Every call on an enquiry that was called at least once in the range,
  -- ranked across its whole history. The EXISTS rather than a CTE join keeps
  -- this a semi-join on calls_enquiry_idx; joining two statistics-free CTEs is
  -- how the desk query ended up nested-looping ten million rows.
  ranked as (
    select
      c.called_by,
      c.call_date,
      c.outcome,
      c.enquiry_type,
      dense_rank() over (partition by c.enquiry_id order by c.call_date) - 1 as slot
    from public.calls c
    where exists (
      select 1 from public.calls c2
       where c2.enquiry_id = c.enquiry_id
         and c2.call_date between p_from and p_to
    )
  ),
  stats as (
    select
      r.called_by,
      r.call_date,
      count(*)::integer as total_calls,
      -- The partition. After-sale first: an after-sale enquiry has no §4.3
      -- slots, so its calls belong to their own column and nowhere else.
      count(*) filter (where r.enquiry_type = 'after_sale')::integer
        as after_sale_calls,
      count(*) filter (where r.enquiry_type <> 'after_sale' and r.slot = 0)::integer
        as fresh_calls,
      count(*) filter (where r.enquiry_type <> 'after_sale' and r.slot = 1)::integer
        as follow_up_1,
      count(*) filter (where r.enquiry_type <> 'after_sale' and r.slot = 2)::integer
        as follow_up_2,
      count(*) filter (where r.enquiry_type <> 'after_sale' and r.slot >= 3)::integer
        as follow_up_3,
      -- Memos: cut by outcome, overlapping the stage columns above.
      count(*) filter (where r.outcome = 'call_back')::integer  as call_backs,
      count(*) filter (where r.outcome = 'purchased')::integer  as purchased,
      count(*) filter (where r.outcome = 'competitor')::integer as competitor,
      count(*) filter (where r.outcome = 'closed')::integer     as closed
    from ranked r
    where r.call_date between p_from and p_to
    group by r.called_by, r.call_date
  )
  select
    g.d, g.id, g.full_name,
    coalesce(st.fresh_calls, 0),
    coalesce(st.follow_up_1, 0),
    coalesce(st.follow_up_2, 0),
    coalesce(st.follow_up_3, 0),
    coalesce(st.after_sale_calls, 0),
    coalesce(st.total_calls, 0),
    coalesce(st.call_backs, 0),
    coalesce(st.purchased, 0),
    coalesce(st.competitor, 0),
    coalesce(st.closed, 0)
  from grid g
  left join stats st on st.called_by = g.id and st.call_date = g.d
  order by g.d, g.full_name;
end;
$$;

comment on function public.daily_stage_report is
  '§5.8 stage-wise report: calls per counsellor per day by the enquiry''s slot '
  'count at the time of the call. Fresh + 1st + 2nd + 3rd + After-sale = Total '
  'calls. Call backs / Purchased / Competitor / Closed are memo cuts by '
  'outcome and overlap the stage columns.';

revoke all on function public.daily_stage_report from public;
grant execute on function public.daily_stage_report to authenticated;
