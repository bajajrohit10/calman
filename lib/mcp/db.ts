import "server-only";

import { Pool, types as pgTypes, type PoolClient } from "pg";

/**
 * Dates and timestamps come back as the text Postgres sent. Parsed into JS
 * Dates they would be re-serialised in the server's zone — a `date` of
 * 2026-10-21 can come out as "2026-10-20T18:30:00.000Z", which is a different
 * day to anyone reading it.
 */
const RAW_TEXT = new Set([1082, 1114, 1184]); // date, timestamp, timestamptz
const typeParsers = {
  getTypeParser: ((oid: number, format?: string) =>
    RAW_TEXT.has(oid)
      ? (v: string) => v
      : pgTypes.getTypeParser(oid, format as "text")) as typeof pgTypes.getTypeParser,
};

/**
 * §88. The MCP server's database connection.
 *
 * Direct Postgres rather than PostgREST, as the calman_mcp login role (see
 * migration 20261022000240). Every unit of work runs in one transaction that
 * first becomes `authenticated` with the caller's id in request.jwt.claims —
 * so RLS, app.role(), the analytics functions and the audit triggers treat it
 * exactly as they treat that person in the app. Nothing here bypasses RLS.
 *
 * CALMAN_MCP_DATABASE_URL should be the Supavisor *transaction* pooler string
 * (port 6543), user `calman_mcp.<project ref>`. SET LOCAL is transaction-scoped,
 * which is exactly what transaction pooling preserves.
 */

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const raw = process.env.CALMAN_MCP_DATABASE_URL;
  if (!raw) throw new Error("CALMAN_MCP_DATABASE_URL is not set.");

  // sslmode in the URL would override the ssl object below (and node-postgres
  // now reads `require` as verify-full), so it is stripped and decided here.
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const ca = process.env.CALMAN_MCP_DATABASE_CA?.replace(/\\n/g, "\n");

  pool = new Pool({
    connectionString: url.toString(),
    // With CALMAN_MCP_DATABASE_CA (Supabase → Database → SSL certificate) the
    // server certificate is verified. Without it the link is still encrypted,
    // as libpq's sslmode=require is.
    ssl: local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    types: typeParsers,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", () => {
    // An idle client dropped by the pooler. The pool discards it; the next
    // checkout opens a fresh one.
  });
  return pool;
}

export type Mode = "read" | "write";

/**
 * Run `fn` as `userId`, in a transaction. Read mode is READ ONLY end to end:
 * not even a security-definer function can write from inside it.
 */
export async function asUser<T>(
  userId: string,
  mode: Mode,
  fn: (db: PoolClient) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Bad user id.");
  const client = await getPool().connect();
  try {
    await client.query(mode === "read" ? "begin read only" : "begin");
    await client.query(`set local statement_timeout = ${Math.round(opts.timeoutMs ?? 20_000)}`);
    await client.query("set local role authenticated");
    const claims = JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", via: "mcp" });
    await client.query(
      `select set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true),
              set_config('request.jwt.claim.role', 'authenticated', true)`,
      [claims, userId],
    );
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** The caller's role, or null when the account is missing or deactivated. */
export async function roleOf(userId: string): Promise<{ role: string; name: string | null } | null> {
  return asUser(userId, "read", async (db) => {
    const { rows } = await db.query<{ role: string | null; full_name: string | null }>(
      `select app.role()::text as role,
              (select full_name from public.profiles where id = $1) as full_name`,
      [userId],
    );
    const role = rows[0]?.role;
    return role ? { role, name: rows[0].full_name } : null;
  });
}
