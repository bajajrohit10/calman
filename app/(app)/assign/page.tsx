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

  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]],
    ),
  ).toString();

  const supabase = await createClient();
  const [list, teachers, courses, subjects, contents, terms, sources, staff] =
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
    ]);

  // Counted per counsellor by the database. Fetching the day's assignment rows
  // and tallying them in JS was wrong above a thousand rows on a busy day, and
  // wrong without saying so — an exact head count cannot truncate.
  const roster = await Promise.all(
    (staff.data ?? []).map(async (p) => {
      const { count } = await supabase
        .from("assignments")
        .select("*", { count: "exact", head: true })
        .eq("date", date)
        .eq("counsellor_id", p.id);
      return {
        id: p.id,
        name: p.full_name ?? "(no name)",
        role: p.role,
        count: count ?? 0,
      };
    }),
  );

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
        search={search}
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
