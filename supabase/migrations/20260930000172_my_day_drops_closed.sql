-- §62 addendum, bug 2. A closed enquiry must leave My Day's Pending list.
--
-- Reported for 9900010921: the row showed a "Closed" badge and stayed in the
-- "to call" list. Two enquiries exist for that number — a purchase one closed as
-- `superseded` the moment its after-sale sibling was created, and the after-sale
-- one. The purchase row (#1714) still held today's `fresh` assignment and had
-- never been called, and my_day() filtered on the assignment alone:
--
--   from mine m join public.live_enquiries e on e.id = m.enquiry_id
--
-- with no status test anywhere in the function. The Pending/Done split in the UI
-- is only `called_today`, so a closed, uncalled row could only ever be Pending.
--
-- Fixed here rather than by hiding it in the component, so the tab counts, the
-- CSV export (which re-derives from the same rows through loadMyDayIds) and the
-- screen all change together.

CREATE OR REPLACE FUNCTION public.my_day(p_date date DEFAULT NULL::date, p_counsellor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(enquiry_id bigint, bucket assignment_bucket, bucket_rank smallint, student_id uuid, mobile text, student_name text, type enquiry_type, status enquiry_status, importance importance, term_name text, product_text text, next_follow_up_date date, is_overdue boolean, follow_up_slots_used smallint, top_content_priority smallint, teacher_names text[], item_count integer, called_today boolean, last_call_at timestamp with time zone, last_outcome call_outcome, re_enquired_today boolean, assigned_at timestamp with time zone, assignment_label text, offer_names text[], offer_ids uuid[], lost_reason lost_reason, slots_at_open smallint, carried_to date)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with target as (
  select
    coalesce(p_date, app.ist_today()) as d,
    coalesce(p_counsellor_id, (select auth.uid())) as who
),
mine as (
  select a.enquiry_id, a.bucket, a.assigned_at, a.label, a.carried_to
    from public.assignments a
    cross join target t
   where a.date = t.d
     and a.counsellor_id = t.who
),
-- A call on the viewed day, made after the lead was handed over. Both halves
-- matter: the date keeps a historical view honest, assigned_at is what makes a
-- re-assignment reset the row to Pending.
done_call as (
  select c.enquiry_id, max(c.called_at) as last_call_at
    from public.calls c
    join mine m on m.enquiry_id = c.enquiry_id
    cross join target t
   where c.call_date = t.d
     and c.called_at >= m.assigned_at
   group by c.enquiry_id
)
select
  e.id,
  m.bucket,
  (case m.bucket
     when 'follow_up' then 1
     when 'offer'     then 2
     when 'fresh'     then 3
     when 'campaign'  then 4
     when 'call_back' then 5
   end)::smallint as bucket_rank,
  e.student_id,
  s.mobile,
  s.name,
  e.type,
  e.status,
  e.importance,
  tm.name,
  e.product_text,
  e.next_follow_up_date,
  (e.next_follow_up_date is not null and e.next_follow_up_date < t.d) as is_overdue,
  e.follow_up_slots_used,
  e.top_content_priority,
  (select array_agg(distinct tch.name order by tch.name)
     from public.enquiry_items i
     join public.teachers tch on tch.id = i.teacher_id
    where i.enquiry_id = e.id and (i.status = 'open' or (m.bucket = 'offer' and i.status <> 'won'))) as teacher_names,
  (select count(*)::integer from public.enquiry_items i
    where i.enquiry_id = e.id) as item_count,
  (dc.enquiry_id is not null) as called_today,
  dc.last_call_at,
  (select c.outcome
     from public.calls c
    where c.enquiry_id = e.id
    order by c.call_date desc, c.called_at desc, c.id desc
    limit 1) as last_outcome,
  (e.re_enquired_at is not null and e.re_enquired_at = t.d) as re_enquired_today,
  m.assigned_at,
  m.label,
  off.names,
  off.ids,
  e.lost_reason,
  sl.n,
  m.carried_to
from mine m
join public.live_enquiries e on e.id = m.enquiry_id
join public.students s on s.id = e.student_id
cross join target t
left join public.terms tm on tm.id = e.term_id
left join done_call dc on dc.enquiry_id = e.id
-- Which offer put this on the list. Recomputed for the viewed day rather than
-- stamped on the assignment: the bucket is already recorded there, and a name
-- copied at assignment time would go stale the moment the offer was renamed.
left join lateral (
  select array_agg(distinct om.offer_name order by om.offer_name) as names,
         array_agg(distinct om.offer_id) as ids
    from public.offer_matches om
   where m.bucket = 'offer'
     and om.enquiry_id = e.id
     and t.d between om.window_from and om.end_date
       and om.item_status <> 'won'
) off on true
-- The §4.3 ladder as it stood this morning: distinct ordinary call days before
-- today, less the fresh one. Offer calls never counted towards it (§23.2), and
-- the fourth rung collects anything past the third.
left join lateral (
  select least(greatest(count(distinct c.call_date) - 1, 0), 3)::smallint as n
    from public.calls c
   where c.enquiry_id = e.id
     and not c.is_offer_call
     and c.call_date < t.d
) sl on true
where e.type = 'purchase'
  -- §62 addendum. My Day is assignment-driven, and nothing here used to ask
  -- whether the enquiry was still open. So a lead that closed after it was
  -- handed out — superseded when its after-sale enquiry was created, won, or
  -- lost — kept its assignment and sat in Pending forever, wearing a "Closed"
  -- badge. Enquiry #1714 was doing exactly that.
  --
  -- A row survives if it is still callable, or if it was called on this day: the
  -- second half is what keeps the day's work visible under Done, so closing a
  -- lead you just rang does not erase the call from your own day. A closed lead
  -- nobody called is neither pending nor done, and drops off — which also fixes
  -- the counts, because they are derived from these rows rather than counted
  -- separately.
  and (e.status not in ('won', 'lost', 'closed') or dc.enquiry_id is not null)
order by
  (case m.bucket
     when 'follow_up' then 1 when 'offer' then 2 when 'fresh' then 3
     when 'campaign'  then 4 when 'call_back' then 5 end),
  e.importance nulls last,
  e.top_content_priority nulls last,
  e.next_follow_up_date nulls last,
  e.id;
$function$;

notify pgrst, 'reload schema';
