import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/format";

import { HolidaysView, type HolidayRow } from "./holidays-view";

export const metadata = { title: "Holidays · Calman" };

/**
 * §54.2(b). The calendar the follow-up picker and carry-forward both read.
 *
 * Admin only, like the rest of Settings: a date that closes the office is a
 * decision about everybody's day, and a counsellor changing it would move
 * other people's follow-ups.
 */
export default async function Page() {
  await requireAdminProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("holidays")
    .select("date, name, is_active, is_working_override")
    .order("date", { ascending: true });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Holidays"
        description="Working days are Monday to Saturday. A holiday closes one; a working Sunday opens one."
      />
      <HolidaysView
        rows={(data ?? []) as HolidayRow[]}
        today={istToday()}
        error={error?.message ?? null}
      />
    </div>
  );
}
