import { getViewer, isAdmin } from "@/lib/auth";
import { readEdportalProduct } from "@/lib/price-check/edportal";

/**
 * Price check. All variants of up to 25 products on an edportal-hosted vendor
 * site, read server-side (browsers block cross-site page reads).
 *
 * POST { origin: "https://www.bbvirtuals.com", slugs: string[] }
 * Admin only (manager / super admin), same-origin session cookie. The origin
 * must be one of the registry's websites, so this cannot be pointed at an
 * arbitrary host.
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return Response.json({ error: "Only a manager or super admin can read vendor variants." }, { status: 403 });
  }

  let body: { origin?: string; slugs?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length < 300) : [];
  if (!slugs.length || slugs.length > 25) return Response.json({ error: "Send 1–25 slugs." }, { status: 400 });

  let origin: string;
  try {
    origin = new URL(String(body.origin ?? "")).origin;
  } catch {
    return Response.json({ error: "Bad origin." }, { status: 400 });
  }

  // Only websites in the vendor registry, read under the caller's own RLS.
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data: sites } = await supabase.from("vendor_sites").select("website_url, read_method");
  const allowed = new Set(
    (sites ?? []).filter((s) => s.read_method === "edportal_feed").map((s) => new URL(s.website_url).origin),
  );
  if (!allowed.has(origin)) return Response.json({ error: "That website isn't a course-platform site in the registry." }, { status: 400 });

  const results = [];
  for (const slug of slugs) {
    results.push(await readEdportalProduct(origin, slug));
    // Be polite: one page at a time with a short pause.
    await new Promise((r) => setTimeout(r, 250));
  }
  return Response.json({ results });
}
