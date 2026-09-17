-- §50A. Let the API see the accounts schema.
--
-- PostgREST serves only the schemas it is told to. The default here is
-- `public, graphql_public`, so accounts.* is invisible to supabase-js and the
-- new page would have nothing to read. The alternatives were a view or a
-- function in `public` wrapping accounts.vendors — which the brief rules out,
-- and rightly: a module that keeps its own schema should not start by planting
-- something in the one it is separating from.
--
-- This is a project-wide change to the API surface, so it is worth saying what
-- it does and does not do. It makes accounts.* *reachable*; it grants nothing.
-- Every table in there has RLS on and one policy, app.is_accounts(), so a
-- counsellor's token reaching the new endpoints gets an empty result rather
-- than a row. Reachable and permitted are different questions and only the
-- first is being answered here.
--
-- Set on the authenticator role rather than in the dashboard so it lives with
-- the migration that needs it. If the Supabase platform ever rewrites its own
-- API config this could be overridden, in which case the same list has to be
-- set under Settings → API → Exposed schemas.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, accounts';

-- PostgREST caches its config and its schema; both need telling.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
