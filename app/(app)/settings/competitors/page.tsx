import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { COMPETITORS_LIST } from "../master-lists/config";
import { ListEditor } from "../master-lists/list-editor";
import type { Row } from "../master-lists/page";
import { TypedNames, type TypedName } from "./typed-names";

export const metadata = { title: "Competitors · Settings · Calman" };

/**
 * §89. Settings → Competitors.
 *
 * The list itself is edited by the master-list engine — add, rename,
 * deactivate, reorder, already written and already audited. What this page
 * adds is the half that engine cannot do: the names counsellors typed into
 * "Other", and the two ways of folding them back in.
 */
export default async function Page() {
  await requireAdminProfile();
  const supabase = await createClient();

  const [list, typed] = await Promise.all([
    supabase
      .from("competitors")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.rpc("competitor_typed_names"),
  ]);

  const active = ((list.data ?? []) as Row[])
    .filter((r) => r.is_active !== false)
    .map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Competitors"
        description="Who takes the students we lose. Picked on every competitor loss, and the rows of the Competitors report."
      />
      {list.error ? (
        <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          Could not load the competitors: {list.error.message}
        </p>
      ) : (
        <ListEditor
          spec={COMPETITORS_LIST}
          rows={(list.data ?? []) as Row[]}
          courses={[]}
          institutes={[]}
        />
      )}
      <TypedNames
        rows={((typed.data ?? []) as { name: string; leads: number }[]).map((r) => ({
          name: r.name,
          leads: Number(r.leads ?? 0),
        })) as TypedName[]}
        competitors={active}
      />
    </div>
  );
}
