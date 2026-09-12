import { requireAdminProfile } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";

import { FirstCallPreview } from "./preview";

export const metadata = { title: "First call — preview · Calman" };

/**
 * A rendered proposal, not a feature (§26.2).
 *
 * The same trick Brief 13 used for the visual refresh: a throwaway route that
 * shows the layout with real master lists behind it, so the shape can be
 * argued about before any of the call panel is touched. Deleted once the
 * decision is made.
 */
export default async function Page() {
  await requireAdminProfile();
  const masters = await loadMasters();
  return (
    <FirstCallPreview
      teachers={masters.teachers}
      courses={masters.courses}
      subjects={masters.subjects}
      contents={masters.contents}
      terms={masters.terms}
    />
  );
}
