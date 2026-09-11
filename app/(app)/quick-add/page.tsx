import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { QuickAdd, type QuickAddMasters } from "./quick-add";

export const metadata = { title: "Quick Add · Calman" };

/**
 * The masters are small (73 teachers is the largest) and every one of them is
 * needed the moment the panel opens, so they are loaded once with the page
 * rather than fetched per keystroke.
 */
async function loadMasters(): Promise<QuickAddMasters> {
  const supabase = await createClient();

  const [teachers, courses, subjects, contents, sources, terms] = await Promise.all([
    supabase.from("teachers").select("id, name").eq("is_active", true).order("name"),
    supabase.from("courses").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    supabase
      .from("subjects")
      .select("id, name, course_id")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("contents").select("id, name").eq("is_active", true).order("priority"),
    supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
    supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  return {
    teachers: teachers.data ?? [],
    courses: courses.data ?? [],
    subjects: subjects.data ?? [],
    contents: contents.data ?? [],
    sources: sources.data ?? [],
    terms: terms.data ?? [],
  };
}

export default async function Page() {
  const viewer = await requireUser();
  const masters = await loadMasters();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Quick Add"
        description="The phone is ringing. Type the number — everything else follows from it."
      />
      <QuickAdd masters={masters} counsellorName={viewer.profile?.full_name ?? null} />
    </div>
  );
}
