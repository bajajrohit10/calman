-- §58.2. Let PostgREST see schema `support`.
--
-- A schema the API does not expose is unreachable from the app however correct
-- its grants are: PostgREST answers "Invalid schema: support" with HTTP 406
-- before RLS is ever consulted. The exposed list lives on the `authenticator`
-- role, and it is where `accounts` was added when that module landed —
--
--   pgrst.db_schemas = 'public, graphql_public, accounts'
--
-- so this follows the project's own precedent rather than inventing a path.
--
-- Written as an append against the value actually in place, not as a literal
-- list: hard-coding the three current names would silently drop a fourth if
-- somebody adds one from the dashboard before this runs.
--
-- Exposing the schema grants nothing by itself. anon has no privileges here
-- (the previous migration revokes them), every table has RLS on, and every
-- policy requires app.is_support() — so a counsellor's token reaching
-- /rest/v1/tickets sees an empty set, and an anonymous one is refused outright.
do $$
declare
  v_current text;
  v_next    text;
begin
  select regexp_replace(s, '^pgrst\.db_schemas=', '')
    into v_current
    from pg_roles r
    cross join unnest(coalesce(r.rolconfig, '{}'::text[])) s
   where r.rolname = 'authenticator'
     and s like 'pgrst.db_schemas=%';

  if v_current is null then
    raise exception
      'authenticator has no pgrst.db_schemas setting — refusing to guess the list';
  end if;

  if v_current ~ '(^|,)\s*support\s*($|,)' then
    raise notice 'support is already exposed (%); nothing to do', v_current;
    return;
  end if;

  v_next := v_current || ', support';
  execute format('alter role authenticator set pgrst.db_schemas = %L', v_next);
  raise notice 'pgrst.db_schemas: % -> %', v_current, v_next;
end $$;

-- Config, not schema: this is the reload PostgREST needs to pick the list up.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
