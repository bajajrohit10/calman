import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadEnquiries } from "@/lib/enquiries";
import { createClient } from "@/lib/supabase/server";

import { PAGE_SIZE, parseEnquiriesParams } from "../assign/filters";
import { EnquiriesTable } from "./enquiries-table";

export const metadata = { title: "Enquiries · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/**
 * A native multi-select submits its values as repeated keys; a hand-built or
 * pasted link may comma-join them. Both shapes reach the parsers as one
 * comma-joined string, which is what the array filters expect — the old reader
 * took the first value and silently dropped the rest.
 */
const read = (sp: Params) => (k: string): string | null => {
  const v = sp[k];
  if (Array.isArray(v)) return v.length ? v.join(",") : null;
  return v ?? null;
};

/** §5.6. Every enquiry, every role — no admin gate. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const { page, sort, dir, filters } = parseEnquiriesParams(read(sp));
  const includeArchived = filters.includeArchived ?? false;

  // Passed down rather than read from window.location during render: on the
  // server that is empty, so the sort links hydrated with the filters missing
  // — and a click landing before hydration would have dropped them.
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]],
    ),
  ).toString();

  const supabase = await createClient();
  const [list, teachers, institutes, courses, subjects, contents, terms, sources, staff] =
    await Promise.all([
      loadEnquiries(filters),
      supabase.from("teachers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("institutes").select("id, name").eq("is_active", true).order("name"),
      supabase.from("courses").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      supabase.from("subjects").select("id, name, course_id").eq("is_active", true).order("sort_order").order("name"),
      supabase.from("contents").select("id, name").eq("is_active", true).order("priority"),
      supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
    ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Enquiries"
        description="Every enquiry in Calman, however it ended."
      />
      <EnquiriesTable
        rows={list.rows}
        total={list.total}
        includeArchived={includeArchived}
        error={list.error}
        page={page}
        pageSize={PAGE_SIZE}
        sort={sort}
        dir={dir}
        search={search}
        counsellorName={viewer.profile?.full_name ?? null}
        roster={(staff.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
        multi={{
          teacher: filters.teacherIds ?? [],
          content: filters.contentIds ?? [],
          stage: filters.stages ?? [],
        }}
        masters={{
          teachers: teachers.data ?? [],
          institutes: institutes.data ?? [],
          courses: courses.data ?? [],
          subjects: subjects.data ?? [],
          contents: contents.data ?? [],
          terms: terms.data ?? [],
          sources: sources.data ?? [],
        }}
        panelMasters={{
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
          lostReason: one(sp.lostReason) ?? "",
          closeReason: one(sp.closeReason) ?? "",
          mobile: one(sp.mobile) ?? "",
          createdFrom: one(sp.createdFrom) ?? "",
          createdTo: one(sp.createdTo) ?? "",
          followUpFrom: one(sp.followUpFrom) ?? "",
          followUpTo: one(sp.followUpTo) ?? "",
          q: one(sp.q) ?? "",
          lastCalledFrom: one(sp.lastCalledFrom) ?? "",
          lastCalledTo: one(sp.lastCalledTo) ?? "",
        }}
      />
    </div>
  );
}
