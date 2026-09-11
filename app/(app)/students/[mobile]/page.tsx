import Link from "next/link";
import { notFound } from "next/navigation";

import { StudentHistoryView } from "@/components/student-history";
import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { loadStudentByMobile } from "@/lib/students";
import { loadMasters } from "@/lib/masters";

export const metadata = { title: "Student · Calman" };

/**
 * §5.2. The URL is the mobile number, so any number anywhere in the product
 * links straight here without needing an id.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ mobile: string }>;
}) {
  const viewer = await requireUser();

  const { mobile: raw } = await params;
  const mobile = normaliseMobile(decodeURIComponent(raw));
  if (!isValidMobile(mobile)) notFound();

  const student = await loadStudentByMobile(mobile);
  if (!student) notFound();

  const masters = await loadMasters();
  // The interests table on each card is open and editable, so this page needs
  // the same four item masters the call panel does.

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={student.name || "Student"}
        description={`Every enquiry and every call on this number. First seen ${formatDateTime(student.created_at)}.`}
      />

      <div>
        <Link
          href="/quick-add"
          className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline"
        >
          ← Quick Add
        </Link>
      </div>

      <StudentHistoryView
        student={student}
        masters={{
          terms: masters.terms,
          sources: masters.sources,
          teachers: masters.teachers,
          courses: masters.courses,
          subjects: masters.subjects,
          contents: masters.contents,
        }}
        counsellorName={viewer.profile?.full_name ?? null}
        canUnarchive={isAdmin(viewer.profile?.role ?? "counsellor")}
      />
    </div>
  );
}
