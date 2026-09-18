import "server-only";

/**
 * §53.1. Which server process this is, and how long it has been alive.
 *
 * Minted when the module is first evaluated, so it is stable for the life of
 * one Node process and different in every other. Two questions need it:
 *
 *   * whether a slow request landed on a cold process or a busy one — a stall
 *     on the first request a process serves and a stall on its fortieth are
 *     different bugs;
 *   * whether /api/warm runs in the same process as the pages it is supposed
 *     to be keeping warm. If it does not, the cron is warming a connection
 *     pool that no page will ever use, and the whole thing is theatre.
 *
 * Nothing here is secret: it is a random id and a duration, and it is the only
 * way to answer either question from outside.
 */
const ID = Math.random().toString(36).slice(2, 10);
const BOOTED = Date.now();

export function instanceId() {
  return ID;
}

export function instanceAgeMs() {
  return Date.now() - BOOTED;
}
