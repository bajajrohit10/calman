import { SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage
      title="Enquiries"
      description="Every enquiry in Calman, however it ended."
      fields={14}
      columns={9}
    />
  );
}
