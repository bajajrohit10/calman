import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import { istDatePlus, istToday } from "@/lib/format";
import { loadMasters } from "@/lib/masters";
import { loadMyDay } from "@/lib/my-day";
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

  const masters = await loadMasters();

  const [day, roster, dismissal] = await Promise.all([
    loadMyDay({ date, counsellorId }),
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
  ]);

  // §5.8 overdue report: open follow-ups whose date has passed, uncalled since.
  const overdue = admin
    ? await loadRecommended({
        date,
        includeNotDue: true,
        followUpTo: istDatePlus(-1),
        limit: 500,
      })
    : { rows: [], total: 0, error: null };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My Day"
        description="Today's assigned calls, in the order the spec recommends working them."
      />
      <MyDay
        initial={day}
        date={date}
        isAdmin={admin}
        counsellorName={viewer.profile?.full_name ?? null}
        counsellorId={counsellorId}
        roster={(roster.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
        overdue={overdue.rows.filter((r) => r.is_overdue)}
        overdueDismissed={Boolean(dismissal.data)}
        masters={{
          teachers: masters.teachers,
          courses: masters.courses,
          subjects: masters.subjects,
          contents: masters.contents,
          terms: masters.terms,
          sources: masters.sources,
        }}
      />
    </div>
  );
}
