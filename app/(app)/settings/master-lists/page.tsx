import { requireAdminProfile } from "@/lib/auth";
import { fetchAllRows } from "@/lib/paged";
import { createClient } from "@/lib/supabase/server";

import { listByKey, LISTS } from "./config";
import { ListEditor } from "./list-editor";
import { ListTabs } from "./list-tabs";

export const metadata = { title: "Master lists · Settings · Calman" };

export type Row = Record<string, unknown> & {
  is_active?: boolean;
  name?: string;
};

/** See the note in actions.ts: one engine, eight row shapes, narrowed once. */
type ReadQuery = PromiseLike<{ data: Row[] | null; error: { message: string } | null }> & {
  order(column: string, options: { ascending: boolean }): ReadQuery;
};

export default async function MasterListsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  await requireAdminProfile();

  const { list: listKey } = await searchParams;
  const spec = listByKey(listKey);

  // The caller's own client, so RLS decides what is readable. Master lists are
  // readable by all staff including inactive rows, which is what lets a
  // historical enquiry still resolve the option it was filed under.
  const supabase = await createClient();

  // Paged. Teachers is the biggest of these at 73 today, but a master list is
  // append-only by design (§3 soft-delete, no deletes), so it grows forever —
  // and a silently truncated list here would hide options rather than fail.
  const { rows: data, error } = await fetchAllRows<Row>((from, to) => {
    let query = supabase.from(spec.table).select("*") as unknown as ReadQuery;
    for (const order of spec.orderBy) {
      query = query.order(order.column, { ascending: order.ascending });
    }
    return (query as unknown as { range: (a: number, b: number) => never }).range(
      from,
      to,
    );
  });

  // Teachers carry an optional institute, so the editor needs that list too.
  const needsInstitutes = spec.fields.some((f) => f.kind === "institute");
  const { data: institutes } = needsInstitutes
    ? await supabase.from("institutes").select("id, name").eq("is_active", true).order("name")
    : { data: null };

  // Subjects are grouped under their course, so the editor needs the courses.
  const needsCourses = spec.fields.some((f) => f.kind === "course");
  const { data: courses } = needsCourses
    ? await supabase.from("courses").select("id, name").order("sort_order").order("name")
    : { data: null };

  return (
    <div className="flex flex-col gap-4">
      <ListTabs current={spec.key} lists={LISTS.map((l) => ({ key: l.key, label: l.label }))} />

      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          Could not load {spec.label}: {error}
        </p>
      ) : (
        <ListEditor
          spec={spec}
          rows={(data ?? []) as Row[]}
          courses={(courses ?? []) as { id: string; name: string }[]}
          institutes={(institutes ?? []) as { id: string; name: string }[]}
        />
      )}
    </div>
  );
}
