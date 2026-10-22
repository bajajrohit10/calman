-- §88. The login the Calman MCP server connects as.
--
-- The MCP server (app/api/mcp) lets Claude query Calman on behalf of a signed-in
-- super admin or manager. It talks to Postgres directly rather than through
-- PostgREST, because the useful thing it offers is ad-hoc read-only SQL, and
-- PostgREST has no way to run that.
--
-- Every request runs inside a transaction that does
--
--     set local role authenticated;
--     set_config('request.jwt.claims', '{"sub": <the user>, ...}', true);
--
-- so RLS, app.role(), the analytics functions and the audit triggers all see the
-- same person the app would, exactly as docs/known-issues.md measures queries.
--
-- Why a dedicated role rather than `postgres`: SET ROLE is checked against the
-- *session* user. Connected as postgres, a query could RESET ROLE its way out of
-- RLS. Connected as calman_mcp — NOINHERIT, holding nothing of its own, and a
-- member of `authenticated` only — the only role it can become is
-- `authenticated`, so the ceiling is what a signed-in staff member already has.
--
-- No password here: this repository is public. Set it once in the SQL editor:
--
--     alter role calman_mcp with password '<long random string>';
--
-- and put the pooler connection string (user calman_mcp.<project ref>) in the
-- CALMAN_MCP_DATABASE_URL environment variable on Vercel. See docs/mcp.md.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'calman_mcp') then
    create role calman_mcp login noinherit nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;

-- Nothing else is granted to calman_mcp. Until a request has switched to
-- `authenticated` it can read no table at all.
grant authenticated to calman_mcp;
