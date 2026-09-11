import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { createClient } from "@/lib/supabase/server";

import { QuickAdd } from "./quick-add";

export const metadata = { title: "Quick Add · Calman" };

export default async function Page() {
  const viewer = await requireUser();
  const masters = await loadMasters();
  const supabase = await createClient();

  // One value a day, read here so the per-keystroke lookup stays a single query.
  const { data: nextWorkingDay } = await supabase.rpc("next_working_day", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Quick Add"
        description="The phone is ringing. Type the number — everything else follows from it."
      />
      <QuickAdd
        masters={masters}
        counsellorName={viewer.profile?.full_name ?? null}
        defaultFollowUpDate={nextWorkingDay}
      />
    </div>
  );
}
