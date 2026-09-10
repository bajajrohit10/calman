import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { PAGE_SIZE, parseNewCallsParams } from "./filters";
import { NewCallsBoard, type PoolRow } from "./new-calls-board";

export const metadata = { title: "New Calls · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/** §5.12. The unclaimed pool — all roles; anyone who calls can take work. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireUser();
  const sp = await searchParams;
  const { page, sourceIds, filters } = parseNewCallsParams((k) => one(sp[k]));

  const supabase = await createClient();
  const [list, teachers, courses, terms, sources] = await Promise.all([
    supabase.rpc("new_calls_pool", {
      ...filters,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    supabase.from("teachers").select("id, name").eq("is_active", true).order("name"),
    supabase.from("courses").select("id, name").eq("is_active", true).order("name"),
    supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
  ]);

  const rows = (list.data ?? []) as unknown as PoolRow[];
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]],
    ),
  ).toString();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New Calls"
        description="Leads nobody has spoken to or claimed yet. Take what you can call."
      />
      <NewCallsBoard
        rows={rows}
        total={rows[0]?.total_count ?? 0}
        error={list.error?.message ?? null}
        page={page}
        pageSize={PAGE_SIZE}
        search={search}
        sourceIds={sourceIds}
        masters={{
          teachers: teachers.data ?? [],
          courses: courses.data ?? [],
          terms: terms.data ?? [],
          sources: sources.data ?? [],
        }}
        selected={{
          course: one(sp.course) ?? "",
          teacher: one(sp.teacher) ?? "",
          importance: one(sp.importance) ?? "",
          term: one(sp.term) ?? "",
          createdFrom: one(sp.createdFrom) ?? "",
          createdTo: one(sp.createdTo) ?? "",
          product: one(sp.product) ?? "",
        }}
      />
    </div>
  );
}
