import {
  COMPETITOR_SHARE,
  DATA_GAP_SHARE,
  FALLING_DROP,
  FALLING_TOP_N,
  FAST_MOVER_MIN_ENQUIRIES,
  LOW_CONVERSION_FRACTION_OF_TEAM,
  MAX_CARDS_PER_KIND,
  MAX_INSIGHT_CARDS,
  MIN_ENQUIRIES_FOR_RATE,
  MISSING_AMOUNT_MIN,
  NO_RESPONSE_SHARE,
  RISING_GROWTH,
  RISING_MIN_ENQUIRIES,
  SUPPORT_DRAG_MIN_SALES,
  SUPPORT_DRAG_PER_10_SALES,
} from "@/lib/analytics-thresholds";
import {
  change,
  conversion,
  decided,
  ticketsPer10,
  type AnalyticsScope,
  type DemandRow,
  type PivotRow,
} from "@/lib/analytics-shape";

/**
 * §81.3. The insight panel: nine rules, at most eight cards.
 *
 * Each card is one sentence carrying the numbers that produced it and the action
 * it suggests, and each links to the row it came from — a card you cannot open
 * is an assertion you have to take on trust, which is the opposite of what a
 * report on a working queue is for.
 *
 * Pure: it takes the rows the page already has and returns cards. No reads, no
 * thresholds of its own (they all live in analytics-thresholds.ts), and nothing
 * that needs a clock — so the panel is testable by handing it rows.
 *
 * Ordered by how much a manager can do about it, not by size. A sale with no
 * amount is a two-minute fix that is wrong in the ledger right now; a falling
 * teacher is a conversation next week. When more than eight fire, the ones at
 * the bottom of this list are the ones that wait.
 */

