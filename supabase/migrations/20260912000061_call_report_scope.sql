-- call_report reads what the caller is allowed to read, and pins who that is.
--
-- 0058 made it security invoker, which was wrong on two counts that only show
-- up from a counsellor's login:
--
--   * PLI issued read zero for everybody who is not an admin. It counts rows
--     in audit_log, and audit_log's only select policy is app.is_admin() — so
--     a counsellor's own report quietly understated their own PLI. The two
--     reports this replaced were both security definer for exactly this
--     reason.
--   * The scope was enforced only by the page. /reports pins a counsellor to
--     themselves before it calls, but the RPC took whatever it was given, and
--     a query string is not a permission.
--
-- So: security definer, staff-only, and the same rule the old reports used —
-- an admin may ask about anyone or everyone, a counsellor only ever sees
-- themselves, whatever they pass.
--
-- Restated in full rather than patched: the language changes with it, and a
-- regex over a function body that is becoming a different kind of function is
-- not a patch anybody could check.

create or replace function public.call_report(
  p_from date,
  p_to date,
  p_counsellor_id uuid default null,
  p_grain text default 'day'          -- 'day' | 'counsellor'
)
returns table (
  grain_key text,
  grain_label text,
  is_total boolean,
  -- A. by type
  new_calls integer,
  offers integer,
  follow_up_1 integer,
  follow_up_2 integer,
  follow_up_3 integer,
  customised integer,
  tickets integer,
  total_calls integer,
  -- B. by outcome
  out_follow_up integer,
  out_call_back integer,
  out_purchased integer,
  out_competitor integer,
  out_closed integer,
  out_after_sale integer,
  total_outcomes integer,
  -- C. results
  customers_purchased integer,
  purchase_amount numeric,
  pli_issued integer,
  -- The assertion, carried per row so the screen can mark it.
  mismatch boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
      (dense_rank() over (partition by c.enquiry_id order by c.call_date) - 1) as slot
    from public.calls c
  ),
  -- Every call in range, classified exactly once. The CASE is ordered, so the
  -- first arm that matches wins and no call can land in two columns.
  classified as (
    select
      s.id,
      s.called_by,
      s.call_date,
      s.enquiry_id,
      s.outcome,
      case
        -- After-sale work is Tickets whatever it is assigned as.
        when s.enquiry_type = 'after_sale' then 'tickets'
        -- Then what it was handed out as on the day it was called. Not today's
        -- assignment: a report row for last Tuesday has to read Tuesday's.
        when a.bucket = 'offer'    then 'offers'
        when a.bucket = 'campaign' then 'customised'
        -- Everything else, including calls nobody was assigned, by slot.
        when s.slot = 0 then 'new_calls'
        when s.slot = 1 then 'follow_up_1'
        when s.slot = 2 then 'follow_up_2'
        else 'follow_up_3'
      end as call_type
    from slotted s
    left join public.assignments a
      on a.enquiry_id = s.enquiry_id
     and a.date = s.call_date
    where s.call_date between p_from and p_to
      and (v_scope is null or s.called_by = v_scope)
  ),
  -- The grain key, chosen once so every aggregate below groups the same way.
  keyed as (
    select
      case when p_grain = 'counsellor' then c.called_by::text
           else c.call_date::text end as k,
      c.*
    from classified c
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
      count(*)::integer                                           as total_calls,
      count(*) filter (where outcome = 'follow_up')::integer      as out_follow_up,
      count(*) filter (where outcome = 'call_back')::integer      as out_call_back,
      count(*) filter (where outcome = 'purchased')::integer      as out_purchased,
      count(*) filter (where outcome = 'competitor')::integer     as out_competitor,
      count(*) filter (where outcome = 'closed')::integer         as out_closed,
      count(*) filter (where outcome in ('noted','escalated','resolved'))::integer
                                                                  as out_after_sale,
      count(distinct enquiry_id) filter (where outcome = 'purchased')::integer
                                                                  as customers_purchased
    from keyed
    group by grouping sets ((k), ())
  ),
  -- Amounts are attributed to the call that won them: the purchased call on
  -- the item's won day. §5.8 has credited the day's revenue this way since
  -- Brief 6.
  amounts as (
    select
      case when p_grain = 'counsellor' then c.called_by::text
           else c.call_date::text end as k,
      grouping(case when p_grain = 'counsellor' then c.called_by::text
                    else c.call_date::text end) = 1 as is_total,
      coalesce(sum(i.amount), 0)::numeric as purchase_amount
    from public.enquiry_items i
    join public.calls c
      on c.enquiry_id = i.enquiry_id
     and c.outcome = 'purchased'
     and c.call_date = (i.won_at at time zone 'Asia/Kolkata')::date
    where i.won_at is not null
      and (i.won_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      and (v_scope is null or c.called_by = v_scope)
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
    coalesce(ca.customers_purchased, 0),
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
  left join amounts am on am.is_total = g.is_total
                      and (g.is_total or am.k = g.k)
  left join pli pl on pl.is_total = g.is_total
                  and (g.is_total or pl.k = g.k)
  -- Ordered by what it prints, not by what it groups on: the label is the
  -- date at the day grain and the name at the counsellor grain, and both sort
  -- the way the reader expects. The key would put the team in uuid order.
  order by g.is_total, g.label;
end;
$function$;

comment on function public.call_report is
  'Two tables, one column layout (§5.8). Every call is classified exactly once '
  'by type and once by outcome, so total_calls and total_outcomes must agree; '
  'mismatch says so per row. p_grain is ''day'' or ''counsellor''. Security '
  'definer so PLI can be read out of the admin-only audit log; a counsellor is '
  'pinned to their own numbers whatever they pass.';

revoke all on function public.call_report from public;
grant execute on function public.call_report to authenticated;
