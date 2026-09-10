-- PLI issued: only count a re-grade while the enquiry is still live.
--
-- The editor added in the last change is deliberately not restricted by
-- status, because correcting a wrong term on a won enquiry is legitimate
-- housekeeping. But that opened a way to inflate the report: someone tidying
-- old won or lost records up to importance A would be credited with issuing a
-- price list for each one, months after the fact.
--
-- The audit row carries the whole row as it was written, so the enquiry's
-- status *at the moment of the change* is in new_data — no reconstruction
-- needed. A price list is only ever issued to a lead still in play.

create or replace function public.daily_counsellor_report(
  p_from date,
  p_to date,
  p_counsellor_id uuid default null
)
returns table (
  day date,
  counsellor_id uuid,
  counsellor_name text,
  calls_made integer,
  fresh_handled integer,
  follow_ups_done integer,
  call_backs integer,
  purchased_calls integer,
  purchased_amount numeric,
  competitor integer,
  closed integer,
  pli_issued integer,
  overdue_carried_forward integer
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
  first_call as (
    select distinct on (c.enquiry_id) c.enquiry_id, c.id as call_id
      from public.calls c
     order by c.enquiry_id, c.call_date, c.called_at, c.id
  ),
  call_stats as (
    select
      c.called_by,
      c.call_date,
      count(*)::integer as calls_made,
      count(*) filter (where fc.call_id = c.id)::integer as fresh_handled,
      count(*) filter (
        where c.outcome = 'follow_up' and fc.call_id is distinct from c.id
      )::integer as follow_ups_done,
      count(*) filter (
        where c.outcome = 'call_back' and fc.call_id is distinct from c.id
      )::integer as call_backs,
      count(*) filter (where c.outcome = 'purchased')::integer as purchased_calls,
      count(*) filter (where c.outcome = 'competitor')::integer as competitor,
      count(*) filter (where c.outcome = 'closed')::integer as closed
    from public.calls c
    left join first_call fc on fc.enquiry_id = c.enquiry_id
    where c.call_date between p_from and p_to
    group by c.called_by, c.call_date
  ),
  won_amounts as (
    select c.called_by, c.call_date, sum(i.amount) as amount
      from public.enquiry_items i
      join public.calls c
        on c.enquiry_id = i.enquiry_id
       and c.outcome = 'purchased'
       and c.call_date = (i.won_at at time zone 'Asia/Kolkata')::date
     where i.won_at is not null
       and (i.won_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     group by c.called_by, c.call_date
  ),
  pli as (
    select
      a.actor_id,
      (a.at at time zone 'Asia/Kolkata')::date as d,
      count(*)::integer as n
    from public.audit_log a
    where a.table_name = 'enquiries'
      and a.actor_id is not null
      and a.actor_source <> 'service_role'
      and (a.new_data ->> 'importance') = 'a'
      and (a.action = 'insert' or (a.old_data ->> 'importance') is distinct from 'a')
      -- The status the row had when it was written. Housekeeping on a resolved
      -- enquiry is not a price list.
      and (a.new_data ->> 'status') = 'open'
      and (
        a.action = 'update'
        or not exists (
          select 1
            from public.import_rows ir
           where ir.enquiry_id::text = a.row_pk
        )
      )
      and (a.at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by 1, 2
  ),
  carried as (
    select asg.counsellor_id, asg.date as d, count(*)::integer as n
      from public.assignments asg
      join public.enquiries e on e.id = asg.enquiry_id
     where asg.date between p_from and p_to
       and not exists (
         select 1 from public.calls c
          where c.enquiry_id = asg.enquiry_id
            and c.call_date = asg.date
       )
       and (
         e.closed_at is null
         or (e.closed_at at time zone 'Asia/Kolkata')::date > asg.date
       )
     group by 1, 2
  )
  select
    g.d, g.id, g.full_name,
    coalesce(cs.calls_made, 0),
    coalesce(cs.fresh_handled, 0),
    coalesce(cs.follow_ups_done, 0),
    coalesce(cs.call_backs, 0),
    coalesce(cs.purchased_calls, 0),
    coalesce(wa.amount, 0)::numeric,
    coalesce(cs.competitor, 0),
    coalesce(cs.closed, 0),
    coalesce(pl.n, 0),
    coalesce(ca.n, 0)
  from grid g
  left join call_stats cs on cs.called_by = g.id and cs.call_date = g.d
  left join won_amounts wa on wa.called_by = g.id and wa.call_date = g.d
  left join pli pl on pl.actor_id = g.id and pl.d = g.d
  left join carried ca on ca.counsellor_id = g.id and ca.d = g.d
  order by g.d, g.full_name;
end;
$$;
