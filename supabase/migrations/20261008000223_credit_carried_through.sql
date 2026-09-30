-- §77.3. Carry credited_to down the CTE chain.
--
-- 222 keyed the purchase count and the amount on coalesce(credited_to, called_by)
-- but never selected credited_to into `slotted`, which lists its columns rather
-- than taking calls.*, so the function failed on every call with "column
-- c.credited_to does not exist". `classified` lists its columns too, so it needed
-- the same. Everything else is 222 unchanged.

CREATE OR REPLACE FUNCTION public.call_report(p_from date, p_to date, p_counsellor_id uuid DEFAULT NULL::uuid, p_grain text DEFAULT 'day'::text)
 RETURNS TABLE(grain_key text, grain_label text, is_total boolean, new_calls integer, offers integer, follow_up_1 integer, follow_up_2 integer, follow_up_3 integer, customised integer, tickets integer, stage_new integer, stage_fu1 integer, stage_fu2 integer, stage_fu3 integer, stage_after_sale integer, total_calls integer, out_follow_up integer, out_call_back integer, out_purchased integer, out_competitor integer, out_closed integer, out_after_sale integer, total_outcomes integer, customers_purchased integer, purchase_amount numeric, pli_issued integer, mismatch boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_scope uuid;
begin
  if not app.is_staff() then
    raise exception 'not authorised to read the reports' using errcode = '42501';
  end if;

  if app.is_admin() then
    v_scope := p_counsellor_id;
  else
    v_scope := (select auth.uid());
  end if;

  return query
  with
  -- The slot a call sits at (§4.3): the rank of its day among the enquiry's
  -- distinct call days. The window runs over the enquiry's whole history and
  -- the range filter is applied afterwards — filtering first would renumber
  -- the slots inside the range and call a third follow-up a fresh call.
  slotted as (
    select
      c.id,
      c.enquiry_id,
      c.call_date,
      c.called_by,
      c.outcome,
      c.enquiry_type,
      c.is_offer_call,
      -- §70.1. Recorded at logCall time where it is known; null for every call
      -- that predates the column, which the bucket resolution below allows for.
      c.assignment_id,
      c.assignment_bucket,
      -- §77.3. Who the sale belongs to, carried down to the aggregates.
      c.credited_to,
      (dense_rank() over (partition by c.enquiry_id order by c.call_date) - 1) as slot
    from public.calls c
  ),
  -- Every call in range, classified exactly once. The CASE is ordered, so the
  -- first arm that matches wins and no call can land in two columns.
  -- §70.1. The assignment each call was made under, resolved in one place.
  --
  -- Recorded on the call where we know it. Otherwise inferred, in the order the
  -- question is actually asked: the caller's own standing assignment on this
  -- enquiry, then whatever the enquiry was handed out as that day whoever it
  -- went to, then nothing. The middle step alone is what this used to do, and
  -- on its own it was wrong — a lead given to one counsellor as a campaign and
  -- rung by another was filed under a batch the caller was never handed.
  under as (
    select
      s.*,
      coalesce(
        -- §70.1. The bucket as it stood when the call was made. First, because
        -- the assignment row it names is mutable: the desk upserts on
        -- (enquiry_id, date), so a six o'clock re-assignment rewrites the
        -- morning's bucket and would otherwise rewrite the morning's report.
        s.assignment_bucket,
        (select a.bucket from public.assignments a where a.id = s.assignment_id),
        -- §71. The caller's own standing assignment used to sit here, ahead of
        -- the day's. It was a workaround for calls that recorded nothing, and it
        -- guessed badly: it would reach back to a lead's assignment from two days
        -- earlier rather than admit it did not know. The §71 backfill replayed
        -- the audit log onto all 207 calls that had a knowable answer, and on the
        -- 305 calls in the table removing this branch changes not one bucket —
        -- the 98 still unattributed are each the claim their own call created a
        -- millisecond later, which the day's assignment below resolves correctly.
        (select a.bucket from public.assignments a
          where a.enquiry_id = s.enquiry_id and a.date = s.call_date)
      ) as bucket
      from slotted s
     where s.call_date between p_from and p_to
       and (v_scope is null or s.called_by = v_scope)
  ),
  classified as (
    select
      s.id,
      s.called_by,
      s.call_date,
      s.enquiry_id,
      s.outcome,
      s.credited_to,
      case
        -- After-sale work is Tickets whatever it is assigned as.
        when s.enquiry_type = 'after_sale' then 'tickets'
        -- §70.1. The call's own assignment, not merely one that existed that day.
        when s.is_offer_call or s.bucket = 'offer' then 'offers'
        when s.bucket = 'campaign' then 'customised'
        -- Everything else, including calls nobody was assigned, by slot.
        when s.slot = 0 then 'new_calls'
        when s.slot = 1 then 'follow_up_1'
        when s.slot = 2 then 'follow_up_2'
        else 'follow_up_3'
      end as call_type,
      -- §70.2. Where the call sat on the ladder, whatever it was handed out as.
      -- Every call lands in exactly one of these, so the block totals to the
      -- same number as Calls by type without agreeing with it column by column.
      case
        when s.enquiry_type = 'after_sale' then 'stage_after_sale'
        when s.slot = 0 then 'stage_new'
        when s.slot = 1 then 'stage_fu1'
        when s.slot = 2 then 'stage_fu2'
        else 'stage_fu3'
      end as call_stage
    from under s
  ),
  -- The grain key, chosen once so every aggregate below groups the same way.
  keyed as (
    select
      case when p_grain = 'counsellor' then c.called_by::text
           else c.call_date::text end as k,
      -- §77.3. The sale's own key. At the day grain it is the same date either
      -- way; at the counsellor grain it is whoever the sale was credited to,
      -- falling back to the caller when nobody was named.
      case when p_grain = 'counsellor' then coalesce(c.credited_to, c.called_by)::text
           else c.call_date::text end as sale_k,
      c.*
    from classified c
  ),
  -- §77.3. Purchases counted on the sale's key rather than the call's, so a sale
  -- credited elsewhere leaves the caller's purchase count and joins the other
  -- person's. Separate from calls_agg because the two group differently — one
  -- row cannot be in two groups at once.
  sales_agg as (
    select
      sale_k as k,
      grouping(sale_k) = 1 as is_total,
      count(distinct enquiry_id) filter (where outcome = 'purchased')::integer
        as customers_purchased
    from keyed
    group by grouping sets ((sale_k), ())
  ),
  calls_agg as (
    select
      k,
      grouping(k) = 1 as is_total,
      count(*) filter (where call_type = 'new_calls')::integer    as new_calls,
      count(*) filter (where call_type = 'offers')::integer       as offers,
      count(*) filter (where call_type = 'follow_up_1')::integer  as follow_up_1,
      count(*) filter (where call_type = 'follow_up_2')::integer  as follow_up_2,
      count(*) filter (where call_type = 'follow_up_3')::integer  as follow_up_3,
      count(*) filter (where call_type = 'customised')::integer   as customised,
      count(*) filter (where call_type = 'tickets')::integer      as tickets,
      count(*) filter (where call_stage = 'stage_new')::integer   as stage_new,
      count(*) filter (where call_stage = 'stage_fu1')::integer   as stage_fu1,
      count(*) filter (where call_stage = 'stage_fu2')::integer   as stage_fu2,
      count(*) filter (where call_stage = 'stage_fu3')::integer   as stage_fu3,
      count(*) filter (where call_stage = 'stage_after_sale')::integer as stage_after_sale,
      count(*)::integer                                           as total_calls,
      count(*) filter (where outcome = 'follow_up')::integer      as out_follow_up,
      count(*) filter (where outcome = 'call_back')::integer      as out_call_back,
      count(*) filter (where outcome = 'purchased')::integer      as out_purchased,
      count(*) filter (where outcome = 'competitor')::integer     as out_competitor,
      count(*) filter (where outcome in ('closed','not_interested'))::integer         as out_closed,
      count(*) filter (where outcome in ('noted','working','escalated','pending_institute','resolved'))::integer
                                                                  as out_after_sale,
      -- §77.3. customers_purchased moved to sales_agg, which groups on the
      -- sale's key rather than the caller's.
      0::integer as unused_purchased
    from keyed
    group by grouping sets ((k), ())
  ),
  -- Amounts are attributed to the call that won them: the purchased call on
  -- the item's won day. §5.8 has credited the day's revenue this way since
  -- Brief 6.
  amounts as (
    select
      -- §77.3. The money follows the sale, not the caller.
      case when p_grain = 'counsellor' then coalesce(c.credited_to, c.called_by)::text
           else c.call_date::text end as k,
      grouping(case when p_grain = 'counsellor' then coalesce(c.credited_to, c.called_by)::text
                    else c.call_date::text end) = 1 as is_total,
      coalesce(sum(i.amount), 0)::numeric as purchase_amount
    from public.enquiry_items i
    join public.calls c
      on c.enquiry_id = i.enquiry_id
     and c.outcome = 'purchased'
     and c.call_date = (i.won_at at time zone 'Asia/Kolkata')::date
    where i.won_at is not null
      and (i.won_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      -- §77.3. A counsellor looking at their own report sees the sales credited
      -- to them, which is what their number is.
      and (v_scope is null or coalesce(c.credited_to, c.called_by) = v_scope)
    group by grouping sets ((1), ())
  ),
  -- PLI: an enquiries row re-graded to A by a person, excluding imports.
  -- Unchanged from migration 0018; only the grouping key differs.
  pli as (
    select
      case when p_grain = 'counsellor' then a.actor_id::text
           else (a.at at time zone 'Asia/Kolkata')::date::text end as k,
      grouping(case when p_grain = 'counsellor' then a.actor_id::text
                    else (a.at at time zone 'Asia/Kolkata')::date::text end) = 1 as is_total,
      count(*)::integer as pli_issued
    from public.audit_log a
    where a.table_name = 'enquiries'
      and a.actor_id is not null
      and a.actor_source <> 'service_role'
      and (a.new_data ->> 'importance') = 'a'
      and (a.action = 'insert' or (a.old_data ->> 'importance') is distinct from 'a')
      and (
        a.action = 'update'
        or not exists (
          select 1 from public.import_rows ir where ir.enquiry_id::text = a.row_pk
        )
      )
      and (a.at at time zone 'Asia/Kolkata')::date between p_from and p_to
      and (v_scope is null or a.actor_id = v_scope)
    group by grouping sets ((1), ())
  ),
  -- Every row the table should show, even the empty ones: a day with no calls
  -- is a fact about the week, and a counsellor with none is a fact about the
  -- team.
  grid as (
    select d::date::text as k, to_char(d, 'YYYY-MM-DD') as label, false as is_total
      from generate_series(p_from, p_to, interval '1 day') d
     where p_grain = 'day'
    union all
    select pr.id::text, coalesce(pr.full_name, '(no name)'), false
      from public.profiles pr
     where p_grain = 'counsellor'
       and pr.is_active
       and (v_scope is null or pr.id = v_scope)
    union all
    select null, 'Total', true
  )
  select
    g.k,
    g.label,
    g.is_total,
    coalesce(ca.new_calls, 0),
    coalesce(ca.offers, 0),
    coalesce(ca.follow_up_1, 0),
    coalesce(ca.follow_up_2, 0),
    coalesce(ca.follow_up_3, 0),
    coalesce(ca.customised, 0),
    coalesce(ca.tickets, 0),
    -- §70.2. Calls by stage, projected next to Calls by type.
    coalesce(ca.stage_new, 0),
    coalesce(ca.stage_fu1, 0),
    coalesce(ca.stage_fu2, 0),
    coalesce(ca.stage_fu3, 0),
    coalesce(ca.stage_after_sale, 0),
    coalesce(ca.total_calls, 0),
    coalesce(ca.out_follow_up, 0),
    coalesce(ca.out_call_back, 0),
    coalesce(ca.out_purchased, 0),
    coalesce(ca.out_competitor, 0),
    coalesce(ca.out_closed, 0),
    coalesce(ca.out_after_sale, 0),
    coalesce(ca.out_follow_up, 0) + coalesce(ca.out_call_back, 0)
      + coalesce(ca.out_purchased, 0) + coalesce(ca.out_competitor, 0)
      + coalesce(ca.out_closed, 0) + coalesce(ca.out_after_sale, 0),
    coalesce(sa.customers_purchased, 0),
    coalesce(am.purchase_amount, 0),
    coalesce(pl.pli_issued, 0),
    -- The assertion. These two count the same calls two ways, so they cannot
    -- differ unless an outcome has been added to the enum without being added
    -- to the CASE above. Carried per row so the screen can say which row.
    coalesce(ca.total_calls, 0) <> (
      coalesce(ca.out_follow_up, 0) + coalesce(ca.out_call_back, 0)
        + coalesce(ca.out_purchased, 0) + coalesce(ca.out_competitor, 0)
        + coalesce(ca.out_closed, 0) + coalesce(ca.out_after_sale, 0)
    )
  from grid g
  left join calls_agg ca on ca.is_total = g.is_total
                        and (g.is_total or ca.k = g.k)
  left join sales_agg sa on sa.is_total = g.is_total
                       and (g.is_total or sa.k = g.k)
  left join amounts am on am.is_total = g.is_total
                      and (g.is_total or am.k = g.k)
  left join pli pl on pl.is_total = g.is_total
                  and (g.is_total or pl.k = g.k)
  -- Ordered by what it prints, not by what it groups on: the label is the
  -- date at the day grain and the name at the counsellor grain, and both sort
  -- the way the reader expects. The key would put the team in uuid order.
  order by g.is_total, g.label;
end;
$function$
;;

grant execute on function public.call_report(date, date, uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
