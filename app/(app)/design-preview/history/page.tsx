import { notFound } from "next/navigation";

import { requireAdminProfile } from "@/lib/auth";
import { loadStudentByMobile } from "@/lib/students";

import { HistoryPreview } from "./preview";

export const metadata = { title: "History — preview · Calman" };

/**
 * A rendered proposal for §28.4, not a feature.
 *
 * Real data behind it — pass ?mobile= to aim it at a number — so the shape can
 * be argued about against a real record rather than a mock. Deleted once the
 * decision is made, like the first-call preview before it.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mobile?: string }>;
}) {
  await requireAdminProfile();
  const { mobile } = await searchParams;
  const student = await loadStudentByMobile(mobile ?? "9900010922");
  if (!student) notFound();
  return <HistoryPreview student={student} />;
}
