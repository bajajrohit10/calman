"use server";

import { isAdmin, requireUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { loadMyDay, type MyDayData } from "@/lib/my-day";

/**
 * Re-read the day after a call is saved.
 *
 * The tab counts have to move the moment a call lands — a counsellor works
 * down "New Calls 12 / 35" and watches the 12 fall, and a count that only
 * corrects itself on the next navigation is worse than no count. router
 * .refresh() would do it, but it re-renders the whole route and throws away
 * which tab and which toggle the counsellor was on, which on a screen you
 * touch two hundred times a day is the wrong trade.
 *
 * So the list is client state after the first paint, and this refills it. The
 * counsellor id is re-derived here rather than trusted from the caller: a
 * counsellor may only ever read their own day, exactly as the page decides it.
 */
export async function refreshMyDay(input: {
  date: string;
  counsellorId: string;
}): Promise<MyDayData> {
  const viewer = await requireUser();
  if (!viewer.profile) {
    return { rows: [], tickets: [], offerTabs: [], error: "Your account is not active." };
  }

  const admin = isAdmin(viewer.profile.role);
  const counsellorId = admin ? input.counsellorId : viewer.userId!;
  const date = input.date || istToday();

  return loadMyDay({ date, counsellorId });
}
