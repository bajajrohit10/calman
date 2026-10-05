import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { isAdmin } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { EventsView, type EventRow } from "./events-view";

export const metadata = { title: "Analytics events · Calman" };

/**
 * §84.2. The experiments: what changed, who it applied to, and when.
 *
 * In Settings rather than on /analytics because it is reference data a manager
 * maintains occasionally; the Experiments tab reads it and shows the results.
 */
export default async function Page() {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) notFound();

  const supabase = await createClient();
  const [list, masters] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_experiments", {} as any),
    loadMasters(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Analytics events"
        description="One line per change worth measuring — a price, a discount, a campaign — with who it applied to and when. Shown on Analytics in the events bar, and read as an experiment on the Experiments tab."
      />
      <EventsView
        rows={(list.data ?? []) as unknown as EventRow[]}
        options={{
          teachers: masters.teachers.map((t) => ({ id: t.id, name: t.name })),
          institutes: masters.institutes.map((i) => ({ id: i.id, name: i.name })),
          // The subject carries its course, because that is how the scope is stored.
          subjects: masters.subjects.map((s) => ({
            id: s.id,
            label: `${masters.courses.find((c) => c.id === s.course_id)?.name ?? "?"} · ${s.name}`,
          })),
        }}
        loadError={list.error?.message ?? null}
      />
    </div>
  );
}
