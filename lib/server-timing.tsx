import "server-only";

import { cache } from "react";

import { instanceAgeMs, instanceId } from "@/lib/instance";

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
type Phase = { name: string; ms: number; at: number };

/**
 * §53.1. When each phase started, not only how long it took.
 *
 * A stall that is one slow await and a stall that is a gap between two fast
 * ones look identical in a list of durations, and they have different causes.
 * `at` is milliseconds from the first call of this collector in the request,
 * so the two can be told apart by reading the row.
 */
const collector = cache((): { phases: Phase[]; t0: number } => ({
  phases: [],
  t0: performance.now(),
}));

/**
 * Time one awaited phase. Returns whatever the callback returns.
 *
 * PromiseLike rather than Promise: a PostgREST query builder is a thenable,
 * not a Promise, and requiring the latter would mean wrapping every call site.
 */
export async function timed<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
  const c = collector();
  const started = performance.now();
  try {
    return await fn();
  } finally {
    c.phases.push({ name, ms: performance.now() - started, at: started - c.t0 });
  }
}

/**
 * §53.1. Which server process answered, and how long it had been alive.
 *
 * The stall under investigation happens on "the first request after an idle
 * gap", and the thing that makes a gap matter is whether the gap ended on a
 * process that was already running or on a new one. Nothing in the Vercel
 * request headers says which, so the process says it itself: an id minted when
 * the module is first evaluated, the age of that module, and how many requests
 * it has answered. A stall on `reqs=1` is a cold process; a stall on `reqs=40`
 * is not, and they are different bugs.
 */
let served = 0;

/** The phases recorded so far, as a Server-Timing field value. */
export function serverTiming(): string {
  return collector()
    .phases.map((p) => `${p.name};dur=${p.ms.toFixed(1)};at=${p.at.toFixed(1)}`)
    .join(", ");
}

/**
 * §53.1. The same breakdown, where a browser can read it.
 *
 * An App Router page cannot set a response header — the proxy runs before the
 * render and there is nothing to append to afterwards — and the Vercel
 * function log is not reachable from here. So the phases are rendered into the
 * page instead, on an element nobody sees, and read back with
 * `document.querySelector("[data-server-timing]")`.
 *
 * Rendered last, after every await the page makes, which is what makes it
 * complete. The layout's streamed badges finish later and are not in it.
 */
export function ServerTiming({ route }: { route: string }) {
  served += 1;
  return (
    <span
      hidden
      data-server-timing={serverTiming()}
      data-server-timing-route={route}
      data-server-instance={instanceId()}
      data-server-age-ms={String(instanceAgeMs())}
      data-server-reqs={String(served)}
      data-server-timing-total={collector()
        .phases.reduce((n, p) => Math.max(n, p.at + p.ms), 0)
        .toFixed(1)}
    />
  );
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
  const c = collector();
  const phases = c.phases;
  if (!phases.length) return;
  // Wall time across the request, not the sum of the phases: most of them run
  // concurrently, so the sum was larger than the render and said nothing about
  // where a stall sat.
  const wall = phases.reduce((n, p) => Math.max(n, p.at + p.ms), 0);
  const sorted = [...phases].sort((a, b) => a.at - b.at);
  console.log(
    `[timing] ${route} wall=${wall.toFixed(0)}ms ` +
      `instance=${instanceId()} age=${instanceAgeMs()}ms reqs=${served} ` +
      sorted.map((p) => `${p.name}=${p.ms.toFixed(0)}@${p.at.toFixed(0)}`).join(" "),
  );
}

/**
 * §53.1. One line that is worth grepping for.
 *
 * The stall this is chasing has never fired while anybody was watching; it
 * fires during working hours, on somebody else's click. So every render leaves
 * a line behind carrying the whole picture — which process, how old, how many
 * requests it had served, and every phase with its start offset — and finding
 * the stall afterwards is `[timing]` plus a sort on wall. A phase whose own
 * duration is the wall time is the await that hung; a wall with no phase to
 * account for it is time spent somewhere this does not reach.
 */
