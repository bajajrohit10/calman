import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

import { DeskPreview } from "./desk-preview";

export const metadata = { title: "Desk redesign — preview · Calman" };

/**
 * Brief 36.3: the proposed Assignment Desk, rendered but not wired.
 *
 * A static preview on its own route so the shape can be argued about before
 * anything real is touched, and deleted once the argument is settled. The
 * numbers are made up; the layout, the density and the interactions are not.
 */
export default async function Page() {
  await requireUser();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Assignment Desk — proposed"
        description="Preview only. Nothing here is connected; the data is invented."
      />
      <DeskPreview />
    </div>
  );
}
