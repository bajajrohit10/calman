import { SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage
      title="Tickets"
      description="The after-sale queue. Escalated first."
      fields={6}
      columns={7}
    />
  );
}
