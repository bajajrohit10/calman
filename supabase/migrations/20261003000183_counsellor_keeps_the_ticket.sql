-- §65.0. A ticket raised from counselling stays with the counsellor who raised it.

-- ---------------------------------------------------------------------------
-- The outcome mapping, restated.
-- ---------------------------------------------------------------------------
--
-- Before: 'noted' — which is what two of the three counselling doors send —
-- landed the ticket as `new` and unassigned, i.e. in the ticket team's New
-- queue. That was wrong in the way the team felt immediately: the counsellor is
-- still on the phone to the student, still owns the conversation, and the ticket
-- team was being handed work nobody had asked them to take.
--
-- After: the counsellor keeps it. 'noted' and 'working' both mean working,
-- assigned to the raiser, due on the next working day — the Counsellor tab,
-- which is exactly what §64.2 built that tab for. New is now reserved for a
-- genuine hand-over: Escalated (to the team) or Pending with the institute.
-- Resolved is unchanged.
--
-- The date is defaulted rather than demanded. public.next_working_day() is the
-- same answer the call form and the support action panel get, so Mon–Sat, the
-- holidays table and is_working_override all apply, and a counsellor raising a
-- ticket mid-call is not stopped to pick a date.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'support' and p.proname = 'raise_from_counselling';

  patched := replace(src,
$old$  case p_outcome
    when 'working' then
      v_status := 'working'; v_assigned := v_actor; v_follow := p_follow_up_date;
    when 'resolved' then
      v_status := 'resolved'; v_resolved_at := v_now; v_resolved_by := v_actor;
    when 'escalated', 'pending_institute', 'noted' then
      v_status := 'new';
    else
      raise exception 'unknown counselling outcome %', p_outcome;
  end case;$old$,
$new$  case p_outcome
    -- §65.0. 'noted' joins 'working': the counsellor who raised it keeps it.
    when 'working', 'noted' then
      v_status := 'working';
      v_assigned := v_actor;
      -- Defaulted, not demanded: the same working-day answer every other
      -- Calman date control gets.
      v_follow := coalesce(p_follow_up_date, public.next_working_day());
    when 'resolved' then
      v_status := 'resolved'; v_resolved_at := v_now; v_resolved_by := v_actor;
    -- §65.0. A real hand-over, and the only way into New from this side.
    when 'escalated', 'pending_institute' then
      v_status := 'new';
    else
      raise exception 'unknown counselling outcome %', p_outcome;
  end case;$new$);

  if patched = src then
    raise exception 'raise_from_counselling: the outcome mapping was not matched';
  end if;
  execute patched;
end $mig$;

notify pgrst, 'reload schema';
