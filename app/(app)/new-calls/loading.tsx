import { SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage
      title="New Calls"
      description="Leads nobody has spoken to or claimed yet. Take what you can call."
      fields={10}
      columns={8}
    />
  );
}
