import { SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage
      title="Assignment Desk"
      description="The recommended list for one day, and who is going to call it."
      fields={12}
      columns={9}
    />
  );
}
