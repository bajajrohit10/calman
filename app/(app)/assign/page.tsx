import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { loadRecommended } from "@/lib/recommended";
import { createClient } from "@/lib/supabase/server";

import { AssignDesk } from "./assign-desk";
import { PAGE_SIZE, parseDeskParams } from "./filters";

export const metadata = { title: "Assignment Desk · Calman" };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || null;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAdminProfile();
  const sp = await searchParams;

  const { date, page, includeNotDue, filters } = parseDeskParams((k) => one(sp[k]));

  const supabase = await createClient();
  const [list, teachers, courses, subjects, contents, terms, sources, staff, dayAssignments] =
    await Promise.all([
      loadRecommended(filters),
      supabase.from("teachers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("courses").select("id, name").eq("is_active", true).order("name"),
      supabase.from("subjects").select("id, name, course_id").eq("is_active", true).order("name"),
      supabase.from("contents").select("id, name").eq("is_active", true).order("priority"),
      supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("is_active", true)
        .neq("role", "ticket_team")
        .order("full_name"),
      supabase.from("assignments").select("counsellor_id, bucket").eq("date", date),
    ]);

  const counts = new Map<string, number>();
  for (const a of dayAssignments.data ?? []) {
    counts.set(a.counsellor_id, (counts.get(a.counsellor_id) ?? 0) + 1);
  }

  const roster = (staff.data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? "(no name)",
    role: p.role,
    count: counts.get(p.id) ?? 0,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Assignment Desk"
        description="The recommended list for one day, and who is going to call it."
      />
      <AssignDesk
        rows={list.rows}
        total={list.total}
        error={list.error}
        date={date}
        page={page}
        pageSize={PAGE_SIZE}
        includeNotDue={includeNotDue}
        roster={roster}
        masters={{
          teachers: teachers.data ?? [],
          courses: courses.data ?? [],
          subjects: subjects.data ?? [],
          contents: contents.data ?? [],
          terms: terms.data ?? [],
          sources: sources.data ?? [],
        }}
        selected={{
          counsellor: one(sp.counsellor) ?? "",
          teacher: one(sp.teacher) ?? "",
          course: one(sp.course) ?? "",
          subject: one(sp.subject) ?? "",
          content: one(sp.content) ?? "",
          term: one(sp.term) ?? "",
          source: one(sp.source) ?? "",
          importance: one(sp.importance) ?? "",
          type: one(sp.type) ?? "",
          status: one(sp.status) ?? "",
          createdFrom: one(sp.createdFrom) ?? "",
          createdTo: one(sp.createdTo) ?? "",
          followUpFrom: one(sp.followUpFrom) ?? "",
          followUpTo: one(sp.followUpTo) ?? "",
          q: one(sp.q) ?? "",
        }}
      />
    </div>
  );
}
