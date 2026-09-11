import { SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage
      title="Reports"
      description="What was actually done, per counsellor per day."
      fields={4}
      columns={10}
    />
  );
}
