import { headers } from "next/headers";

import { instanceAgeMs, instanceId } from "@/lib/instance";
import { createClient } from "@/lib/supabase/server";

/**
 * Keep one instance and its Supabase connection warm during working hours.
 *
 * Brief 46 measured what a cold start costs on this project: a request that
 * normally answers in ~120 ms took 534 ms to first byte when it landed on a
 * new instance, and one stalled for 8.1 seconds. Fluid compute softens that
 * with bytecode caching and pre-warming, but it does not promise a warm
 * instance and no Vercel plan sells one — Pro's relevance is that it allows a
 * cron to run every minute, where Hobby allows one a day.
 *
 * So the warmth is bought here instead, by a cron that asks for nothing. The
 * person this protects is the first counsellor of the morning, and after that
 * anyone who opens Calman in a quiet half hour between calls.
 *
 * Two things get warmed, in the order they cost:
 *
 *   1. The instance — the Node process, the compiled bytecode, and the app's
 *      server module graph, which is most of a cold start.
 *   2. The function's TLS connection to Supabase, by making a real crossing.
 *      Undici's pool lives in module memory for the life of the process, so
 *      the next real request finds the handshake already done.
 *
 * It asks GoTrue's health endpoint rather than reading a table, for two
 * reasons. The `anon` role has no grant on anything — correctly — so every
 * table read and every RPC answers 401 `permission denied`, and a warm-up that
 * files 870 permission denials a week into the Supabase log teaches whoever
 * reads that log to ignore it. And it buys nothing: /auth/v1 and /rest/v1 are
 * the same origin, so one connection serves both, and the part a table read
 * would additionally warm — PostgREST's own pool to Postgres — is on
 * Supabase's side of the wire, shared across every client, and already warm
 * from the day's actual calls. It was never ours to keep.
 *
 * What it cannot warm is auth-js's JWKS cache, which only fills when a real
 * token is verified. Warming it would mean parking a live session's
 * credentials in an environment variable to be replayed every five minutes,
 * and a permanently valid token sitting in config is a worse thing to own than
 * one extra key fetch on the first signed-in request of the morning.
 *
 * The schedule lives in vercel.json, which cannot hold a comment, so it is
 * explained here. Vercel cron is always UTC and IST is UTC+5:30, so the
 * working window 08:30–20:30 IST is 03:00–15:00 UTC — which lands on the hour
 * at both ends, and falls inside one UTC date, so Mon–Sat needs no day shift.
 * It takes two expressions because an hour range is inclusive of whole hours:
 * one firing every fifth minute of hours 3–14, which ends at 14:55 UTC
 * (20:25 IST), and a second at minute 0 of hour 15 for the last one at 20:30
 * IST. Widening the first range to 3–15 would have been one line, and would
 * have gone on pinging until 21:25 IST.
 */
export async function GET() {
  const started = performance.now();

  // Vercel sends `Authorization: Bearer $CRON_SECRET` when the variable is
  // set. Checked only when it is: an unset secret must leave the route
  // working, or configuring it later would be the only thing standing between
  // the cron and silence. There is nothing here worth protecting — it reads
  // nothing and writes nothing — so this is tidiness, not a gate.
  // §53.1. Which process answered, on every reply including the refusal.
  //
  // The question this route exists to answer — is the cron keeping the pages'
  // connection pool warm — cannot be answered without knowing whether this
  // runs in the same process as a page. The pages put the same id on a hidden
  // element; comparing the two settles it. A random id and a duration are not
  // worth protecting, so this is set before the secret is checked.
  const identity = {
    "X-Calman-Instance": instanceId(),
    "X-Calman-Instance-Age-Ms": String(instanceAgeMs()),
  };

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = (await headers()).get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: identity });
    }
  }

  // Built the way every page builds it, so the same modules are resident
  // afterwards. With no session cookie this resolves locally and costs
  // nothing; it is here for the module graph, not the round trip.
  const supabase = await createClient();
  await supabase.auth.getClaims();

  // The crossing. `reached` is the honest health signal: false means Supabase
  // did not answer, which is worth seeing in the cron log.
  let reached = false;
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`,
      {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
        cache: "no-store",
      },
    );
    reached = res.ok;
  } catch {
    reached = false;
  }

  return Response.json(
    { ok: true, reached, ms: Math.round(performance.now() - started) },
    { headers: { ...identity, "Cache-Control": "no-store" } },
  );
}
