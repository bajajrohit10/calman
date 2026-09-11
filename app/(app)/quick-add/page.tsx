import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
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
        description="The phone is ringing. Type the number — everything else follows from it."
      />
      <QuickAdd masters={masters} counsellorName={viewer.profile?.full_name ?? null} />
    </div>
  );
}
