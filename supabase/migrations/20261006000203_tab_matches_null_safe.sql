-- §73. The Counsellor test must answer false, never null.
--
-- 201 wrote `t.assigned_to = t.raised_by`. For a counselling ticket nobody owns
-- that is `null = <uuid>` — null, not false — so `true and null` is null, and
-- `not null` is null too. Both branches returned null and the row fell in
-- neither tab: tickets #199 and #200, sitting at working with no owner, appeared
-- in the Counsellor tab and the Working tab not at all, and the six tabs stopped
-- summing to All.
--
-- `is not distinct from` is the same test without the null hole, and the
-- raised_by guard stays so that a form ticket — no raiser, no owner — is not
-- read as "still theirs" by two nulls agreeing with each other.
create or replace function support.tab_matches(t support.tickets, p_tab text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select case coalesce(p_tab, 'open')
           when 'all'        then true
           when 'resolved'   then t.status = 'resolved'
           when 'open'       then t.status <> 'resolved'
           when 'counsellor' then t.status = 'working'
                              and t.source = 'counselling'
                              and t.raised_by is not null
                              and t.assigned_to is not distinct from t.raised_by
           when 'working'    then t.status = 'working'
                              and not (t.source = 'counselling'
                                       and t.raised_by is not null
                                       and t.assigned_to is not distinct from t.raised_by)
           else t.status::text = p_tab
         end;
$$;

grant execute on function support.tab_matches(support.tickets, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
