import {
  BEST_PRODUCT_MIN_ENQUIRIES,
  BEST_PRODUCT_MIN_SALES,
  COMPETITOR_SHARE,
  DATA_GAP_SHARE,
  FALLING_DROP,
  FALLING_TOP_N,
  LOW_CONVERSION_FRACTION_OF_TEAM,
  MAX_CARDS_PER_KIND,
  MAX_INSIGHT_CARDS,
  MIN_ENQUIRIES_FOR_RATE,
  MISSING_AMOUNT_MIN,
  NO_RESPONSE_SHARE,
  RISING_GROWTH,
  RISING_MIN_ENQUIRIES,
  SILENT_MIN_ENQUIRIES,
} from "@/lib/analytics-thresholds";
import {
  change,
  conversion,
  decided,
  type AnalyticsScope,
  type CourseRow,
  type ProductRow,
  type TeacherRow,
} from "@/lib/analytics-shape";

/**
 * §81.3, trimmed by §82.4. Nine rules, at most five cards.
 *
 * Each card is one sentence carrying the numbers that produced it and a second
 * line saying what to do, and each links to the row it came from — a card you
 * cannot open is an assertion you have to take on trust, which is the opposite
 * of what a report on a working queue is for.
 *
 * Pure: it takes the rows the page already has and returns cards. No reads, no
 * thresholds of its own (they all live in analytics-thresholds.ts), and nothing
 * that needs a clock — so the panel is testable by handing it rows.
 *
 * §82.4 changed the ordering. §81 ranked by how actionable the rule was, which
 * sounded right and meant a two-sale problem could outrank a two-hundred-lead
 * one. Cards now carry the size of the thing they are about and the biggest
 * wins, so the panel is about the business rather than about the rule set.
 */

