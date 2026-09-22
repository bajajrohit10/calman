import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import { loadEscalatees } from "@/lib/escalatees";
import { loadMasters } from "@/lib/masters";

import { QuickAdd } from "./quick-add";

export const metadata = { title: "Quick Add · Calman" };

export default async function Page() {
  const viewer = await requireUser();
  const masters = await loadMasters();
  const escalatees = await loadEscalatees();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Quick Add"
        description="One row per number. Type it, see what Calman knows, then call it or pass it on."
      />
      <QuickAdd
        // §48.3. The tab this user last had open, and the AC source resolved
        // by name — the grid is handed an id, so it never has to know that the
        // source it fixes is called "AC".
        // §54.1. Three values now; anything older or unknown opens on the
        // tab a call happening right now wants.
        initialTab={
          viewer.profile?.quick_add_tab === "ac"
            ? "ac"
            : viewer.profile?.quick_add_tab === "multi"
              ? "multi"
              : "one"
        }
        acSourceId={
          masters.sources.find((s) => s.name.trim().toLowerCase() === "ac")?.id ?? null
        }
        // §57.2. Resolved by name, like the AC source above: the grid is
        // handed an id and never learns which source it is. Null if the row
        // is gone or inactive, and then the dropdown simply starts on
        // "Select" as it always did.
        defaultSourceId={
          masters.sources.find(
            (s) => s.name.trim().toLowerCase() === "knowlarity",
          )?.id ?? null
        }
        masters={masters}
        escalatees={escalatees}
        counsellorName={viewer.profile?.full_name ?? null}
        viewerId={viewer.userId ?? null}
        viewerIsAdmin={isAdmin(viewer.profile?.role ?? "counsellor")}
      />
    </div>
  );
}
