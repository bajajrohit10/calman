import { requireAdminProfile } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { loadOffers } from "@/lib/offers";

import { OffersView } from "./offers-view";

export const metadata = { title: "Offers · Settings · Calman" };

export default async function OffersPage() {
  await requireAdminProfile();

  const [{ offers, performance, error }, masters] = await Promise.all([
    loadOffers(),
    loadMasters(),
  ]);

  return (
    <OffersView
      offers={offers}
      performance={performance}
      error={error}
      masters={{
        institutes: masters.institutes,
        teachers: masters.teachers,
        courses: masters.courses,
        subjects: masters.subjects,
        contents: masters.contents,
      }}
    />
  );
}
