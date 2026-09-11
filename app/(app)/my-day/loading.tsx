import { SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage
      title="My Day"
      description="Everything assigned to you today, in the order to call it."
      fields={2}
      columns={8}
    />
  );
}
