/**
 * §50E.3. Where a role belongs when it signs in.
 *
 * The accounts role has no business on the counselling floor and no rows to
 * see there — every counselling table refuses it — so sending it to My Day
 * means sending it to a screen that is empty by design and reads as broken.
 * It goes to the month of sales instead, which is its whole job.
 *
 * A shared function rather than a check at each redirect, because there are
 * three of them (sign-in, the already-signed-in bounce, and the app shell) and
 * a role that lands in different places depending on how it arrived is a bug
 * that takes a long time to notice.
 */
export function landingPathFor(role: string | null | undefined): string {
  return role === "accounts" ? "/accounts" : "/my-day";
}

/** Whether the counselling rail should be shown at all. */
export function showsCounselling(role: string | null | undefined): boolean {
  return role !== "accounts";
}