export type Insight = {
  /** Stable id, so a card can be asserted on without matching its prose. */
  id: string;
  kind:
    | "missing-amount"
    | "low-conversion"
    | "competitor"
    | "support-drag"
    | "no-response"
    | "rising"
    | "falling"
    | "data-gap"
    | "fast-mover";
  tone: "danger" | "warn" | "info" | "ok";
  /** One sentence, with the numbers in it. */
  text: string;
  /** What to do about it. */
  action: string;
  /** Where the number came from. */
  href: string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/** The teacher/institute rows minus the Untagged pseudo-row, which no rule judges. */
const real = (rows: DemandRow[]) => rows.filter((r) => r.institute_id || r.teacher_id);

export function buildInsights(input: {
  scope: AnalyticsScope;
  teachers: DemandRow[];
  institutes: DemandRow[];
  pivot: PivotRow[];
  /** The query string that reproduces the current filters, for the links. */
  query: string;
}): Insight[] {
  const { scope, pivot, query } = input;
  const teachers = real(input.teachers);
  const institutes = real(input.institutes);
  const out: Insight[] = [];
  const link = (tab: string, anchor?: string) =>
    `/analytics?${query}&tab=${tab}${anchor ? `#${anchor}` : ""}`;

  // 1. Sales with no amount. A ledger error, not a trend: first because it is
  //    the only card here that is wrong rather than merely worth knowing.
  if (scope.wonItemsNoAmount >= MISSING_AMOUNT_MIN) {
    out.push({
      id: "missing-amount",
      kind: "missing-amount",
      tone: "danger",
      text:
        `${scope.wonItemsNoAmount} of ${scope.wonItems} sales in this period have no amount, ` +
        `so the ${money(scope.revenue)} revenue above is understated.`,
      action: "Enter the amounts on those enquiry pages.",
      href: `/enquiries?status=won&from=${scope.from}&to=${scope.to}`,
    });
  }

  // 2. Demand that is not converting. Compared with the team's own average, so
  //    the bar moves with the business.
  const floor = scope.teamConversion * LOW_CONVERSION_FRACTION_OF_TEAM;
  for (const r of teachers) {
    const name = r.teacher_name ?? "";
    const conv = conversion(r.purchased, r.enquiries);
    if (r.enquiries < MIN_ENQUIRIES_FOR_RATE || conv === null) continue;
    if (conv >= floor) continue;
    out.push({
      id: `low-conversion:${r.teacher_id}`,
      kind: "low-conversion",
      tone: "warn",
      text:
        `${name} had ${r.enquiries} enquiries but converted ${pct(conv)} — under half the ` +
        `team's ${pct(scope.teamConversion)}.`,
      action: "Check price, availability and the counsellor pitch.",
      href: link("teachers", `teacher-${r.teacher_id}`),
    });
  }

  // 3. Competitor pressure, as a share of outcomes that have actually been
  //    decided rather than of everything including work still in progress.
  for (const r of teachers) {
    const d = decided(r);
    if (d === 0 || r.enquiries < MIN_ENQUIRIES_FOR_RATE) continue;
    const share = r.lost_competitor / d;
    if (share < COMPETITOR_SHARE) continue;
    out.push({
      id: `competitor:${r.teacher_id}`,
      kind: "competitor",
      tone: "warn",
      text:
        `${r.teacher_name} lost ${r.lost_competitor} of ${d} decided leads to a competitor ` +
        `(${pct(share)})${r.items_lost_competitor ? `, ${r.items_lost_competitor} of them on their own lines` : ""}.`,
      action: "Competitor pressure — review the offer.",
      href: link("teachers", `teacher-${r.teacher_id}`),
    });
  }

  // 4. After-sale work eating the institute's own repeat business.
  for (const r of institutes) {
    const rate = ticketsPer10(r.tickets, r.purchased);
    if (rate === null || rate < SUPPORT_DRAG_PER_10_SALES) continue;
    if (r.purchased < SUPPORT_DRAG_MIN_SALES) continue;
    out.push({
      id: `support-drag:${r.institute_id}`,
      kind: "support-drag",
      tone: "warn",
      text:
        `${r.institute_name} raised ${r.tickets} support tickets against ${r.purchased} sales ` +
        `— ${rate.toFixed(1)} per 10.`,
      action: "Quality issue hurting repeat sales.",
      href: link("institutes", `institute-${r.institute_id}`),
    });
  }

  // 5. Students going quiet. The biggest loss bucket in this data and the one
  //    the team can act on by changing when it calls.
  if (scope.lostTotal > 0) {
    const share = scope.lostNoResponse / scope.lostTotal;
    if (share >= NO_RESPONSE_SHARE) {
      out.push({
        id: "no-response",
        kind: "no-response",
        tone: "warn",
        text:
          `${scope.lostNoResponse} of ${scope.lostTotal} losses (${pct(share)}) were students ` +
          `going silent after their follow-ups ran out.`,
        action: "Review follow-up timing and script.",
        href: `/enquiries?status=lost&lostReason=max_followups&from=${scope.from}&to=${scope.to}`,
      });
    }
  }

  // 6. A course and term pulling ahead of the same length of time before it.
  for (const c of pivot) {
    const g = change(c.enquiries, c.prev_enquiries);
    if (g === null || g < RISING_GROWTH) continue;
    if (c.enquiries < RISING_MIN_ENQUIRIES) continue;
    out.push({
      id: `rising:${c.course_id}:${c.subject_id ?? "none"}:${c.term_id ?? "none"}`,
      kind: "rising",
      tone: "ok",
      text:
        `${c.course_name} · ${c.subject_name} for ${c.term_name} is up ${pct(g)} ` +
        `(${c.prev_enquiries} → ${c.enquiries}).`,
      action: "Demand rising — campaign now.",
      href: link("products"),
    });
  }

  // 7. A big teacher losing ground. Only among the ones big enough that a drop
  //    is a trend rather than a quiet week.
  const topTeachers = [...teachers]
    .sort((a, b) => b.enquiries - a.enquiries)
    .slice(0, FALLING_TOP_N);
  for (const r of topTeachers) {
    const g = change(r.enquiries, r.prev_enquiries);
    if (g === null || g > -FALLING_DROP) continue;
    out.push({
      id: `falling:${r.teacher_id}`,
      kind: "falling",
      tone: "warn",
      text:
        `${r.teacher_name} fell ${pct(Math.abs(g))} against the previous ${scope.days} days ` +
        `(${r.prev_enquiries} → ${r.enquiries}).`,
      action: "Falling demand — worth asking why.",
      href: link("teachers", `teacher-${r.teacher_id}`),
    });
  }

  // 8. Tagging. Every rate on this page is computed over tagged leads, so a
  //    large untagged share is a statement about the page's own reliability.
  const teacherGap = scope.leads > 0 ? scope.untagged / scope.leads : 0;
  if (teacherGap > DATA_GAP_SHARE) {
    out.push({
      id: "data-gap:teacher",
      kind: "data-gap",
      tone: "info",
      text:
        `${scope.untagged} of ${scope.leads} leads (${pct(teacherGap)}) name no teacher, ` +
        `so every rate here is computed on the other ${scope.taggedLeads}.`,
      action: "Tighten tagging at Quick Add.",
      href: link("teachers", "untagged"),
    });
  }
  const termGap =
    scope.leads > 0
      ? pivot.filter((c) => c.term_name === "Unknown").reduce((n, c) => n + c.enquiries, 0) /
        Math.max(scope.pivotCells, 1)
      : 0;
  if (termGap > DATA_GAP_SHARE) {
    out.push({
      id: "data-gap:term",
      kind: "data-gap",
      tone: "info",
      text: `${pct(termGap)} of pivot cells carry no term, so the Unknown column is the largest.`,
      action: "Tighten tagging at Quick Add.",
      href: link("products"),
    });
  }

  // 9. The one to repeat. Last because it is the only card that is good news,
  //    and a panel that leads with good news buries the rest.
  const movers = pivot
    .filter((c) => c.enquiries >= FAST_MOVER_MIN_ENQUIRIES && c.purchased > 0)
    .map((c) => ({ c, conv: c.purchased / c.enquiries }))
    .sort((a, b) => b.conv - a.conv);
  if (movers.length) {
    const { c, conv } = movers[0];
    out.push({
      id: `fast-mover:${c.course_id}:${c.subject_id ?? "none"}:${c.term_id ?? "none"}`,
      kind: "fast-mover",
      tone: "ok",
      text:
        `${c.course_name} · ${c.subject_name} for ${c.term_name} converts best at ${pct(conv)} ` +
        `(${c.purchased} of ${c.enquiries}).`,
      action: "Push this in marketing.",
      href: link("products"),
    });
  }

  /**
   * Two per rule, then the first eight.
   *
   * `out` is already in rule order — most actionable first — and each rule
   * pushes its own rows in the order the table gave them, which for the demand
   * rules is enquiries descending. So taking the first two of each kind keeps the
   * biggest instance of each problem rather than an arbitrary one.
   */
  const perKind = new Map<Insight["kind"], number>();
  const spread = out.filter((i) => {
    const n = (perKind.get(i.kind) ?? 0) + 1;
    perKind.set(i.kind, n);
    return n <= MAX_CARDS_PER_KIND;
  });
  return spread.slice(0, MAX_INSIGHT_CARDS);
}
