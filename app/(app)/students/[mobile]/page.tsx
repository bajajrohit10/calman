import Link from "next/link";
import { notFound } from "next/navigation";

import { StudentHistoryView } from "@/components/student-history";
import { isAdmin, requireUser } from "@/lib/auth";
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

  // Together, not one after the other (§27.3). The two have nothing to say to
  // each other and the page cannot render until both are back, so awaiting
  // them in sequence spent the shorter of the two round trips for nothing —
  // measured at 130ms for the history and 98ms for the master lists.
  //
  // The interests table on each card is open and editable, so this page needs
  // the same item masters the call panel does.
  const [student, masters] = await Promise.all([
    loadStudentByMobile(mobile),
    loadMasters(),
  ]);
  if (!student) notFound();

  return (
    <div className="flex flex-col gap-5">
      {/* §28.4: no page header. The Now card below is the header — it carries
          the name, the number and when the number was first seen, and having
          both meant reading the same three facts twice before reaching the
          one thing the page is for. */}
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
