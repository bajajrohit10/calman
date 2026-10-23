import { getViewer } from "@/lib/auth";
import bbSuggestions from "@/data/price-check/bb-suggestions-2026-10-23.json";

/**
 * Price check, Brief 2a. One-off: the AI link proposals for the BB group
 * (bbvirtuals.com courses + bbpublication.com books), prepared outside the app.
 *
 * GET returns the JSON array that Settings → Links → "Load AI suggestions"
 * accepts. It does not write anything: loading still goes through that screen's
 * import (super admin, never overwrites approved/rejected links).
 *
 * Super admin only. Remove this route and the data file once loaded.
 */

export async function GET() {
  const viewer = await getViewer();
  if (viewer.profile?.role !== "super_admin") {
    return Response.json({ error: "Only a super admin can read the suggestions file." }, { status: 403 });
  }
  return Response.json(bbSuggestions, { headers: { "cache-control": "no-store" } });
}
