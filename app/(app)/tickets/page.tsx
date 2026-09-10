import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import type { EnquiryStatus, IssueCategory } from "@/lib/enquiry-labels";
import { createClient } from "@/lib/supabase/server";

import { TicketsBoard, type TicketRow } from "./tickets-board";

export const metadata = { title: "Tickets · Calman" };

const PAGE_SIZE = 50;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/**
 * §5.11. The only place after-sale enquiries are worked. All roles — the
 * Ticket Team lives here, and a counsellor who took the original sale often
 * needs to see what happened next.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  const sp = await searchParams;

  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const includeResolved = one(sp.resolved) === "1";
  const status = one(sp.status) as EnquiryStatus | null;
  const counsellor = one(sp.counsellor);
  const issue = one(sp.issue) as IssueCategory | null;
  const sort = one(sp.sort) ?? "reminder";
  const dir = one(sp.dir) === "desc" ? "desc" : "asc";

  const supabase = await createClient();
  const [list, staff, masters] = await Promise.all([
    supabase.rpc("tickets_list", {
      p_include_resolved: includeResolved,
      p_status: status ?? undefined,
      p_counsellor_id: counsellor ?? undefined,
      p_issue_category: issue ?? undefined,
      p_from: one(sp.from) ?? undefined,
      p_to: one(sp.to) ?? undefined,
      p_sort: sort,
      p_dir: dir,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name"),
    Promise.all([
      supabase.from("teachers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("courses").select("id, name").eq("is_active", true).order("name"),
      supabase.from("subjects").select("id, name, course_id").eq("is_active", true).order("name"),
      supabase.from("contents").select("id, name").eq("is_active", true).order("priority"),
      supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
    ]),
  ]);

  const rows = (list.data ?? []) as unknown as TicketRow[];
  const [teachers, courses, subjects, contents, panelTerms, panelSources] = masters;

  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]],
    ),
  ).toString();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tickets"
        description="After-sale work. These never enter the recommended call list."
      />
      <TicketsBoard
        rows={rows}
        total={rows[0]?.total_count ?? 0}
        error={list.error?.message ?? null}
        page={page}
        pageSize={PAGE_SIZE}
        sort={sort}
        dir={dir}
        search={search}
        includeResolved={includeResolved}
        counsellorName={viewer.profile?.full_name ?? null}
        roster={(staff.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
        masters={{
          teachers: teachers.data ?? [],
          courses: courses.data ?? [],
          subjects: subjects.data ?? [],
          contents: contents.data ?? [],
          terms: panelTerms.data ?? [],
          sources: panelSources.data ?? [],
        }}
        selected={{
          status: status ?? "",
          counsellor: counsellor ?? "",
          issue: issue ?? "",
          from: one(sp.from) ?? "",
          to: one(sp.to) ?? "",
        }}
      />
    </div>
  );
}
