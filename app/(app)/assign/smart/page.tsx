import Link from "next/link";

import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { logServerTiming } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import { istToday } from "@/lib/format";

import { SmartAssignPanel } from "../smart-assign";

export const metadata = { title: "Smart Assign · Calman" };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || null;

/**
 * Smart Assign, on its own URL (§40.1).
 *
 * It used to be a boolean inside the desk, which meant it had no address: it
 * could not be linked to, the browser's Back button walked out of the desk
 * entirely rather than back to the list, and the sidebar had no way to offer
 * it. A route fixes all three at once, and costs only the two things the panel
 * needs that the desk was handing it — the roster and three master lists.
 *
 * `back` carries the desk's own query string, so returning lands on the view
 * somebody left rather than a default one. It is only ever read back out into
 * a link; a bare /assign/smart?date=… is a perfectly good deep link and
 * returns to the desk on the same date.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAdminProfile();
  const sp = await searchParams;
  const date = one(sp.date) ?? istToday();

  // Whatever the desk was showing, if this was opened from it. Re-encoded
  // rather than trusted: it becomes a link on this page, so it may only ever
  // be a query string on this app's own route.
  const backQuery = new URLSearchParams(one(sp.back) ?? "");
  if (!backQuery.get("date")) backQuery.set("date", date);
  const backHref = `/assign?${backQuery.toString()}`;

  const supabase = await createClient();
  const [masters, staff] = await Promise.all([
    loadMasters(),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .neq("role", "ticket_team")
      .order("full_name"),
  ]);

  const roster = (staff.data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? "(no name)",
  }));

  logServerTiming("/assign/smart");
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Smart Assign"
        description="The whole board as six columns of options. Take away what you do not want."
        actions={
          <Link
            href={backHref}
            className="inline-flex h-[26px] items-center rounded-md border border-line-2 bg-surface px-2.5 text-[12.5px] text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            ← Assignment Desk
          </Link>
        }
      />
      <SmartAssignPanel
        date={date}
        roster={roster}
        masters={{
          teachers: masters.teachers,
          institutes: masters.institutes,
          contents: masters.contents,
          sources: masters.sources,
        }}
        backHref={backHref}
      />
    </div>
  );
}
