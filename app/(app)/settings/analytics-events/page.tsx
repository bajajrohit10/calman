import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { EventsView } from "./events-view";

export const metadata = { title: "Analytics events · Calman" };

/**
 * §83.3. The list of what changed, and when.
 *
 * In Settings rather than on /analytics because it is reference data a manager
 * maintains occasionally, not something read while looking at numbers — the
 * numbers page shows the ones that fall in its own window and nothing else.
 */
export default async function Page() {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analytics_events")
    .select("id, at, note, created_at, author:profiles!analytics_events_created_by_fkey ( full_name )")
    .order("at", { ascending: false })
    .limit(200);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Analytics events"
        description="One line per change that moved the numbers — a price, a discount, a campaign. Shown on Analytics whenever the date falls inside the period being read or the one it is compared against."
      />
      <EventsView
        rows={
          (data ?? []).map((r) => ({
            id: r.id as string,
            at: r.at as string,
            note: r.note as string,
            author:
              (r.author as { full_name: string | null } | null)?.full_name ?? null,
          })) as { id: string; at: string; note: string; author: string | null }[]
        }
        loadError={error?.message ?? null}
      />
    </div>
  );
}
