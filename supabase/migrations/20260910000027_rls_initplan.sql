-- Evaluate app.is_staff() / app.is_admin() once per statement, not once per row.
--
-- Found the hard way. The Brief 8 measurement showed the Assignment Desk
-- returning in 62 ms against a 5,000-enquiry set — as the `postgres` role,
-- which bypasses RLS. Through the app, as `authenticated`, the same page died
-- with "canceling statement due to statement timeout" at Supabase's 8-second
-- limit. Measuring as a superuser measured the wrong thing.
--
-- The cause: a policy body of `app.is_staff()` is a function call in the
-- per-row qual. STABLE only promises the value will not change *within* a
-- statement; it does not make the planner hoist the call. So every row of
-- `enquiries` — and of `enquiry_items` and `calls` inside the subqueries —
-- paid for app.role(), which is itself a lookup against `profiles`.
--
-- Wrapping the call in a scalar subquery, `(select app.is_staff())`, makes it
-- an InitPlan: evaluated once, cached for the statement. This is the
-- documented Supabase pattern, and the policies already do it for auth.uid().
-- Nothing about who may see what changes — the predicate is the same
-- predicate.
--
-- Done as a loop over pg_policy rather than 88 hand-written ALTER POLICY
-- statements: a mechanical rewrite cannot miss one, and cannot mistype one
-- into being more permissive. The unwrap-then-wrap makes it idempotent.

do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sets text[];
begin
  for r in
    select c.relname,
           p.polname,
           pg_get_expr(p.polqual, p.polrelid)      as using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace
     order by c.relname, p.polname
  loop
    v_using := r.using_expr;
    v_check := r.check_expr;
    v_sets  := array[]::text[];

    -- Unwrap first so re-running this changes nothing.
    v_using := replace(v_using, '( SELECT app.is_staff() AS is_staff)', 'app.is_staff()');
    v_using := replace(v_using, '( SELECT app.is_admin() AS is_admin)', 'app.is_admin()');
    v_check := replace(v_check, '( SELECT app.is_staff() AS is_staff)', 'app.is_staff()');
    v_check := replace(v_check, '( SELECT app.is_admin() AS is_admin)', 'app.is_admin()');

    v_using := replace(v_using, 'app.is_staff()', '(select app.is_staff())');
    v_using := replace(v_using, 'app.is_admin()', '(select app.is_admin())');
    v_check := replace(v_check, 'app.is_staff()', '(select app.is_staff())');
    v_check := replace(v_check, 'app.is_admin()', '(select app.is_admin())');

    if v_using is distinct from r.using_expr and v_using is not null then
      v_sets := v_sets || format('using (%s)', v_using);
    end if;
    if v_check is distinct from r.check_expr and v_check is not null then
      v_sets := v_sets || format('with check (%s)', v_check);
    end if;

    if array_length(v_sets, 1) > 0 then
      execute format(
        'alter policy %I on public.%I %s',
        r.polname, r.relname, array_to_string(v_sets, ' ')
      );
    end if;
  end loop;
end;
$$;
