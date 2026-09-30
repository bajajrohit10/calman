-- §76. The desk grid reads the shared pending rule.
--
-- CREATE OR REPLACE: the signature and returned columns are unchanged.

CREATE OR REPLACE FUNCTION public.my_day_team(p_date date DEFAULT NULL::date)
 RETURNS TABLE(counsellor_id uuid, counsellor_name text, new_pending integer, new_total integer, offer_pending integer, offer_total integer, assigned_pending integer, assigned_total integer, custom_pending integer, custom_total integer, tickets_pending integer, tickets_total integer, total_pending integer, total_total integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d
),
staff as (
  select p.id, coalesce(p.full_name, '(no name)') as name
    from public.profiles p
   where p.is_active
     and p.role <> 'ticket_team'
),
-- The same test my_day_pending_count uses: assigned on the day, and no call
-- on that day since it was handed over. A carried row is not pending either —
-- the work has moved to another date and saying otherwise would have a
-- manager reallocating something that is already somewhere else.
assigned as (
  select
    a.counsellor_id,
    a.bucket,
    -- §76. The one definition, shared with my_day_pending_count and agreeing with
    -- my_day(). It used to be written out here without the status test, which is
    -- how this grid came to show five still-to-do that My Day did not have at all.
    app.assignment_is_pending(a.enquiry_id, a.assigned_at, a.carried_to, e.status, t.d)
      as is_pending
  from public.assignments a
  join public.live_enquiries e on e.id = a.enquiry_id
  cross join target t
  where a.date = t.d
    and e.type = 'purchase'
    -- §76. And the totals follow the same reading of the day as My Day's: a lead
    -- closed by a call that day stays, as Done; one closed with no call on the day
    -- was never this day's work and leaves the count entirely.
    and app.assignment_in_day(a.enquiry_id, a.assigned_at, e.status, t.d)
),
agg as (
  select
    counsellor_id,
    count(*) filter (where bucket = 'fresh' and is_pending)::integer as new_pending,
    count(*) filter (where bucket = 'fresh')::integer                as new_total,
    count(*) filter (where bucket = 'offer' and is_pending)::integer as offer_pending,
    count(*) filter (where bucket = 'offer')::integer                as offer_total,
    count(*) filter (where bucket in ('follow_up','call_back') and is_pending)::integer
                                                                     as assigned_pending,
    count(*) filter (where bucket in ('follow_up','call_back'))::integer
                                                                     as assigned_total,
    count(*) filter (where bucket = 'campaign' and is_pending)::integer as custom_pending,
    count(*) filter (where bucket = 'campaign')::integer               as custom_total
  from assigned
  group by counsellor_id
),
tickets as (
  select
    count(*) filter (where not exists (
      select 1 from public.calls c
       where c.enquiry_id = e.id and c.call_date = t.d
    ))::integer as pending,
    count(*)::integer as total
  from public.live_enquiries e
  cross join target t
  where e.type = 'after_sale'
    and e.status in ('open', 'escalated')
)
select
  s.id,
  s.name,
  coalesce(g.new_pending, 0),      coalesce(g.new_total, 0),
  coalesce(g.offer_pending, 0),    coalesce(g.offer_total, 0),
  coalesce(g.assigned_pending, 0), coalesce(g.assigned_total, 0),
  coalesce(g.custom_pending, 0),   coalesce(g.custom_total, 0),
  k.pending, k.total,
  coalesce(g.new_pending, 0) + coalesce(g.offer_pending, 0)
    + coalesce(g.assigned_pending, 0) + coalesce(g.custom_pending, 0),
  coalesce(g.new_total, 0) + coalesce(g.offer_total, 0)
    + coalesce(g.assigned_total, 0) + coalesce(g.custom_total, 0)
from staff s
left join agg g on g.counsellor_id = s.id
cross join tickets k
order by s.name;
$function$
;

notify pgrst, 'reload schema';
