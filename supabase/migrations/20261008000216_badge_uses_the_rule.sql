-- §76. The sidebar badge reads the shared pending rule.
--
-- CREATE OR REPLACE: the signature is unchanged.

CREATE OR REPLACE FUNCTION public.my_day_pending_count(p_date date DEFAULT NULL::date, p_counsellor_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select coalesce(p_date, app.ist_today()) as d,
         coalesce(p_counsellor_id, (select auth.uid())) as who
),
assigned as (
  select count(*)::integer as n
    from public.assignments a
    join public.live_enquiries e on e.id = a.enquiry_id
    cross join target t
   where a.date = t.d
     and a.counsellor_id = t.who
     and e.type = 'purchase'
     -- §76. The badge counted neither the status nor carried_to, so it could
     -- promise work that My Day would not show and work that had already moved
     -- to another date. One rule now, shared with the desk grid.
     and app.assignment_is_pending(a.enquiry_id, a.assigned_at, a.carried_to, e.status, t.d)
),
-- Tickets are not assigned to anybody, so the tab shows the same queue to
-- everyone; the badge says the same thing the tab does.
tickets as (
  select count(*)::integer as n
    from public.live_enquiries e
    cross join target t
   where e.type = 'after_sale'
     and e.status in ('open', 'escalated')
     and not exists (
       select 1 from public.calls c
        where c.enquiry_id = e.id and c.call_date = t.d
     )
)
select (select n from assigned) + (select n from tickets);
$function$
;

notify pgrst, 'reload schema';
