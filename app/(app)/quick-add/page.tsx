import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";

import { QuickAdd } from "./quick-add";

export const metadata = { title: "Quick Add · Calman" };

export default async function Page() {
  const viewer = await requireUser();
  const masters = await loadMasters();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Quick Add"
        description="One row per number. Type it, see what Calman knows, then call it or pass it on."
      />
      <QuickAdd
        masters={masters}
        counsellorName={viewer.profile?.full_name ?? null}
        viewerId={viewer.userId ?? null}
        viewerIsAdmin={isAdmin(viewer.profile?.role ?? "counsellor")}
      />
    </div>
  );
}
