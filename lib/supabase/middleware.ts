import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

/**
 * Keep the session cookie fresh, and get out of the way.
 *
 * This used to call auth.getUser() on every matched request, which is a
 * network round trip to the Supabase auth server before the route even starts
 * rendering. Brief 15 measured that trip at ~260 ms against a database on
 * another continent, and it was one of four the app made per navigation.
 *
 * getSession() does the job this function actually has. It reads the session
 * out of the cookies and only goes to the network when the access token is
 * within auth-js's expiry margin, at which point it refreshes and writes the
 * rotated cookies back through setAll below. A token lives an hour, so the
 * crossing happens roughly once an hour per user instead of once per click.
 *
 * The usual warning about getSession() on the server — that it returns
 * whatever is in the cookie without verifying it — does not apply to what it
 * is used for here. Nothing is authorised on the strength of this call. The
 * route's own getViewer() verifies the token's signature (ES256, locally), and
 * every query goes to PostgREST bearing that token, which checks it again
 * before RLS gets a say. This is a cookie refresh, not a gate.
 */
export async function updateSession(request: NextRequest) {
  const started = performance.now();
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: no logic between createServerClient and the session read. A
  // mistake here makes users appear to be randomly logged out and is hard to
  // debug.
  await supabase.auth.getSession();

  // IMPORTANT: return supabaseResponse as-is. Building a fresh response without
  // copying these cookies desynchronises browser and server and ends the
  // session early.
  //
  // The header is the one piece of server timing a header can carry: a page
  // cannot set response headers in the App Router, because the proxy runs
  // before the render and there is no `await next()` to append to afterwards.
  // Page phases are logged instead — see lib/server-timing.ts.
  supabaseResponse.headers.set(
    "Server-Timing",
    `proxy;dur=${(performance.now() - started).toFixed(1)}`,
  );

  return supabaseResponse;
}
