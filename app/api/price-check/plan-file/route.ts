import { getViewer } from "@/lib/auth";
import plan from "@/data/price-check/plan-2026-10-23.json";

/**
 * One-off (23 Oct 2026): the prepared approvals / sibling products / attempt
 * alternatives for the To do list, loaded through Links → Load. Super admin
 * only; writes nothing. Remove with the data file once loaded.
 */
export async function GET() {
  const viewer = await getViewer();
  if (viewer.profile?.role !== "super_admin") return Response.json({ error: "Super admin only." }, { status: 403 });
  return Response.json(plan, { headers: { "cache-control": "no-store" } });
}