export type Insight = {
  /** Stable id, so a card can be asserted on without matching its prose. */
  id: string;
  kind:
    | "missing-amount"
    | "low-conversion"
    | "competitor"
    | "no-response"
    | "rising"
    | "falling"
    | "data-gap"
    | "best-product"
    | "silent";
  tone: "danger" | "warn" | "info" | "ok";
  /** One sentence, with the numbers in it. */
  text: string;
  /** What to do about it, on its own line. */
  action: string;
  /**
   * How big the thing is, in leads or sales. What the panel sorts on, so a card
   * about 83 losses comes before one about 4.
   */
  magnitude: number;
  href: string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

export function buildInsights(input: {
  scope: AnalyticsScope;
  teachers: TeacherRow[];
  courses: CourseRow[];
  products: ProductRow[];
  /** The query string that reproduces the current filters, for the links. */
  query: string;
}): Insight[] {
  const { scope, query } = input;
  const now = scope.now;
  // The Untagged pseudo-row is the measure of what cannot be attributed, not a
  // dimension, so no rule judges it.
  const teachers = input.teachers.filter((r) => r.teacher_id);
  const courses = input.courses.filter((r) => r.course_id);
  const out: Insight[] = [];
  const link = (tab: string, anchor?: string) =>
    `/analytics?${query}&tab=${tab}${anchor ? `#${anchor}` : ""}`;

  // Sales recorded with no amount. Understates revenue now, in the ledger.
  if (now.wonItemsNoAmount >= MISSING_AMOUNT_MIN) {
    out.push({
      id: "missing-amount",
      kind: "missing-amount",
      tone: "danger",
      text:
        `${now.wonItemsNoAmount} of ${now.wonItems} sales have no amount, so the ` +
        `${money(Number(now.revenue))} above is understated.`,
      action: "Enter the amounts on those enquiry pages.",
      magnitude: now.wonItemsNoAmount,
      href: `/enquiries?status=won&createdFrom=${scope.from}&createdTo=${scope.to}`,
    });
  }

  // Demand that is not converting, against the team's own average so the bar
  // moves with the business.
  const teamConv = conversion(now.purchased, now.closed) ?? 0;
  const floor = teamConv * LOW_CONVERSION_FRACTION_OF_TEAM;
  for (const r of teachers) {
    // §83.1. Over closed, not over leads: a teacher with eighty leads still in
    // progress has not failed to convert them yet, and judging them on the lead
    // count punished whoever had the busiest week.
    const conv = conversion(r.purchased, r.closed);
    if (r.closed < MIN_ENQUIRIES_FOR_RATE || conv === null) continue;
    if (conv >= floor) continue;
    out.push({
      id: `low-conversion:${r.teacher_id}`,
      kind: "low-conversion",
      tone: "warn",
      text:
        `${r.teacher_name}: ${r.closed} closed calls but ${pct(conv)} conversion, ` +
        `under half the team's ${pct(teamConv)}.`,
      action: "Check price, availability and the counsellor pitch.",
      magnitude: r.closed,
      href: link("teachers", `row-${r.teacher_id}`),
    });
  }

  // Competitor pressure, as a share of outcomes that have actually been decided
  // rather than of everything including work still in progress.
  for (const r of teachers) {
    const d = decided(r);
    if (d === 0 || r.closed < MIN_ENQUIRIES_FOR_RATE) continue;
    const share = r.lost_competitor / d;
    if (share < COMPETITOR_SHARE) continue;
    out.push({
      id: `competitor:${r.teacher_id}`,
      kind: "competitor",
      tone: "warn",
      text:
        `${r.teacher_name} lost ${r.lost_competitor} of ${d} decided leads to a ` +
        `competitor (${pct(share)}).`,
      action: "Competitor pressure — review the offer.",
      magnitude: r.lost_competitor,
      href: link("teachers", `row-${r.teacher_id}`),
    });
  }

  // Students going quiet across the whole period.
  if (now.lostTotal > 0) {
    const share = now.lostNoResponse / now.lostTotal;
    if (share >= NO_RESPONSE_SHARE) {
      out.push({
        id: "no-response",
        kind: "no-response",
        tone: "warn",
        text:
          `${now.lostNoResponse} of ${now.lostTotal} losses (${pct(share)}) were ` +
          `students going silent after their follow-ups ran out.`,
        action: "Review follow-up timing and script.",
        magnitude: now.lostNoResponse,
        href: `/enquiries?status=lost&lostReason=max_followups&createdFrom=${scope.from}&createdTo=${scope.to}`,
      });
    }
  }

  /**
   * §82.4. Where leads go silent, by subject.
   *
   * The same fact as the card above, cut by course and subject, which is what
   * makes it actionable: "review the follow-up script" is advice you can only
   * take if you know which conversation to review.
   */
  const silent = courses
    .filter((r) => r.closed >= SILENT_MIN_ENQUIRIES && r.lost_no_response > 0)
    .map((r) => ({ r, share: r.lost_no_response / r.closed }))
    .sort((a, b) => b.share - a.share);
  if (silent.length) {
    const { r, share } = silent[0];
    out.push({
      id: `silent:${r.course_id}:${r.subject_id ?? "none"}`,
      kind: "silent",
      tone: "warn",
      text:
        `${r.course_name} · ${r.subject_name}: ${r.lost_no_response} of ${r.closed} ` +
        `closed (${pct(share)}) went silent — the highest share of any subject.`,
      action: "Review the follow-up script for this subject.",
      magnitude: r.lost_no_response,
      href: link("products"),
    });
  }

  /**
   * §82.4. The product line that converts best.
   *
   * Read off what students typed rather than off the tags, because the tags say
   * which teacher and the text says which *offer* — "Audit Full Course" and
   * "Audit Fast Track" tag identically and sell at different rates.
   */
  const best = input.products
    .filter(
      (p) =>
        p.enquiries >= BEST_PRODUCT_MIN_ENQUIRIES && p.purchased >= BEST_PRODUCT_MIN_SALES,
    )
    .map((p) => ({ p, conv: p.purchased / p.enquiries }))
    .sort((a, b) => b.conv - a.conv);
  if (best.length) {
    const { p, conv } = best[0];
    out.push({
      id: "best-product",
      kind: "best-product",
      tone: "ok",
      text:
        `"${p.product}" converts at ${pct(conv)} on ${p.enquiries} enquiries — the ` +
        `best of anything students asked for by name.`,
      action: "Lead with this in campaigns.",
      magnitude: p.enquiries,
      href: link("products"),
    });
  }

  // A course and subject pulling ahead of the same length of time before it.
  // Dormant until there are two populated windows; see `change`.
  for (const r of courses) {
    const g = change(r.leads, r.prev_leads);
    if (g === null || g < RISING_GROWTH) continue;
    if (r.leads < RISING_MIN_ENQUIRIES) continue;
    out.push({
      id: `rising:${r.course_id}:${r.subject_id ?? "none"}`,
      kind: "rising",
      tone: "ok",
      text:
        `${r.course_name} · ${r.subject_name} is up ${pct(g)} ` +
        `(${r.prev_leads} to ${r.leads}).`,
      action: "Demand rising — campaign now.",
      magnitude: r.leads,
      href: link("products"),
    });
  }

  // A big teacher losing ground, among the ones big enough that a drop is a
  // trend rather than a quiet week. Dormant for the same reason.
  const topTeachers = [...teachers]
    .sort((a, b) => b.leads - a.leads)
    .slice(0, FALLING_TOP_N);
  for (const r of topTeachers) {
    const g = change(r.leads, r.prev_leads);
    if (g === null || g > -FALLING_DROP) continue;
    out.push({
      id: `falling:${r.teacher_id}`,
      kind: "falling",
      tone: "warn",
      text:
        `${r.teacher_name} fell ${pct(Math.abs(g))} against the comparison period ` +
        `(${r.prev_leads} to ${r.leads}).`,
      action: "Falling demand — worth asking why.",
      magnitude: r.prev_leads - r.leads,
      href: link("teachers", `row-${r.teacher_id}`),
    });
  }

  // Tagging. Every rate on this page is computed over tagged leads, so a large
  // untagged share is a statement about the page's own reliability.
  const gap = now.leads > 0 ? scope.untagged / now.leads : 0;
  if (gap > DATA_GAP_SHARE) {
    out.push({
      id: "data-gap:teacher",
      kind: "data-gap",
      tone: "info",
      text:
        `${scope.untagged} of ${now.leads} leads (${pct(gap)}) name no teacher, so ` +
        `every rate here is computed on the other ${scope.taggedLeads}.`,
      action: "Tighten tagging at Quick Add.",
      magnitude: scope.untagged,
      href: link("teachers", "row-untagged"),
    });
  }

  /**
   * Biggest first, then two per rule, then five.
   *
   * The per-kind cap survives from §81, where one rule fired on five rows at
   * once and filled the whole panel. With five cards it matters more, not less:
   * one rule having a bad day should not cost the other eight their voice.
   */
  const ranked = [...out].sort((a, b) => b.magnitude - a.magnitude);
  const perKind = new Map<Insight["kind"], number>();
  const spread = ranked.filter((i) => {
    const n = (perKind.get(i.kind) ?? 0) + 1;
    perKind.set(i.kind, n);
    return n <= MAX_CARDS_PER_KIND;
  });
  return spread.slice(0, MAX_INSIGHT_CARDS);
}
