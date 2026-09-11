import "server-only";

import { cache } from "react";

/**
 * Server-side phase timings, so a future measurement reads them off the server
 * instead of inferring them from the outside.
 *
 * Brief 15 had to work out where ~1050 ms of navigation went by measuring two
 * production routes that differed by exactly one RPC and subtracting. That got
 * the right answer, but it is not a technique anybody should need twice.
 *
 * `cache()` gives one collector per request: React memoises the call for the
 * lifetime of a single render, which is exactly the scope wanted here.
 */
type Phase = { name: string; ms: number };

const collector = cache((): { phases: Phase[] } => ({ phases: [] }));

/**
 * Time one awaited phase. Returns whatever the callback returns.
 *
 * PromiseLike rather than Promise: a PostgREST query builder is a thenable,
 * not a Promise, and requiring the latter would mean wrapping every call site.
 */
export async function timed<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    collector().phases.push({ name, ms: performance.now() - started });
  }
}

/** The phases recorded so far, as a Server-Timing field value. */
export function serverTiming(): string {
  return collector()
    .phases.map((p) => `${p.name};dur=${p.ms.toFixed(1)}`)
    .join(", ");
}

/**
 * One structured line per render, for the phases a header cannot carry.
 *
 * An App Router page cannot set a response header — the proxy runs before the
 * render and there is no `await next()` to append to afterwards — so the
 * request-level Server-Timing header covers the proxy only. Everything a page
 * does lands here instead, where `vercel logs` can read it.
 */
export function logServerTiming(route: string) {
  const phases = collector().phases;
  if (!phases.length) return;
  const total = phases.reduce((n, p) => n + p.ms, 0);
  console.log(
    `[timing] ${route} total=${total.toFixed(0)}ms ` +
      phases.map((p) => `${p.name}=${p.ms.toFixed(0)}`).join(" "),
  );
}
