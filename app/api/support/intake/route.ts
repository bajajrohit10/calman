import { createAdminClient } from "@/lib/supabase/admin";
import { createSupportTicket } from "@/lib/support/create";

/**
 * §58.3a. The Google Form's webhook.
 *
 * An Apps Script trigger on the form-response spreadsheet POSTs one row here as
 * the student submits it (see docs/support/apps-script.md). The endpoint is the
 * only way into Calman that is not a signed-in person, so three things are
 * true of it and stated here rather than assumed:
 *
 *   1. It authenticates with a shared secret in a header, because Apps Script
 *      has no Calman login and OAuth for one sheet would be a project of its
 *      own. The secret is compared in constant time.
 *   2. It runs as the service role, which bypasses RLS. That is the reason the
 *      secret check is the first thing in the handler and there is no path
 *      past it.
 *   3. It is idempotent on rowRef. The script retries twice on a non-2xx, and
 *      a backfill run may re-post rows that already arrived, so "the same row
 *      twice" is the normal case and not an error.
 */

/** Never prerendered, never cached: it writes. */
export const dynamic = "force-dynamic";

type Body = {
  timestamp?: string | null;
  name?: string | null;
  mobile?: string | null;
  orderId?: string | null;
  issues?: string | null;
  description?: string | null;
  faculty?: string | null;
  attachments?: string | null;
  rowRef?: string | null;
};

/**
 * Constant-time comparison.
 *
 * A plain `===` on a secret leaks its length and its matching prefix through
 * timing. The difference is small over the internet and free to avoid.
 */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function POST(request: Request) {
  const expected = process.env.SUPPORT_INTAKE_SECRET;
  if (!expected) {
    // Deliberately 503 and not 401: the caller did nothing wrong, the
    // deployment is unconfigured, and a 401 here would send whoever installed
    // the script hunting for a typo in their secret.
    return json({ error: "Intake is not configured on this deployment." }, 503);
  }

  const given = request.headers.get("x-intake-secret") ?? "";
  if (!secretMatches(given, expected)) {
    return json({ error: "Unauthorised." }, 401);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  // A row with neither a number nor an order reference nor a description is not
  // a ticket, and storing it would put an empty row in the team's queue.
  const hasSomething = [body.mobile, body.orderId, body.description, body.issues, body.name]
    .some((v) => (v ?? "").trim());
  if (!hasSomething) {
    return json({ error: "Nothing in this row to make a ticket from." }, 400);
  }

  const raisedAt = parseFormTimestamp(body.timestamp);

  try {
    // The webhook has no person behind it, so actorId is null and the timeline
    // shows the creation as system work.
    const result = await createSupportTicket(
      createAdminClient(),
      {
        source: "form",
        raisedAt,
        studentName: body.name ?? null,
        mobile: body.mobile ?? null,
        orderId: body.orderId ?? null,
        issues: body.issues ?? null,
        description: body.description ?? null,
        faculty: body.faculty ?? null,
        attachments: body.attachments ?? null,
        rowRef: body.rowRef ?? null,
      },
      null,
    );

    return json(
      {
        ticketId: result.ticketId,
        existing: result.existing,
        mergedInto: result.mergedInto ?? null,
        mobile: result.mobile,
        orderId: result.orderId,
        instituteId: result.instituteId,
        teacherId: result.teacherId,
      },
      result.existing ? 200 : 201,
    );
  } catch (error) {
    // 500, so the script's retry is worth making — unlike a 400, which would
    // fail identically on every attempt.
    return json({ error: error instanceof Error ? error.message : "Intake failed." }, 500);
  }
}

/**
 * The form's timestamp, as an instant.
 *
 * The sheet hands over whatever the cell holds, and in this feed that is a JS
 * Date string with an offset — "Mon Jun 30 2025 21:03:36 GMT+0530 (India
 * Standard Time)" — which Date.parse understands. An unparseable value falls
 * back to null and the row is stamped now(), because a ticket dated 1970 sorts
 * to the top of the queue forever.
 */
function parseFormTimestamp(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  // A timestamp far in the future is a mis-parse, not a prediction.
  if (ms > Date.now() + 36 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

/** Anything but POST, so a browser visit says so rather than 404ing. */
export async function GET() {
  return json({ error: "POST a form row here with an X-Intake-Secret header." }, 405);
}
