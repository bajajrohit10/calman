import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import type { AssignmentBucket } from "@/lib/enquiry-labels";
import { istDatePlus, istToday } from "@/lib/format";
import { fetchAllRows } from "@/lib/paged";
import { loadRecommended } from "@/lib/recommended";
import { createClient } from "@/lib/supabase/server";

import { MyDay } from "./my-day";

export const metadata = { title: "My Day · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const admin = isAdmin(viewer.profile?.role ?? "counsellor");

  const date = one(sp.date) ?? istToday();
  // A counsellor only ever sees their own day; the picker is ignored for them
  // here as well as hidden in the UI, because a query string is not a
  // permission.
  const counsellorId = admin ? (one(sp.counsellor) ?? viewer.userId!) : viewer.userId!;

  const supabase = await createClient();

  const [list, assignments, roster, dismissal, masters] = await Promise.all([
    // includeNotDue: My Day is "what am I assigned", not "what is due" — a
    // campaign assignment is by definition not due today.
    loadRecommended({ date, counsellorId, includeNotDue: true, limit: 500 }),
    fetchAllRows<{ enquiry_id: number; bucket: AssignmentBucket }>((from, to) =>
      supabase
        .from("assignments")
        .select("enquiry_id, bucket")
        .eq("date", date)
        .eq("counsellor_id", counsellorId)
        .range(from, to) as never,
    ),
    admin
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("is_active", true)
          .neq("role", "ticket_team")
          .order("full_name")
      : Promise.resolve({ data: null }),
    admin
      ? supabase.from("overdue_dismissals").select("date").eq("date", date).maybeSingle()
      : Promise.resolve({ data: null }),
    Promise.all([
      supabase.from("teachers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("courses").select("id, name").eq("is_active", true).order("name"),
      supabase.from("subjects").select("id, name, course_id").eq("is_active", true).order("name"),
      supabase.from("contents").select("id, name").eq("is_active", true).order("priority"),
    ]),
  ]);

  // The assignment carries its own bucket — a campaign row is a campaign row
  // even though the enquiry itself derives as a follow-up. Group by what was
  // assigned; order within the group is whatever §6 already returned.
  const assignedBucket = new Map<number, AssignmentBucket>(
    assignments.rows.map((a) => [a.enquiry_id, a.bucket]),
  );

  const rows = list.rows.map((r) => ({
    ...r,
    bucket: assignedBucket.get(r.enquiry_id) ?? r.bucket,
  }));

  // §5.8 overdue report: open follow-ups whose date has passed, uncalled since.
  const overdue = admin
    ? await loadRecommended({
        date,
        includeNotDue: true,
        followUpTo: istDatePlus(-1),
        limit: 500,
      })
    : { rows: [], total: 0, error: null };

  const [teachers, courses, subjects, contents] = masters;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My Day"
        description="Today's assigned calls, in the order the spec recommends working them."
      />
      <MyDay
        rows={rows}
        error={list.error}
        date={date}
        isAdmin={admin}
        counsellorId={counsellorId}
        roster={(roster.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
        overdue={overdue.rows.filter((r) => r.is_overdue)}
        overdueDismissed={Boolean(dismissal.data)}
        masters={{
          teachers: teachers.data ?? [],
          courses: courses.data ?? [],
          subjects: subjects.data ?? [],
          contents: contents.data ?? [],
        }}
      />
    </div>
  );
}
